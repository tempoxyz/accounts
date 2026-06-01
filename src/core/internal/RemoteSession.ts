import { Provider as ox_Provider, RpcRequest } from 'ox'
import type { Mutate } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'

import type * as Dialog from '../Dialog.js'
import type * as core_Store from '../Store.js'
import type * as RemoteRequest from './RemoteRequest.js'

/** Host-scoped remote session state. */
type State = {
  /** Queued RPC requests pending remote lifecycle updates. */
  requestQueue: readonly StoredRequest[]
}

/** In-memory host session store. */
type Store = Mutate<StoreApi<State>, [['zustand/subscribeWithSelector', never]]>

/** Request stored by the host remote session. */
type StoredRequest<result = unknown> = RemoteRequest.Request<result> & {
  /** Active account captured from the provider that enqueued the request. */
  account: { address: string } | undefined
  /** Chain ID captured from the provider that enqueued the request. */
  chainId: number
  /** Whether this pending request has been synced to the remote UI. */
  synced: boolean
}

/** Host-scoped remote session context. */
type Context = {
  /** Active provider attachments. */
  attachments: Set<symbol>
  /** Active dialog transport. */
  dialog: Dialog.Instance | undefined
  /** JSON-RPC request ID allocator. */
  ids: ReturnType<typeof RpcRequest.createStore>
  /** Whether pending work has been synced since the last empty queue. */
  synced: boolean
  /** In-memory request queue. */
  store: Store
  /** Request queue sync driver unsubscribe function. */
  unsubscribe: (() => void) | undefined
}

/** Provider attachment options for a host remote session. */
export type AttachOptions = {
  /** Dialog implementation used to communicate with the remote app. */
  dialog: Dialog.Dialog
  /** Remote host URL. */
  host: string
  /** Provider store used by the dialog transport for account sync and referrer setup. */
  store: core_Store.Store
  /** Visual theme overrides applied to the embed. */
  theme?: Dialog.Theme | undefined
}

/** Remote request enqueue options. */
export type RequestOptions = {
  /** Active account captured from the provider enqueueing the request. */
  account: { address: string } | undefined
  /** Active chain ID captured from the provider enqueueing the request. */
  chainId: number
  /** Provider RPC request input. */
  request: unknown
}

/** Creates an in-memory store for remote session coordination. */
function create(): Store {
  return createStore(
    subscribeWithSelector<State>(() => ({
      requestQueue: [],
    })),
  )
}

const contexts = new Map<string, Context>()

/** Attaches a provider to the host remote session and starts the transport driver. */
export function attach(host: string, options: AttachOptions): () => void {
  const context = get(host)
  const attachment = Symbol()
  context.attachments.add(attachment)

  const next = options.dialog({
    host: options.host,
    onReject: (ids) => reject(host, ids),
    onResponse: (response) => respond(host, response),
    store: options.store,
    theme: options.theme,
  })

  const changed = Boolean(context.dialog && context.dialog !== next)
  if (context.dialog && context.dialog !== next) context.dialog.destroy()
  context.dialog = next

  if (changed)
    context.store.setState((x) => ({
      ...x,
      requestQueue: x.requestQueue.map((queued) =>
        queued.status === 'pending' ? { ...queued, synced: false } : queued,
      ),
    }))

  if (!context.unsubscribe)
    context.unsubscribe = context.store.subscribe(
      (x) => x.requestQueue,
      () => sync(host),
    )

  sync(host)

  return () => {
    context.attachments.delete(attachment)
    release(host)
  }
}

/** Enqueues an RPC request in the host remote session and waits for completion. */
export function request(host: string, options: RequestOptions): Promise<unknown> {
  const context = get(host)
  const request = context.ids.prepare(options.request as never)

  context.store.setState((x) => ({
    ...x,
    requestQueue: [
      ...x.requestQueue,
      {
        account: options.account,
        chainId: options.chainId,
        request,
        status: 'pending' as const,
        synced: false,
      },
    ],
  }))

  return wait(host, request.id)
}

/** Clears a host-scoped remote session. */
export function reset(host: string): void {
  const context = contexts.get(key(host))
  context?.dialog?.destroy()
  context?.unsubscribe?.()
  contexts.delete(key(host))
}

