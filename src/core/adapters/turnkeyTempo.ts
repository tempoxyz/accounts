import { Hex as ox_Hex, Provider as ox_Provider, RpcRequest as ox_RpcRequest } from 'ox'
import * as RpcResponse from 'ox/RpcResponse'
import { z } from 'zod/mini'

import * as Adapter from '../Adapter.js'
import * as Dialog from '../Dialog.js'
import * as Messenger from '../Messenger.js'
import * as Schema from '../Schema.js'
import type * as Store from '../Store.js'
import * as Request from '../zod/request.js'
import * as Rpc from '../zod/rpc.js'
import { turnkey } from './turnkey.js'

/**
 * Creates a Turnkey + Tempo surface adapter.
 *
 * Turnkey owns account connection, account provisioning, and disconnect
 * semantics. Tempo owns post-connect action consent and delegates confirmed
 * signing requests back to the Turnkey signer in the parent page.
 *
 * @example
 * ```ts
 * import { Provider, turnkeyTempo } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: turnkeyTempo({
 *     loadAccounts: async () => ({ accounts: [{ address: '0x...' }] }),
 *     signRawPayload: async (params) => turnkeyClient.signRawPayload(params),
 *   }),
 * })
 * ```
 */
export function turnkeyTempo(options: turnkeyTempo.Options = {}): Adapter.Adapter {
  const {
    dialog = Dialog.isInsecureContext() ? Dialog.popup() : Dialog.iframe(),
    host = 'https://wallet.tempo.xyz/embed',
    icon,
    name = 'Turnkey Tempo',
    rdns = 'xyz.tempo.turnkey',
  } = options

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { store } = parameters
    const signer = turnkey(options)(parameters)
    const signerProvider = createSignerProvider(signer.actions, store)
    const queuedProvider = createQueuedProvider(store)
    const dialogInstance = dialog({ host: withDelegatedSigner(host), store })
    const unsubscribe = store.subscribe(
      (x) => x.requestQueue,
      (requestQueue) => {
        const pending = requestQueue.filter(
          (x): x is Store.QueuedRequest & { status: 'pending' } => x.status === 'pending',
        )

        dialogInstance?.syncRequests(pending)
        if (pending.length === 0) dialogInstance?.close()
      },
    )
    const offSignerBridge = installSignerBridge({ host, signerProvider })

    return {
      cleanup() {
        unsubscribe()
        queuedProvider.unsubscribe()
        offSignerBridge()
        signer.cleanup?.()
        dialogInstance?.destroy()
      },
      actions: {
        async createAccount(parameters, request) {
          return await signer.actions.createAccount(parameters, request)
        },

        async loadAccounts(parameters, request) {
          return await signer.actions.loadAccounts(parameters, request)
        },

        async authorizeAccessKey(parameters, request) {
          return (await queuedProvider.request(
            requestWithEncodedAccessKey(parameters, request) as never,
          )) as never
        },

        async revokeAccessKey(_parameters, request) {
          await queuedProvider.request(request)
        },

        async deposit(_parameters, request) {
          return (await queuedProvider.request(request)) as never
        },

        async disconnect() {
          await signer.actions.disconnect?.()
        },

        async signPersonalMessage(_parameters, request) {
          return (await queuedProvider.request(request)) as never
        },

        async signTransaction(parameters, request) {
          return (await queuedProvider.request(
            requestWithEncodedTransaction(parameters, request) as never,
          )) as never
        },

        async signTypedData(_parameters, request) {
          return (await queuedProvider.request(request)) as never
        },

        async sendTransaction(parameters, request) {
          return (await queuedProvider.request(
            requestWithEncodedTransaction(parameters, request) as never,
          )) as never
        },

        async sendTransactionSync(parameters, request) {
          return (await queuedProvider.request(
            requestWithEncodedTransaction(parameters, request) as never,
          )) as never
        },

        async switchChain(parameters) {
          await signer.actions.switchChain?.(parameters)
        },
      },
    }
  })
}

