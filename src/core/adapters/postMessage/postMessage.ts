import { Provider as core_Provider } from 'ox'
import { PostMessage, Transport, Wata, postMessage as core_postMessage } from 'wata'

import type * as Adapter from '../../Adapter.js'
import { fromRequest } from '../internal/fromRequest.js'

/**
 * Creates a postMessage adapter that forwards wallet RPC through a Wata
 * postMessage session.
 *
 * Each request opens the wallet's post-message page (a centered popup by
 * default), delivers the request over `postMessage`, and resolves with the
 * wallet's response. The page closes once the response flushes back;
 * closing it without answering rejects the request.
 */
export function postMessage(options: postMessage.Options): Adapter.Adapter {
  const { host, name, rdns, target } = options

  return fromRequest({
    name,
    rdns,
    async request(request) {
      // One session per request: the wallet page opens for approval and
      // closes once the response (or rejection) flushes back.
      const session = Wata.create({
        transports: [
          core_postMessage({
            host: hostUrl(host),
            async target(parameters) {
              const handle = await (target ?? popup)(parameters)
              if (!handle)
                throw new PostMessage.PopupBlockedError('the wallet page popup was blocked')
              return handle
            },
          }),
        ],
      })
      try {
        return (await session.send({ method: request.method, params: request.params ?? [] })).result
      } catch (error) {
        // The wallet page closing without an answer is the user backing out.
        if (error instanceof Transport.ClosedError)
          throw new core_Provider.UserRejectedRequestError()
        throw error
      } finally {
        await session.close()
      }
    },
  })
}

export declare namespace postMessage {
  /** Options for {@link postMessage}. */
  export type Options = {
    /** URL of the wallet's post-message page. */
    host: string
    /** Provider display name. */
    name: string
    /** Reverse-DNS provider identifier. */
    rdns: string
    /**
     * Override how the wallet page is mounted. Receives the page URL and
     * returns a `Window` or `MessagePort` handle for the session. A nullish
     * handle (e.g. a blocked `window.open`) rejects the request with
     * `PostMessage.PopupBlockedError`.
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
