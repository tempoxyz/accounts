import { Provider as ox_Provider, RpcRequest } from 'ox'

import type { Dialog, Session } from './consumer.js'
import type { Request, Theme } from './types.js'

/** Request stored by the consumer-side dialog coordinator. */
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

/** Dialog host URL-scoped request context. */
type Context = {
  /** Whether the provider attachment is still active. */
  attached: boolean
  /** Active dialog transport. */
  dialog: Session | undefined
  /** JSON-RPC request ID allocator. */
  ids: ReturnType<typeof RpcRequest.createStore>
  /** In-memory pending request queue. */
  requestQueue: StoredRequest[]
  /** Whether pending work has been synced since the last empty queue. */
  synced: boolean
}

/** Provider attachment options for the consumer-side dialog coordinator. */
export type AttachOptions = {
  /** Dialog implementation used to communicate with the host app. */
  dialog: Dialog
  /** Returns locally known account addresses for host-side session validation. */
  getAccounts: () => readonly { address: string }[]
  /** Returns the active chain ID used to initialize the dialog host. */
  getChainId: () => number
  /** Dialog host URL. */
  host: string
  /** Called when the dialog host reports that locally stored accounts are invalid. */
  onAccountsInvalid: () => void
  /** Visual theme overrides applied to the embed. */
  theme?: Theme | undefined
}

/** Active provider attachment to a dialog consumer surface. */
export type Attachment = {
  /** Detaches the provider from the dialog consumer surface. */
  detach: () => void
  /** Enqueues an RPC request and waits for the dialog host response. */
  request: (options: RequestOptions) => Promise<unknown>
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

/** Attaches a provider to the consumer-side dialog coordinator. */
export function attach(options: AttachOptions): Attachment {
  const context: Context = {
    attached: true,
    dialog: undefined,
    ids: RpcRequest.createStore(),
    requestQueue: [],
    synced: false,
  }

  context.dialog = options.dialog({
    getAccounts: options.getAccounts,
    getChainId: options.getChainId,
    host: options.host,
    onAccountsInvalid: options.onAccountsInvalid,
    onReject: (ids) => reject(context, ids),
    onResponse: (response) => respond(context, response),
    theme: options.theme,
  })

  sync(context)

  return {
    detach() {
      if (!context.attached) return
      context.attached = false
      release(context)
    },
    request(options) {
      return request(context, options)
    },
  }
}

/** Enqueues an RPC request in the consumer-side dialog coordinator. */
function request(context: Context, options: RequestOptions): Promise<unknown> {
  if (!context.attached) return Promise.reject(new Error('Dialog consumer attachment is detached.'))
  if (!context.dialog) return Promise.reject(new Error('Dialog consumer attachment is detached.'))

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
    sync(context)
  })
}

/** Releases idle transport resources. */
function release(context: Context) {
  if (context.attached) return
  if (context.requestQueue.length > 0) return

  context.dialog?.destroy()
  context.dialog = undefined
  context.synced = false
}

/** Marks displayed pending requests as rejected. */
function reject(context: Context, ids: readonly number[]) {
  if (ids.length === 0) return
  const ids_ = new Set(ids)
  const rejected = context.requestQueue.filter((queued) => ids_.has(queued.request.id))
  if (rejected.length === 0) return

  context.requestQueue = context.requestQueue.filter((queued) => !ids_.has(queued.request.id))
  for (const request of rejected) request.reject(new ox_Provider.UserRejectedRequestError())
  sync(context, { force: true })
}

/** Resolves or rejects a pending request with an RPC response from the dialog UI. */
function respond(
  context: Context,
  response: { id: number; result?: unknown; error?: { code: number; message: string } | undefined },
) {
  const queued = context.requestQueue.find((queued) => queued.request.id === response.id)
  if (!queued) return

  context.requestQueue = context.requestQueue.filter((queued) => queued.request.id !== response.id)
  if (response.error) queued.reject(ox_Provider.parseError(response.error))
  else queued.resolve(response.result)
  sync(context, { force: true })
}

/** Syncs newly pending requests to the dialog. */
function sync(context: Context, options: sync.Options = {}) {
  const pending = context.requestQueue
  if (pending.length === 0) {
    if (context.synced) context.dialog?.close()
    context.synced = false
    release(context)
    return
  }
  if (!context.dialog) return

  const request = pending[0]!
  if (!options.force && request.synced) return
  request.synced = true

  context.synced = true
  context.dialog.syncRequests({
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
function toRequest(request: StoredRequest): Request {
  return {
    request: request.request,
    status: request.status,
  }
}
