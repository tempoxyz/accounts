import { type DeviceCode, type Discovery, Wata, deviceCode as core_deviceCode } from 'wata'

import type * as Adapter from '../../Adapter.js'
import { fromRequest } from '../internal/fromRequest.js'
import { hostResolver } from '../internal/hostResolver.js'

/**
 * Creates a device code adapter that forwards wallet RPC through Wata.
 *
 * Each request registers an authorization intent with the wallet host,
 * surfaces a user code + verification URL via {@link deviceCode.Options.onPrompt},
 * and polls until the user approves the request on the wallet's approval
 * surface (or denies / lets it expire).
 */
export function deviceCode(options: deviceCode.Options): Adapter.Adapter {
  const { baseUrl, fetch, host, meta, name, onPrompt, pollingInterval, pollingTimeout, rdns } =
    options

  const resolveHost = hostResolver(host, fetch)

  return fromRequest({
    name,
    rdns,
    async request(request) {
      // Device code is single-exchange: one registered intent carries one
      // RPC request envelope, and one polled response settles the session.
      const session = Wata.create({
        ...(baseUrl ? { baseUrl } : {}),
        ...(meta ? { meta } : {}),
        transports: [
          core_deviceCode({
            onPrompt,
            url: endpointUrl(await resolveHost()),
            ...(fetch !== undefined ? { fetch } : {}),
            ...(pollingInterval !== undefined ? { pollingInterval } : {}),
            ...(pollingTimeout !== undefined ? { pollingTimeout } : {}),
          }),
        ],
      })
      return (await session.send({ method: request.method, params: request.params ?? [] })).result
    },
  })
}

export declare namespace deviceCode {
  /** Base options for {@link deviceCode}. */
  export type BaseOptions = {
    /**
     * Public HTTPS origin that hosts this app's Wata consumer discovery
     * document, surfaced to the wallet's approval UI. Required when
     * {@link meta} is set.
     */
    baseUrl?: string | undefined
    /** Override the Wata `fetch` implementation. */
    fetch?: DeviceCode.Options['fetch'] | undefined
    /** Host discovery origin or preloaded Wata host document. */
    host: string | Discovery.HostDocument
    /**
     * Human-facing app metadata rendered by the wallet's approval UI.
     * Use instead of {@link baseUrl} when this app does not publish a
     * consumer discovery document.
     */
    meta?: Discovery.Meta | undefined
    /** Provider display name. */
    name: string
    /**
     * Surfaces the user code and verification URL once the wallet accepts
     * the registration — print to the terminal, render a QR code, etc.
     */
    onPrompt: NonNullable<DeviceCode.Options['onPrompt']>
    /** Poll interval override in milliseconds. Defaults to the host's suggested cadence. */
    pollingInterval?: number | undefined
    /** Per-poll request timeout in milliseconds. @default 30000 */
    pollingTimeout?: number | undefined
    /** Reverse-DNS provider identifier. */
    rdns: string
  }
  /** Options for {@link deviceCode}. */
  export type Options = BaseOptions
}

/**
 * Resolves the device-code endpoint base URL from the host's discovery
 * binding. The Wata transport derives `<base>/register` and `<base>/token`
 * from one base URL, so the advertised pair must share that shape.
 */
function endpointUrl(host: Discovery.HostDocument): string {
  const binding = host.transports['device-code']
  if (!binding)
    throw new Error(
      `wallet host \`${host.origin}\` does not advertise the \`device-code\` transport.`,
    )
  const base = binding.register_url.replace(/\/register$/, '')
  if (base === binding.register_url || binding.token_url !== `${base}/token`)
    throw new Error(
      'unsupported `device-code` binding: `register_url` and `token_url` must be `<base>/register` and `<base>/token`.',
    )
  return base
}
