import { Provider as core_Provider } from 'ox'
import { PostMessage, Transport, Wata, postMessage as core_postMessage } from 'wata'

import type * as Adapter from '../../Adapter.js'
import { fromRequest } from '../internal/fromRequest.js'
import * as Mount from './mount.js'

/**
 * Creates a postMessage adapter that forwards wallet RPC through a Wata
 * postMessage session.
 *
 * One provider holds one session to one wallet window. The wallet page
 * mounts in a hidden overlay iframe by default (a popup where iframes
 * can't work — see {@link Mount.auto}), surfaces while requests are
 * pending, and is put away once the queue drains: the iframe hides, a
 * popup closes. Dismissing the UI or closing the window rejects the
 * in-flight request; `wallet_disconnect` tears the session down.
 *
 * When the wallet detects its iframe is occluded it asks to continue in a
 * popup; the adapter remounts and re-sends the in-flight request there.
 */
export function postMessage(options: postMessage.Options): Adapter.Adapter {
  const { close, host, name, rdns, target } = options

  let mount: Mount.Mount | undefined
  let pending = 0
  let queue: Promise<unknown> = Promise.resolve()
  let resend = false
  let session: ReturnType<typeof create> | undefined
  /** The wallet asked to continue in a popup; stick to it for this provider. */
  let sticky_popup = false

  function ensure(): NonNullable<typeof session> {
    if (session) return session
    if (target) {
      session = create({ close, host: hostUrl(host), target })
      return session
    }
    const factory = sticky_popup ? Mount.popup() : (options.mount ?? Mount.auto())
    const mount_ = factory({
      host: hostUrl(host, factory.mode),
      onDismiss: cancel,
      onInvalidate: () => void session?.close(),
    })
    mount = mount_
    session = create({
      close: (handle) => mount_.close(handle),
      host: hostUrl(host, mount_.mode),
      target: () => mount_.target(),
    })
    return session
  }

  function create(transport: {
    close: ((handle: Window | MessagePort) => void | Promise<void>) | undefined
    host: string
    target: NonNullable<postMessage.Options['target']>
  }) {
    const wata = Wata.create({
      transports: [
        core_postMessage({
          host: transport.host,
          ...(transport.close ? { close: transport.close } : {}),
          async target(parameters) {
            const acquired = await transport.target(parameters)
            if (!acquired)
              throw new PostMessage.PopupBlockedError('the wallet page popup was blocked')
            return acquired
          },
        }),
      ],
    })
    wata.on('notification', (event) => {
      if (event.method === 'dialog_switchMode') void switchToPopup()
    })
    return wata
  }

  /**
   * Remounts the session in a popup at the wallet's request (occluded
   * iframe). Closing the old session rejects the in-flight send, which
   * `send` then replays over the popup session.
   */
  async function switchToPopup() {
    if (sticky_popup || target) return
    sticky_popup = true
    resend = pending > 0
    const mount_old = mount
    const session_old = session
    mount = undefined
    session = undefined
    mount_old?.destroy()
    await session_old?.close()
  }

  /** Dismissal from the mount UI — asks the wallet to reject, then hides. */
  function cancel() {
    void session?.notify({ method: 'dialog_cancel', params: [] })
    mount?.hide()
  }

  async function send(request: { method: string; params?: readonly unknown[] | undefined }) {
    for (;;) {
      const wata = ensure()
      mount?.show()
      try {
        return (await wata.send({ method: request.method, params: request.params ?? [] })).result
      } catch (error) {
        if (error instanceof Transport.ClosedError) {
          // The wallet asked to continue in a popup — replay there.
          if (resend) {
            resend = false
            continue
          }
          // Otherwise the wallet window closing is the user backing out.
          throw new core_Provider.UserRejectedRequestError()
        }
        throw error
      }
    }
  }

  // Warm the wallet page and wata handshake before the first request.
  // Popups can't pre-open, so only iframe mounts start eagerly.
  if (typeof window !== 'undefined' && !target && document.body) {
    ensure()
    if (mount?.mode === 'iframe') void session?.start().catch(() => {})
  }

  return fromRequest({
    name,
    rdns,
    async close() {
      await session?.close()
      mount?.hide()
    },
    cleanup() {
      void session?.close()
      mount?.destroy()
      mount = undefined
    },
    request(request) {
      pending += 1
      const result = queue.then(() => send(request))
      queue = result.catch(() => undefined)
      void result.catch(() => undefined).finally(() => {
        pending -= 1
        if (pending === 0) mount?.hide()
      })
      return result
    },
  })
}

export declare namespace postMessage {
  /** Options for {@link postMessage}. */
  export type Options = {
    /**
     * Cleanup for a `target`-acquired handle, called when the session
     * closes. Only used with {@link Options.target}; mounts own their
     * handle cleanup. @default `handle.close()`
     */
    close?: ((handle: Window | MessagePort) => void | Promise<void>) | undefined
    /** URL of the wallet's post-message page. */
    host: string
    /**
     * Where the wallet page lives and how it surfaces for requests.
     * @default `Mount.auto()` — an overlay iframe, or a popup where
     * iframes can't work (insecure context, Safari, no IO v2).
     */
    mount?: Mount.Factory | undefined
    /** Provider display name. */
    name: string
    /** Reverse-DNS provider identifier. */
    rdns: string
    /**
     * Low-level override for the session's window handle, bypassing
     * mounts entirely (no UI is created). Receives the page URL and
     * returns a `Window` or `MessagePort`. A nullish handle rejects the
     * request with `PostMessage.PopupBlockedError`.
     */
    target?:
      | ((parameters: {
          /** Wallet page URL to mount. */
          host: string | undefined
        }) =>
          | PostMessage.Target
          | null
          | undefined
          | Promise<PostMessage.Target | null | undefined>)
      | undefined
  }
}

/**
 * Tags the wallet page URL with this app's origin — so the wallet can pin
 * its `postMessage` responses before the first frame arrives — and the
 * mount mode, so approvals render matching chrome from first paint. A page
 * claiming a foreign origin gains nothing: the wallet only honors frames
 * whose event origin matches the pinned value.
 *
 * Non-browser sessions (e.g. `MessagePort` targets in tests) carry no
 * origin, so the URL is passed through untouched.
 */
function hostUrl(host: string, mode?: 'iframe' | 'popup'): string {
  if (typeof window === 'undefined') return host
  const url = new URL(host)
  url.searchParams.set('origin', window.location.origin)
  if (mode) url.searchParams.set('mode', mode)
  return url.toString()
}
