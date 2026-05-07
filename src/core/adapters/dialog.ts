import { Address, Hex, Provider as ox_Provider, RpcRequest as ox_RpcRequest } from 'ox'
import * as RpcResponse from 'ox/RpcResponse'
import { KeyAuthorization } from 'ox/tempo'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount } from 'viem/tempo'
import { z } from 'zod/mini'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
import * as Dialog from '../Dialog.js'
import * as Messenger from '../Messenger.js'
import * as Schema from '../Schema.js'
import type * as Store from '../Store.js'
import * as Rpc from '../zod/rpc.js'

/**
 * Creates a dialog adapter that delegates signing to a remote embed app
 * via an iframe or popup dialog.
 *
 * @example
 * ```ts
 * import { dialog, Provider } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: dialog(),
 * })
 * ```
 */
export function dialog(options: dialog.Options = {}): Adapter.Adapter {
  const {
    dialog = Dialog.isInsecureContext() ? Dialog.popup() : Dialog.iframe(),
    // TODO: use the new host
    // host = 'https://wallet-next.tempo.xyz/remote',
    host = 'https://wallet.tempo.xyz/embed',
    icon = 'data:image/svg+xml,<svg width="269" height="269" viewBox="0 0 269 269" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="269" height="269" fill="black"/><path d="M123.273 190.794H93.445L121.09 105.318H85.7334L93.445 80.2642H191.95L184.238 105.318H150.773L123.273 190.794Z" fill="white"/></svg>',
    name = 'Tempo Wallet',
    provider: attachedProvider,
    rdns = 'xyz.tempo',
    theme,
  } = options

  if (typeof window !== 'undefined' && !window.isSecureContext)
    console.warn(
      '[accounts] Detected insecure context (HTTP).',
      `\n\nThe Tempo Wallet iframe dialog is not supported on HTTP origins (${window.location.origin})`,
      'due to lack of WebAuthn passkey support in non-secure contexts.',
    )

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    const listeners = new Set<(requestQueue: readonly Store.QueuedRequest[]) => void>()
    const requestStore = ox_RpcRequest.createStore()

    /** Wait for a queued request to be resolved via the store. */
    function waitForQueuedRequest(requestId: number) {
      return new Promise((resolve, reject) => {
        const listener = (requestQueue: readonly Store.QueuedRequest[]) => {
          const queued = requestQueue.find((x) => x.request.id === requestId)

          // Request removed and queue empty — cancelled or dialog closed.
          if (!queued && requestQueue.length === 0) {
            listeners.delete(listener)
            reject(new ox_Provider.UserRejectedRequestError())
            return
          }

          // Request not found but queue has other requests — wait.
          if (!queued) return

          // Request found but not yet resolved — wait.
          if (queued.status !== 'success' && queued.status !== 'error') return

          listeners.delete(listener)

          if (queued.status === 'success') resolve(queued.result)
          else reject(new ox_Provider.UserRejectedRequestError({ message: queued.error.message }))

          // Remove the resolved request from the queue.
          store.setState((x) => ({
            ...x,
            requestQueue: x.requestQueue.filter((x) => x.request.id !== requestId),
          }))
        }

        listeners.add(listener)

        // Notify immediately with current state so the store subscription
        // picks up the request that was just added (setState fires
        // synchronously before this listener is registered).
        listener(store.getState().requestQueue)
      })
    }

    /**
     * An ox provider that queues RPC requests in the store. The store
     * subscription syncs the pending queue to the dialog via `syncRequests`.
     */
    const provider = ox_Provider.from(
      {
        async request(r) {
          const request = requestStore.prepare(r as never)

          store.setState((x) => ({
            ...x,
            requestQueue: [...x.requestQueue, { request, status: 'pending' as const }],
          }))

          return waitForQueuedRequest(request.id)
        },
      },
      { schema: Schema.ox },
    )

    async function syncAttachedProviderState(
      accounts: readonly Store.Account[] | undefined = undefined,
    ) {
      if (!attachedProvider) return accounts ?? []
      const nextAccounts =
        accounts ?? toStoreAccounts(await attachedProvider.request({ method: 'eth_accounts' }))
      const chainId = await (async () => {
        try {
          return toChainId(await attachedProvider.request({ method: 'eth_chainId' }))
        } catch {
          return undefined
        }
      })()
      store.setState((x) => ({
        ...x,
        accounts: nextAccounts,
        activeAccount: nextAccounts.length > 0 ? 0 : x.activeAccount,
        ...(chainId ? { chainId } : {}),
      }))
      return nextAccounts
    }

    async function connectAttachedProvider(request: {
      method: string
      originMethod?: string | undefined
      params?: unknown | undefined
    }) {
      if (!attachedProvider) throw new ox_Provider.UnsupportedMethodError()
      const result = await attachedProvider.request(request).catch(async (error) => {
        if (request.method === 'wallet_connect')
          return await attachedProvider.request({ method: 'eth_requestAccounts' })
        throw error
      })
      const accounts = toStoreAccounts(result)
      await syncAttachedProviderState(accounts)
      return { accounts }
    }

    /**
     * Prepares a local key pair when `authorizeAccessKey` is requested without
     * an external publicKey/address, and returns the params to inject into the
     * RPC request so the dialog signs the authorization.
     */
    async function generateAccessKey(options: Adapter.authorizeAccessKey.Parameters | undefined) {
      if (!options) return undefined
      if (options.publicKey || options.address) return undefined

      const { accessKey, keyPair } = await AccessKey.generate()
      return {
        accessKey,
        keyPair,
        request: {
          ...options,
          publicKey: accessKey.publicKey,
          keyType: 'p256' as const,
        },
      }
    }

    /**
     * After the dialog returns a signed key authorization, saves the local
     * key pair + key authorization into the store.
     */
    function saveAccessKey(
      address: Address.Address,
      keyAuth: KeyAuthorization.Rpc,
      keyPair: AccessKey.generate.ReturnType['keyPair'],
    ) {
      const keyAuthorization = KeyAuthorization.fromRpc(keyAuth)
      AccessKey.save({ address, keyAuthorization, keyPair, store })
    }

    /**
     * Tries to execute `fn` with the local access key. Returns `undefined`
     * when no access key exists so the caller can fall through to the dialog.
     * On access key errors, removes the stale key and also returns `undefined`.
     */
    async function withAccessKey<result>(
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed,
      ) => Promise<result>,
    ): Promise<result | undefined> {
      const account = (() => {
        try {
          return getAccount({ signable: true })
        } catch {
          return undefined
        }
      })()
      if (!account) return undefined
      if (account.source !== 'accessKey') return undefined
      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch (err) {
        console.warn('[accounts] silent sign with access key failed, removing key:', err)
        AccessKey.remove(account, { store })
        return undefined
      }
    }

    const dialogInstance = dialog({
      host: attachedProvider ? withDelegatedProvider(host) : host,
      store,
      theme,
    })
    const offProviderBridge = attachedProvider
      ? installProviderBridge({ host: withDelegatedProvider(host), provider: attachedProvider })
      : () => undefined
    const offProviderEvents = attachedProvider
      ? installProviderEventBridge({ provider: attachedProvider, store })
      : () => undefined

    // Sync store → dialog: whenever the request queue changes, notify
    // listeners and sync pending requests to the dialog.
    const unsubscribe = store.subscribe(
      (x) => x.requestQueue,
      (requestQueue) => {
        for (const listener of listeners) listener(requestQueue)

        const pending = requestQueue.filter(
          (x): x is Store.QueuedRequest & { status: 'pending' } => x.status === 'pending',
        )

        dialogInstance?.syncRequests(pending)
        if (pending.length === 0) dialogInstance?.close()
      },
    )

    return {
      cleanup() {
        unsubscribe()
        offProviderBridge()
        offProviderEvents()
        dialogInstance?.destroy()
      },
      actions: {
        async createAccount(parameters, request) {
          if (attachedProvider) return await connectAttachedProvider(request)

          const accessKey = await generateAccessKey(parameters.authorizeAccessKey)

          const { accounts } = await provider.request({
            ...request,
            params: [
              {
                ...request.params?.[0],
                capabilities: {
                  ...request.params?.[0]?.capabilities,
                  ...(accessKey
                    ? {
                        authorizeAccessKey: z.encode(
                          Rpc.wallet_connect.authorizeAccessKey,
                          accessKey.request,
                        ),
                      }
                    : {}),
                },
              },
            ] as const,
          })

          const address = accounts[0]?.address
          const keyAuthorization = accounts[0]?.capabilities.keyAuthorization

          if (accessKey && address && keyAuthorization)
            saveAccessKey(address, keyAuthorization, accessKey.keyPair)

          return {
            accounts: accounts.map((a) => ({ address: a.address })),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(accounts[0]?.capabilities.signature
              ? { signature: accounts[0].capabilities.signature }
              : {}),
          }
        },

        async loadAccounts(parameters, request) {
          if (attachedProvider) return await connectAttachedProvider(request)

          const accessKey = await generateAccessKey(parameters?.authorizeAccessKey)

          const { accounts } = await provider.request({
            ...request,
            params: [
              {
                ...request.params?.[0],
                capabilities: {
                  ...request.params?.[0]?.capabilities,
                  ...(accessKey
                    ? {
                        authorizeAccessKey: z.encode(
                          Rpc.wallet_connect.authorizeAccessKey,
                          accessKey.request,
                        ),
                      }
                    : {}),
                },
              },
            ] as const,
          })

          const address = accounts[0]?.address
          const keyAuthorization = accounts[0]?.capabilities.keyAuthorization

          if (accessKey && address && keyAuthorization)
            saveAccessKey(address, keyAuthorization, accessKey.keyPair)

          return {
            accounts: accounts.map((a) => ({ address: a.address })),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(accounts[0]?.capabilities.signature
              ? { signature: accounts[0].capabilities.signature }
              : {}),
          }
        },

        async signPersonalMessage(_params, request) {
          return await provider.request(request)
        },

        async signTransaction(parameters, request) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const client = getClient({
              feePayer: (() => {
                if (feePayer === false) return false
                if (typeof feePayer === 'string') return feePayer
                return undefined
              })(),
            })
            const prepared = await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(typeof feePayer !== 'undefined' ? { feePayer: !!feePayer as never } : {}),
              keyAuthorization,
              type: 'tempo',
            })
            return await account.signTransaction(prepared as never)
          })
          if (result !== undefined) return result
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.transactionRequest, parameters)] as const,
          })
        },

        async signTypedData(_params, request) {
          return await provider.request(request)
        },

        async sendTransaction(parameters, request) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const client = getClient({
              feePayer: (() => {
                if (feePayer === false) return false
                if (typeof feePayer === 'string') return feePayer
                return undefined
              })(),
            })
            const prepared = await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(typeof feePayer !== 'undefined' ? { feePayer: !!feePayer as never } : {}),
              keyAuthorization,
              type: 'tempo',
            })
            const signed = await account.signTransaction(prepared as never)
            return await client.request({
              method: 'eth_sendRawTransaction' as never,
              params: [signed],
            })
          })
          if (result !== undefined) return result
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.transactionRequest, parameters)] as const,
          })
        },

        async sendTransactionSync(parameters, request) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const client = getClient({
              feePayer: (() => {
                if (feePayer === false) return false
                if (typeof feePayer === 'string') return feePayer
                return undefined
              })(),
            })
            const prepared = await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(typeof feePayer !== 'undefined' ? { feePayer: !!feePayer as never } : {}),
              keyAuthorization,
              type: 'tempo',
            })
            const signed = await account.signTransaction(prepared as never)
            return await client.request({
              method: 'eth_sendRawTransactionSync' as never,
              params: [signed],
            })
          })
          if (result !== undefined) return result
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.transactionRequest, parameters)] as const,
          })
        },

        async authorizeAccessKey(parameters, request) {
          const accessKey = await generateAccessKey(parameters)

          const result = await provider.request({
            ...request,
            params: [
              z.encode(
                Rpc.wallet_connect.authorizeAccessKey,
                accessKey ? accessKey.request : parameters,
              )!,
            ],
          })

          if (accessKey) {
            const account = getAccount({ accessKey: false, signable: false })
            saveAccessKey(account.address, result.keyAuthorization, accessKey.keyPair)
          }

          return result
        },

        async revokeAccessKey(_params, request) {
          await provider.request(request)
        },

        async deposit(_params, request) {
          return await provider.request(request)
        },

        async send(params, request) {
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_send.parameters, params)] as const,
          })
        },

        async swap(_params, request) {
          return await provider.request(request)
        },

        async depositZone(params, request) {
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_depositZone.parameters, params)] as const,
          })
        },

        async withdrawZone(params, request) {
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_withdrawZone.parameters, params)] as const,
          })
        },

        async disconnect() {
          if (attachedProvider)
            await attachedProvider.request({ method: 'wallet_disconnect' }).catch(() => undefined)
          store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
        },

        async switchChain(parameters) {
          if (!attachedProvider) return
          await attachedProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(parameters.chainId) }],
          })
        },
      },
    }
  })
}

