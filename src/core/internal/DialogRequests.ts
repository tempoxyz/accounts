import { Provider as ox_Provider, RpcRequest } from 'ox'

import type * as Dialog from '../Dialog.js'
import type * as core_Store from '../Store.js'

/** Request stored by the host request coordinator. */
type StoredRequest = {
  /** Active account captured from the provider that enqueued the request. */
  account: { address: string } | undefined
  /** Chain ID captured from the provider that enqueued the request. */
  chainId: number
  /** Rejects the provider request promise. */
  reject: (error: Error) => void
  /** JSON-RPC request sent to the dialog host. */
  request: RpcRequest.RpcRequest
  /** Resolves the provider request promise. */
  resolve: (result: unknown) => void
  /** Request is waiting for a dialog response. */
  status: 'pending'
  /** Whether this pending request has been synced to the dialog UI. */
  synced: boolean
}

/** Host-scoped dialog request context. */
type Context = {
  /** Active provider attachments. */
  attachments: Set<symbol>
  /** Active dialog transport. */
  dialog: Dialog.Instance | undefined
  /** JSON-RPC request ID allocator. */
  ids: ReturnType<typeof RpcRequest.createStore>
  /** In-memory pending request queue. */
  requestQueue: StoredRequest[]
  /** Whether pending work has been synced since the last empty queue. */
  synced: boolean
}

/** Provider attachment options for a host request coordinator. */
export type AttachOptions = {
  /** Dialog implementation used to communicate with the host app. */
  dialog: Dialog.Dialog
  /** Dialog host URL. */
  host: string
  /** Provider store used by the dialog transport for account sync and referrer setup. */
  store: core_Store.Store
  /** Visual theme overrides applied to the embed. */
  theme?: Dialog.Theme | undefined
}

/** Dialog request enqueue options. */
export type RequestOptions = {
  /** Active account captured from the provider enqueueing the request. */
  account: { address: string } | undefined
  /** Active chain ID captured from the provider enqueueing the request. */
  chainId: number
  /** Provider RPC request input. */
  request: unknown
}

const contexts = new Map<string, Context>()

/** Attaches a provider to the host request coordinator and starts the transport driver. */
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

  if (changed) for (const request of context.requestQueue) request.synced = false

  sync(host)

  return () => {
    context.attachments.delete(attachment)
    release(host)
  }
}

/** Enqueues an RPC request in the host request coordinator and waits for completion. */
export function request(host: string, options: RequestOptions): Promise<unknown> {
  const context = get(host)
  const request = context.ids.prepare(options.request as never)

  return new Promise((resolve, reject) => {
    context.requestQueue.push({
      account: options.account,
      chainId: options.chainId,
      reject,
      request,
      resolve,
      status: 'pending',
      synced: false,
    })
    sync(host)
  })
}

/** Clears a host-scoped request coordinator. */
export function reset(host: string): void {
  const context = contexts.get(key(host))
  context?.dialog?.destroy()
  contexts.delete(key(host))
}

/** Converts a host URL into a request coordinator key. */
function key(host: string): string {
  return new URL(host).host
}

/** Returns the request context shared by adapters on the same host. */
function get(host: string): Context {
  const key_ = key(host)
  const current = contexts.get(key_)
  if (current) return current
  const context = {
    attachments: new Set<symbol>(),
    dialog: undefined,
    ids: RpcRequest.createStore(),
    requestQueue: [],
    synced: false,
  }
  contexts.set(key_, context)
  return context
}

/** Releases idle transport resources. */
function release(host: string) {
  const context = get(host)
  if (context.attachments.size > 0) return
  if (context.requestQueue.length > 0) return

  context.dialog?.destroy()
  context.dialog = undefined
  context.synced = false
}

/** Marks displayed pending requests as rejected. */
function reject(host: string, ids: readonly number[]) {
  if (ids.length === 0) return
  const context = get(host)
  const ids_ = new Set(ids)
  const rejected = context.requestQueue.filter((queued) => ids_.has(queued.request.id))
  if (rejected.length === 0) return

  context.requestQueue = context.requestQueue.filter((queued) => !ids_.has(queued.request.id))
  for (const request of rejected) request.reject(new ox_Provider.UserRejectedRequestError())
  sync(host, { force: true })
}

/** Resolves or rejects a pending request with an RPC response from the dialog UI. */
function respond(
  host: string,
  response: { id: number; result?: unknown; error?: { code: number; message: string } | undefined },
) {
  const context = get(host)
  const queued = context.requestQueue.find((queued) => queued.request.id === response.id)
  if (!queued) return

  context.requestQueue = context.requestQueue.filter((queued) => queued.request.id !== response.id)
  if (response.error) queued.reject(ox_Provider.parseError(response.error))
  else queued.resolve(response.result)
  sync(host, { force: true })
}

/** Syncs newly pending requests to the dialog. */
function sync(host: string, options: sync.Options = {}) {
  const context = get(host)
  const dialog = context.dialog
  if (!dialog) return

  const pending = context.requestQueue
  if (pending.length === 0) {
    if (context.synced) dialog.close()
    context.synced = false
    release(host)
    return
  }

  const request = pending[0]!
  if (!options.force && request.synced) return
  request.synced = true

  context.synced = true
  dialog.syncRequests({
    account: request.account,
    chainId: request.chainId,
    requests: [toRequest(request)],
  })
}

declare namespace sync {
  type Options = {
    /** Whether to send the current pending queue even when all requests were previously synced. */
    force?: boolean | undefined
  }
}

/** Removes local metadata before syncing requests to the dialog UI. */
function toRequest(request: StoredRequest): Dialog.Request {
  return {
    request: request.request,
    status: request.status,
  }
}
