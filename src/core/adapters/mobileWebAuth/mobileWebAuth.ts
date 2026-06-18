import { Discovery, Wata, mobileWebAuth as core_mobileWebAuth, type MobileWebAuth } from 'wata'

import type * as Adapter from '../../Adapter.js'
import * as Keystore from '../../Keystore.js'
import { fromRequest } from '../internal/fromRequest.js'

/**
 * Creates a mobile web auth adapter that forwards wallet RPC through Wata.
 *
 * Authentication opens a browser session and completes via an encrypted app-link
 * callback carrying the wallet RPC response.
 */
export function mobileWebAuth(options: mobileWebAuth.Options): Adapter.Adapter {
  const { baseUrl, fetch, host, name, openAuthSession, rdns, redirectUri } = options

  // The host discovery document is fetched once and reused for the
  // adapter's lifetime; a wallet rotating its document requires a new
  // adapter instance to pick up.
  let hostDocument: Promise<Discovery.HostDocument> | undefined
  function resolveHost() {
    if (typeof host !== 'string') return host
    hostDocument ??= Discovery.fetchHost(host, fetch !== undefined ? { fetch } : {}).catch(
      (error) => {
        hostDocument = undefined
        throw error
      },
    )
    return hostDocument
  }

  return fromRequest({
    // React Native may lack WebCrypto and persists through string-based
    // storage, so this opts into pure-JS P-256 (the access key lives app-side
    // and signs without a wallet round-trip).
    keystores: { p256: Keystore.p256() },
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