function installProviderBridge(options: { host: string; provider: dialog.Provider }) {
  const { host, provider } = options
  if (typeof window === 'undefined') return () => undefined

  const origin = new URL(host, window.location.origin).origin
  const messenger = Messenger.fromWindow(window, { targetOrigin: origin })

  async function onProviderRequest(
    payload: Messenger.Payload<'provider-request'>,
    event: MessageEvent,
    topic: 'provider-response' | 'signer-response',
  ) {
    const target = event.source as Window | null
    if (!target) return

    try {
      const result = await provider.request(payload.request)
      target.postMessage(
        {
          id: (event.data as { id: string }).id,
          payload: { result },
          topic,
        },
        event.origin,
      )
    } catch (error) {
      target.postMessage(
        {
          id: (event.data as { id: string }).id,
          payload: { error: serializeError(error) },
          topic,
        },
        event.origin,
      )
    }
  }

  const offProvider = messenger.on('provider-request', async (payload, event) =>
    onProviderRequest(payload, event, 'provider-response'),
  )
  const offSigner = messenger.on('signer-request', async (payload, event) =>
    onProviderRequest(payload, event, 'signer-response'),
  )

  return () => {
    offProvider()
    offSigner()
    messenger.destroy()
  }
}

function installProviderEventBridge(options: { provider: dialog.Provider; store: Store.Store }) {
  const { provider, store } = options
  if (!provider.on) return () => undefined

  const onAccountsChanged = (accounts: unknown) => {
    store.setState({
      accounts: toStoreAccounts(accounts),
      activeAccount: 0,
    })
  }
  const onChainChanged = (chainId: unknown) => {
    store.setState({ chainId: toChainId(chainId) })
  }
  const onDisconnect = () => {
    store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
  }

  provider.on('accountsChanged', onAccountsChanged)
  provider.on('chainChanged', onChainChanged)
  provider.on('disconnect', onDisconnect)

  return () => {
    provider.removeListener?.('accountsChanged', onAccountsChanged)
    provider.removeListener?.('chainChanged', onChainChanged)
    provider.removeListener?.('disconnect', onDisconnect)
  }
}