export declare namespace turnkeyTempo {
  /** Adapter options for Turnkey-backed accounts with Tempo post-connect approval UI. */
  type Options = turnkey.Options & {
    /** Dialog to use for Tempo post-connect approval UI. @default `Dialog.iframe()` */
    dialog?: Dialog.Dialog | undefined
    /** URL of the Tempo remote app. @default `'https://wallet.tempo.xyz/embed'` */
    host?: string | undefined
  }
}

type SignerProvider = {
  request: (request: { method: string; params?: unknown | undefined }) => Promise<unknown>
}

type InstallSignerBridgeOptions = {
  host: string
  signerProvider: SignerProvider
}

function createQueuedProvider(store: Store.Store) {
  const listeners = new Set<(requestQueue: readonly Store.QueuedRequest[]) => void>()
  const requestStore = ox_RpcRequest.createStore()
  const unsubscribe = store.subscribe(
    (x) => x.requestQueue,
    (requestQueue) => {
      for (const listener of listeners) listener(requestQueue)
    },
  )

  function waitForQueuedRequest(requestId: number) {
    return new Promise((resolve, reject) => {
      const listener = (requestQueue: readonly Store.QueuedRequest[]) => {
        const queued = requestQueue.find((x) => x.request.id === requestId)

        if (!queued && requestQueue.length === 0) {
          listeners.delete(listener)
          reject(new ox_Provider.UserRejectedRequestError())
          return
        }

        if (!queued) return
        if (queued.status !== 'success' && queued.status !== 'error') return

        listeners.delete(listener)

        if (queued.status === 'success') resolve(queued.result)
        else reject(toProviderError(queued.error))

        store.setState((x) => ({
          ...x,
          requestQueue: x.requestQueue.filter((x) => x.request.id !== requestId),
        }))
      }

      listeners.add(listener)
      listener(store.getState().requestQueue)
    })
  }

  return Object.assign(
    ox_Provider.from(
      {
        async request(r) {
          const request = requestStore.prepare(r as never)

          store.setState((x) => ({
            ...x,
            requestQueue: [...x.requestQueue, { request, status: 'pending' as const }],
          }))

          return await waitForQueuedRequest(request.id)
        },
      },
      { schema: Schema.ox },
    ),
    { unsubscribe },
  )
}

function createSignerProvider(
  actions: Adapter.Instance['actions'],
  store: Store.Store,
): SignerProvider {
  return ox_Provider.from(
    {
      async request(r) {
        const request = Request.validate(Schema.Request, r)

        switch (request.method) {
          case 'eth_accounts':
            return store.getState().accounts.map((a) => a.address)

          case 'eth_chainId':
            return ox_Hex.fromNumber(store.getState().chainId)

          case 'eth_requestAccounts':
          case 'wallet_connect':
            throw new ox_Provider.UnsupportedMethodError({
              message: '`wallet_connect` is not supported by the Tempo signer bridge.',
            })

          case 'personal_sign': {
            const [data, address] = request._decoded.params
            return await actions.signPersonalMessage({ address, data }, request)
          }

          case 'eth_signTypedData_v4': {
            const [address, data] = request._decoded.params
            return await actions.signTypedData({ address, data }, request)
          }

          case 'eth_signTransaction': {
            const [decoded] = request._decoded.params
            return await actions.signTransaction(toTransactionParameters(decoded, store), request)
          }

          case 'eth_sendTransaction': {
            const [decoded] = request._decoded.params
            return await actions.sendTransaction(toTransactionParameters(decoded, store), request)
          }

          case 'eth_sendTransactionSync': {
            const [decoded] = request._decoded.params
            return await actions.sendTransactionSync(
              toTransactionParameters(decoded, store),
              request,
            )
          }

          case 'wallet_authorizeAccessKey': {
            if (!actions.authorizeAccessKey)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`authorizeAccessKey` not supported by adapter.',
              })
            const [decoded] = request._decoded.params
            return await actions.authorizeAccessKey(decoded, request)
          }

          case 'wallet_revokeAccessKey': {
            if (!actions.revokeAccessKey)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`revokeAccessKey` not supported by adapter.',
              })
            const [decoded] = request._decoded.params
            await actions.revokeAccessKey(decoded, request)
            return
          }

          case 'wallet_deposit': {
            if (!actions.deposit)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`deposit` not supported by adapter.',
              })
            const [decoded] = request._decoded.params
            return await actions.deposit(decoded, request)
          }

          case 'wallet_switchEthereumChain': {
            const { chainId } = request._decoded.params[0]
            await actions.switchChain?.({ chainId })
            store.setState({ chainId })
            return
          }
        }

        throw new ox_Provider.UnsupportedMethodError({
          message: `Unsupported signer bridge method "${request.method}".`,
        })
      },
    },
    { schema: Schema.ox },
  )
}

