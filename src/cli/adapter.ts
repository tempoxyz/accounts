import { spawn } from 'node:child_process'
import type { DeviceCode } from 'wata'

import type * as Adapter from '../core/Adapter.js'
import { deviceCode } from '../core/adapters/deviceCode/deviceCode.js'
import * as Keystore from '../core/Keystore.js'

/**
 * Creates a CLI bootstrap adapter backed by the Wata device-code transport
 * (OAuth 2.0 Device Authorization Grant, RFC 8628 with PKCE).
 *
 * Authorization opens the wallet's verification page in a browser; the wallet
 * responds with a signed key authorization once the user approves.
 */
export function cli(options: cli.Options): Adapter.Adapter {
  const {
    host,
    name = 'Tempo CLI',
    open = defaultOpen,
    pollingInterval,
    rdns = 'xyz.tempo.cli',
    timeout,
  } = options

  return deviceCode({
    // The CLI persists to string-based filesystem storage, so its p256
    // default opts into an extractable WebCrypto key (a non-extractable one
    // could not survive a restart). secp256k1 stays available for explicit
    // requests.
    keystores: {
      p256: Keystore.webCryptoP256({ extractable: true }),
      secp256k1: Keystore.secp256k1(),
    },
    meta: { name },
    // Only the bootstrap ceremonies open a browser; everything else signs
    // locally with the stored access key or fails fast.
    methods: ['wallet_connect', 'wallet_authorizeAccessKey'],
    name,
    async onPrompt(prompt) {
      await open(prompt.verificationUriFull ?? prompt.verificationUri, prompt)
    },
    rdns,
    ...(pollingInterval !== undefined ? { pollingInterval } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    url: host,
  })
}

export declare namespace cli {
  export type Options = {
    /** Base URL of the wallet's device-code endpoints (derives `/register` and `/token`). */
    host: string
    /** Provider display name. @default "Tempo CLI" */
    name?: string | undefined
    /** Browser opener override. */
    open?: ((url: string, prompt: DeviceCode.Prompt) => Promise<void> | void) | undefined
    /** Poll cadence override in milliseconds. Defaults to the host-advertised interval. */
    pollingInterval?: number | undefined
    /** Reverse-DNS provider identifier. @default "xyz.tempo.cli" */
    rdns?: string | undefined
    /** Overall wait for user approval in milliseconds. @default 300000 */
    timeout?: number | undefined
  }
}

function defaultOpen(url: string) {
  const command =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] }

  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}
