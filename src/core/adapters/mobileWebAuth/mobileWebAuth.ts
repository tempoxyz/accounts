import { Wata, mobileWebAuth as core_mobileWebAuth, type MobileWebAuth } from 'wata'

import type * as Adapter from '../../Adapter.js'
import { fromRequest } from '../internal/fromRequest.js'
import { hostResolver } from '../internal/hostResolver.js'

/**
 * Creates a mobile web auth adapter that forwards wallet RPC through Wata.
 *
 * Authentication opens a browser session and completes via an encrypted app-link
 * callback carrying the wallet RPC response.
 */
export function mobileWebAuth(options: mobileWebAuth.Options): Adapter.Adapter {
  const { baseUrl, fetch, host, name, openAuthSession, rdns, redirectUri } = options

  const resolveHost = hostResolver(host, fetch)

  return fromRequest({
    name,
    rdns,
    async request(request) {
      // Mobile web auth is single-exchange: one authorization URL carries one
      // RPC request envelope, and one callback URL carries one response.
      // The wallet learns this app's identity from the consumer discovery
      // document served at `baseUrl`, not from session metadata.
      const session = Wata.create({
        baseUrl,
        transports: [
          core_mobileWebAuth({
            callback: redirectUri,
            host: await resolveHost(),
            openAuthSession,
            ...(fetch !== undefined ? { fetch } : {}),
          }),
        ],
      })
      return (await session.send({ method: request.method, params: request.params ?? [] })).result
    },
  })
}

export declare namespace mobileWebAuth {
  /** Base options for {@link mobileWebAuth}. */
  export type BaseOptions = {
    /** Public HTTPS origin that hosts this app's Wata consumer discovery document. */
    baseUrl: string
    /** Override the Wata discovery `fetch` implementation. */
    fetch?: MobileWebAuth.Options['fetch'] | undefined
    /** Host discovery origin or preloaded Wata host document. */
    host: MobileWebAuth.Options['host']
    /** Provider display name. */
    name: string
    /** Opens the browser auth session and returns the callback URL. */
    openAuthSession: NonNullable<MobileWebAuth.Options['openAuthSession']>
    /** Redirect URI for the auth callback (e.g. your app's deep link scheme). */
    redirectUri: string
    /** Reverse-DNS provider identifier. */
    rdns: string
  }
  /** Options for {@link mobileWebAuth}. */
  export type Options = BaseOptions
}