function serializeError(error: unknown): RpcResponse.ErrorObject {
  if (isProviderError(error)) return { code: error.code, message: error.message }
  if (error instanceof Error)
    return {
      code: -32603,
      message: error.message,
    }
  return {
    code: -32603,
    message: 'Provider request failed.',
  }
}

function isProviderError(error: unknown): error is { code: number; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

function toChainId(chainId: unknown) {
  if (typeof chainId === 'number') return chainId
  if (typeof chainId === 'string') return Number(chainId)
  throw new ox_Provider.UnsupportedChainIdError({ message: 'Invalid provider chain ID.' })
}

function toStoreAccounts(result: unknown): readonly Store.Account[] {
  if (Array.isArray(result))
    return result.map((account) => {
      if (typeof account === 'string') return { address: account as Address.Address }
      if (isAccountLike(account))
        return {
          ...account,
          address: account.address as Address.Address,
        }
      throw new ox_Provider.UnauthorizedError({ message: 'Provider returned an invalid account.' })
    })

  if (isAccountsResult(result)) return toStoreAccounts(result.accounts)
  return []
}

function isAccountsResult(result: unknown): result is { accounts: readonly unknown[] } {
  return (
    typeof result === 'object' &&
    result !== null &&
    'accounts' in result &&
    Array.isArray(result.accounts)
  )
}

function isAccountLike(account: unknown): account is Store.Account {
  return (
    typeof account === 'object' &&
    account !== null &&
    'address' in account &&
    typeof account.address === 'string'
  )
}

function withDelegatedProvider(host: string) {
  const url = new URL(
    host,
    typeof window === 'undefined' ? 'https://wallet.tempo.xyz' : window.location.origin,
  )
  url.searchParams.set('provider', 'delegated')
  url.searchParams.set('signer', 'delegated')
  return url.href
}

export declare namespace dialog {
  type Options = {
    /** Dialog to use for the embed app. @default `Dialog.iframe()` (or `Dialog.popup()` in Safari/insecure contexts) */
    dialog?: Dialog.Dialog | undefined
    /** URL of the embed app. @default `'https://wallet-next.tempo.xyz/remote'` */
    host?: string | undefined
    /** Data URI of the provider icon. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider. @default `'Tempo'` */
    name?: string | undefined
    /** Attached provider that owns accounts, chain state, and confirmed request execution. */
    provider?: Provider | undefined
    /** Reverse DNS identifier. @default `'xyz.tempo'` */
    rdns?: string | undefined
    /** Visual theme overrides for the wallet dialog. */
    theme?: Dialog.Theme | undefined
  }

  /** Provider attached to the Tempo dialog surface. */
  type Provider = {
    /** Subscribe to provider events. */
    on?: ((event: string, listener: (...args: readonly unknown[]) => void) => void) | undefined
    /** Remove a provider event listener. */
    removeListener?:
      | ((event: string, listener: (...args: readonly unknown[]) => void) => void)
      | undefined
    /** Execute an EIP-1193 request. */
    request: (request: { method: string; params?: unknown | undefined }) => Promise<unknown>
  }
}
