import { Provider as core_Provider } from 'ox'
import { PostMessage, Transport, Wata, postMessage as core_postMessage } from 'wata'

import type * as Adapter from '../../Adapter.js'
import { fromRequest } from '../internal/fromRequest.js'

/**
 * Creates a postMessage adapter that forwards wallet RPC through a Wata
 * postMessage session.
 *
 * One provider holds one session to one wallet window. The wallet page (a
 * centered popup by default) mounts on the first request and stays bound to
 * the session: sequential requests reuse the open window, navigating it
 * from one approval to the next. Closing the window rejects the in-flight
 * request; the next request mounts a fresh one. `wallet_disconnect` tears
 * the session down.
 */
export function postMessage(options: postMessage.Options): Adapter.Adapter {
  const { close, host, name, rdns, target } = options

  let handle: Window | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let session: ReturnType<typeof create> | undefined

  function create() {
    return Wata.create({
      transports: [
        core_postMessage({
          host: hostUrl(host),
          ...(close ? { close } : {}),
          async target(parameters) {
            const acquired = await (target ?? popup)(parameters)
            if (!acquired)
              throw new PostMessage.PopupBlockedError('the wallet page popup was blocked')
            handle = focusable(acquired) ? acquired : undefined
            return acquired
          },
        }),
      ],
    })
  }

  async function send(request: { method: string; params?: readonly unknown[] | undefined }) {
    session ??= create()
    // Surface the already-open wallet window so the new request is seen.
    if (handle && !handle.closed) handle.focus()
    try {
      return (await session.send({ method: request.method, params: request.params ?? [] })).result
    } catch (error) {
      // The wallet window closing without an answer is the user backing out.
      if (error instanceof Transport.ClosedError) throw new core_Provider.UserRejectedRequestError()
      throw error
    }
  }

  return fromRequest({
    name,
    rdns,
    async close() {
      await session?.close()
    },
    request(request) {
      // The wallet window shows one approval at a time, so overlapping
      // calls wait for the previous request to settle.
      const result = queue.then(() => send(request))
      queue = result.catch(() => undefined)
      return result
    },
  })
}

export declare namespace postMessage {
  /** Options for {@link postMessage}. */
  export type Options = {
    /**
     * Cleanup for the mounted handle, called when the session closes.
     * @default `handle.close()`
     */
    close?: ((handle: Window | MessagePort) => void | Promise<void>) | undefined
    /** URL of the wallet's post-message page. */
    host: string
    /** Provider display name. */
    name: string
    /** Reverse-DNS provider identifier. */
    rdns: string
    /**
     * Override how the wallet page is mounted. Called when the session
     * (re-)opens; receives the page URL and returns a `Window` or
     * `MessagePort` handle. A nullish handle (e.g. a blocked `window.open`)
     * rejects the request with `PostMessage.PopupBlockedError`.
     * @default Opens a centered popup window.
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
 * Tags the wallet page URL with this app's origin so the wallet can pin its
 * `postMessage` responses before the first frame arrives. A page claiming a
 * foreign origin gains nothing: the wallet only honors frames whose event
 * origin matches the pinned value.
 *
 * Non-browser sessions (e.g. `MessagePort` targets in tests) carry no
 * origin, so the URL is passed through untouched.
 */
function hostUrl(host: string): string {
  if (typeof window === 'undefined') return host
  const url = new URL(host)
  url.searchParams.set('origin', window.location.origin)
  return url.toString()
}

function focusable(value: PostMessage.Target): value is Window {
  return 'closed' in value && typeof (value as Window).focus === 'function'
}

const size = { height: 440, width: 360 }

function popup({ host }: { host: string | undefined }): Window | null {
  if (!host) throw new PostMessage.InvalidHostError('postMessage adapter requires a `host` URL')
  const left = (window.innerWidth - size.width) / 2 + window.screenX
  const top = window.screenY + 100
  return window.open(
    host,
    '_blank',
    `width=${size.width},height=${size.height},left=${left},top=${top}`,
  )
}
