import { RpcRequest } from 'ox'

import type { Dialog, Session } from './consumer.js'
import type { Theme } from './types.js'

/** Dialog host URL-scoped request context. */
type Context = {
  /** Whether the provider attachment is still active. */
  attached: boolean
  /** Active dialog transport. */
  dialog: Session | undefined
  /** JSON-RPC request ID allocator. */
  ids: ReturnType<typeof RpcRequest.createStore>
  /** Number of active request promises owned by this attachment. */
  requests: number
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
    requests: 0,
  }

  context.dialog = options.dialog({
    getAccounts: options.getAccounts,
    getChainId: options.getChainId,
    host: options.host,
    onAccountsInvalid: options.onAccountsInvalid,
    theme: options.theme,
  })

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
async function request(context: Context, options: RequestOptions): Promise<unknown> {
  if (!context.attached) return Promise.reject(new Error('Dialog consumer attachment is detached.'))
  if (!context.dialog) return Promise.reject(new Error('Dialog consumer attachment is detached.'))

  const request = context.ids.prepare(options.request as never)
  context.requests++
  try {
    return await context.dialog.request({
      account: options.account,
      chainId: options.chainId,
      request: {
        request,
        status: 'pending',
      },
    })
  } finally {
    context.requests--
    release(context)
  }
}

/** Releases idle transport resources. */
function release(context: Context) {
  if (context.attached) return
  if (context.requests > 0) return

  context.dialog?.destroy()
  context.dialog = undefined
}