function installSignerBridge(options: InstallSignerBridgeOptions) {
  const { host, signerProvider } = options
  if (typeof window === 'undefined') return () => undefined

  const origin = new URL(host).origin
  const messenger = Messenger.fromWindow(window, { targetOrigin: origin })
  const off = messenger.on('signer-request', async (payload, event) => {
    const target = event.source as Window | null
    if (!target) return

    try {
      const result = await signerProvider.request(payload.request)
      target.postMessage(
        {
          id: (event.data as { id: string }).id,
          payload: { result },
          topic: 'signer-response',
        },
        event.origin,
      )
    } catch (error) {
      target.postMessage(
        {
          id: (event.data as { id: string }).id,
          payload: { error: serializeError(error) },
          topic: 'signer-response',
        },
        event.origin,
      )
    }
  })

  return () => {
    off()
    messenger.destroy()
  }
}

function requestWithEncodedAccessKey(
  parameters: Adapter.authorizeAccessKey.Parameters,
  request: {
    method: 'wallet_authorizeAccessKey'
    originMethod?: string | undefined
    params: Rpc.wallet_authorizeAccessKey.Encoded['params']
  },
) {
  return {
    ...request,
    params: [z.encode(Rpc.wallet_authorizeAccessKey.parameters, parameters)!] as const,
  }
}

function requestWithEncodedTransaction(
  parameters: Adapter.signTransaction.Parameters,
  request:
    | Parameters<Adapter.Instance['actions']['sendTransaction']>[1]
    | Parameters<Adapter.Instance['actions']['sendTransactionSync']>[1]
    | Parameters<Adapter.Instance['actions']['signTransaction']>[1],
) {
  return {
    ...request,
    params: [z.encode(Rpc.transactionRequest, parameters)] as const,
  }
}

function toTransactionParameters(
  decoded: Adapter.signTransaction.Parameters & { to?: unknown | undefined },
  store: Store.Store,
): Adapter.signTransaction.Parameters {
  const { data, to, ...rest } = decoded
  const calls = decoded.calls ?? (to ? [{ to, data, value: decoded.value }] : undefined)
  return {
    ...rest,
    chainId: decoded.chainId ?? store.getState().chainId,
    ...(calls ? { calls: calls as never } : {}),
  }
}

function withDelegatedSigner(host: string) {
  const url = new URL(host)
  url.searchParams.set('signer', 'delegated')
  return url.toString()
}

function toProviderError(error: RpcResponse.ErrorObject) {
  return Object.assign(new Error(error.message), {
    code: error.code,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

function serializeError(error: unknown): RpcResponse.ErrorObject {
  if (isProviderError(error)) {
    const { code, data, message } = error
    return {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    }
  }

  if (error instanceof Error) return { code: -32603, message: error.message }
  return { code: -32603, message: 'Internal error.' }
}

function isProviderError(
  error: unknown,
): error is Error & { code: number; data?: unknown | undefined } {
  if (!(error instanceof Error)) return false
  if (!('code' in error)) return false
  return typeof error.code === 'number'
}