/** Returns the internal request context shared by remotes on the same host. */
export function get(host: string): Context {
  const key_ = key(host)
  const current = contexts.get(key_)
  if (current) return current
  const context = {
    attachments: new Set<symbol>(),
    dialog: undefined,
    ids: RpcRequest.createStore(),
    store: create(),
    synced: false,
    unsubscribe: undefined,
  }
  contexts.set(key_, context)
  return context
}

/** Converts a host URL into a remote session key. */
function key(host: string): string {
  return new URL(host).host
}

/** Releases idle session transport resources. */
function release(host: string) {
  const context = get(host)
  if (context.attachments.size > 0) return
  if (context.store.getState().requestQueue.some((x) => x.status === 'pending')) return

  context.dialog?.destroy()
  context.unsubscribe?.()
  context.dialog = undefined
  context.unsubscribe = undefined
  context.synced = false
}

/** Marks displayed pending requests as rejected. */
function reject(host: string, ids: readonly number[]) {
  if (ids.length === 0) return
  const context = get(host)
  const ids_ = new Set(ids)
  context.store.setState((x) => ({
    ...x,
    requestQueue: x.requestQueue.map((queued) =>
      queued.status === 'pending' && ids_.has(queued.request.id)
        ? {
            account: queued.account,
            chainId: queued.chainId,
            error: { code: 4001, message: 'User rejected the request.' },
            request: queued.request,
            status: 'error' as const,
            synced: queued.synced,
          }
        : queued,
    ),
  }))
}

/** Updates the request queue with an RPC response from the remote UI. */
function respond(
  host: string,
  response: { id: number; result?: unknown; error?: { code: number; message: string } | undefined },
) {
  const context = get(host)
  context.store.setState((x) => ({
    ...x,
    requestQueue: x.requestQueue.map((queued) => {
      if (queued.request.id !== response.id) return queued
      if (response.error)
        return {
          account: queued.account,
          chainId: queued.chainId,
          error: response.error,
          request: queued.request,
          status: 'error' as const,
          synced: queued.synced,
        }
      return {
        account: queued.account,
        chainId: queued.chainId,
        request: queued.request,
        result: response.result,
        status: 'success' as const,
        synced: queued.synced,
      }
    }),
  }))
}

/** Syncs newly pending host requests to the remote dialog. */
function sync(host: string) {
  const context = get(host)
  const dialog = context.dialog
  if (!dialog) return

  const { requestQueue } = context.store.getState()
  const pending = requestQueue.filter((x) => x.status === 'pending')

  if (pending.length === 0) {
    if (context.synced) dialog.close()
    context.synced = false
    release(host)
    return
  }

  const unsynced = pending.filter((x) => !x.synced)
  if (unsynced.length === 0) return

  const ids = new Set(unsynced.map((x) => x.request.id))
  context.store.setState((x) => ({
    ...x,
    requestQueue: x.requestQueue.map((queued) =>
      queued.status === 'pending' && ids.has(queued.request.id)
        ? { ...queued, synced: true }
        : queued,
    ),
  }))

  const request = pending[0]!
  context.synced = true
  dialog.syncRequests({
    account: request.account,
    chainId: request.chainId,
    requests: pending.map(
      ({ account: _account, chainId: _chainId, synced: _synced, ...request }) => request,
    ),
  })
}

/** Waits for a queued request to be resolved via the host session store. */
function wait(host: string, requestId: number) {
  const context = get(host)
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const check = () => {
      const { requestQueue } = context.store.getState()
      const queued = requestQueue.find((x) => x.request.id === requestId)

      if (!queued && requestQueue.length === 0) {
        unsubscribe()
        reject(new ox_Provider.UserRejectedRequestError())
        release(host)
        return
      }

      if (!queued) return
      if (queued.status !== 'success' && queued.status !== 'error') return

      unsubscribe()

      if (queued.status === 'success') resolve(queued.result)
      else reject(ox_Provider.parseError(queued.error))

      context.store.setState((x) => ({
        ...x,
        requestQueue: x.requestQueue.filter((x) => x.request.id !== requestId),
      }))
      release(host)
    }

    unsubscribe = context.store.subscribe((x) => x.requestQueue, check)
    check()
  })
}
