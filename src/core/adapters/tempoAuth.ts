import { Provider as ox_Provider, RpcRequest as ox_RpcRequest } from 'ox'

import type { Adapter, setup } from '../Adapter.js'
import * as Dialog from '../Dialog.js'
import * as Schema from '../Schema.js'
import type * as Store from '../Store.js'

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
export function tempoAuth(options: tempoAuth.Options = {}): Adapter {
  const {
    dialog = Dialog.isSafari() ? Dialog.popup() : Dialog.iframe(),
    host = 'https://auth.tempo.xyz',
    icon,
    name = 'Tempo',
    rdns = 'xyz.tempo',
  } = options

  let store: Store.Store
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

  return {
    icon,
    name,
    rdns,
    setup(params: setup.Parameters) {
      store = params.store

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

      return () => {
        unsubscribe()
        dialogHandle?.destroy()
        dialogHandle = undefined
      }
    },
    actions: {
      async createAccount(_params, request) {
        const { accounts } = await provider.request(request)
        return { accounts: accounts.map((a) => ({ address: a.address })) }
      },

      async loadAccounts(_params, request) {
        const { accounts } = await provider.request(request)
        return { accounts: accounts.map((a) => ({ address: a.address })) }
      },

      async sendTransaction(_params, request) {
        return await provider.request(request)
      },

      async sendTransactionSync(_params, request) {
        return await provider.request(request)
      },

      async signTransaction(_params, request) {
        return await provider.request(request)
      },

      async signPersonalMessage(_params, request) {
        return await provider.request(request)
      },

      async signTypedData(_params, request) {
        return await provider.request(request)
      },

      async authorizeAccessKey(_params, request) {
        return await provider.request(request)
      },

      async revokeAccessKey(_params, request) {
        await provider.request(request)
      },

      async disconnect() {
        store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
      },
    },
  }
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
