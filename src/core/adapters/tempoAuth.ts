import { Address, Provider as ox_Provider, RpcRequest as ox_RpcRequest } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount } from 'viem/tempo'
import { z } from 'zod/mini'

import * as AccessKey from '../AccessKey.js'
import * as Adapter from '../Adapter.js'
import * as Dialog from '../Dialog.js'
import * as Schema from '../Schema.js'
import type * as Store from '../Store.js'
import * as Rpc from '../zod/rpc.js'

/**
 * Creates a dialog adapter that delegates signing to a remote Tempo Auth app
 * via an iframe or popup dialog.
 *
 * @example
 * ```ts
 * import { tempoAuth, Provider } from '@tempoxyz/accounts'
 *
 * const provider = Provider.create({
 *   adapter: tempoAuth(),
 * })
 * ```
 */
export function tempoAuth(options: tempoAuth.Options = {}): Adapter.Adapter {
  const {
    dialog = Dialog.isSafari() ? Dialog.popup() : Dialog.iframe(),
    host = 'https://auth.tempo.xyz',
    icon,
    name = 'Tempo',
    rdns = 'xyz.tempo',
  } = options

  return Adapter.define({ icon, name, rdns }, ({ getAccount, getClient, store }) => {
    let dialogHandle: Dialog.setup.ReturnType | undefined

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
      AccessKey.save({ address: address, keyAuthorization, keyPair, store })
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
        } catch (error) {
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
      } catch (error) {
        if (AccessKey.isExecutionError(error)) AccessKey.remove(account, { store })
        return undefined
      }
    }

    dialogHandle = dialog.setup({ host, store })

    // Sync store → dialog: whenever the request queue changes, notify
    // listeners and sync pending requests to the dialog.
    const unsubscribe = store.subscribe(
      (x) => x.requestQueue,
      (requestQueue) => {
        for (const listener of listeners) listener(requestQueue)

        const pending = requestQueue.filter(
          (x): x is Store.QueuedRequest & { status: 'pending' } => x.status === 'pending',
        )

        dialogHandle?.syncRequests(pending)
        if (pending.length === 0) dialogHandle?.close()
      },
    )

    return {
      cleanup() {
        unsubscribe()
        dialogHandle?.destroy()
        dialogHandle = undefined
      },
      actions: {
        async createAccount(parameters, request) {
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
              feePayer: typeof feePayer === 'string' ? feePayer : undefined,
            })
            const prepared = await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
              keyAuthorization,
              type: 'tempo',
            })
            return await account.signTransaction(prepared as never)
          })
          if (result !== undefined) return result
          return await provider.request(request)
        },

        async signTypedData(_params, request) {
          return await provider.request(request)
        },

        async sendTransaction(parameters, request) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const client = getClient({
              feePayer: typeof feePayer === 'string' ? feePayer : undefined,
            })
            const prepared = await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
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
          return await provider.request(request)
        },

        async sendTransactionSync(parameters, request) {
          const result = await withAccessKey(async (account, keyAuthorization) => {
            const { feePayer, ...rest } = parameters
            const client = getClient({
              feePayer: typeof feePayer === 'string' ? feePayer : undefined,
            })
            const prepared = await prepareTransactionRequest(client, {
              account,
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
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
          return await provider.request(request)
        },

        async authorizeAccessKey(parameters, request) {
          const accessKey = await generateAccessKey(parameters)

          const result = await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_connect.authorizeAccessKey, accessKey!.request)!],
          })

          if (accessKey) {
            const account = getAccount({ accessKey: false, signable: false })
            saveAccessKey(account.address, result, accessKey.keyPair)
          }

          return result
        },

        async revokeAccessKey(_params, request) {
          await provider.request(request)
        },

        async disconnect() {
          store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
        },
      },
    }
  })
}

export declare namespace tempoAuth {
  type Options = {
    /** Dialog to use for the auth app. @default `Dialog.iframe()` (or `Dialog.popup()` in Safari) */
    dialog?: Dialog.Dialog | undefined
    /** URL of the Tempo Auth app. @default `'https://auth.tempo.xyz'` */
    host?: string | undefined
    /** Data URI of the provider icon. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider. @default `'Tempo'` */
    name?: string | undefined
    /** Reverse DNS identifier. @default `'xyz.tempo'` */
    rdns?: string | undefined
  }
}
