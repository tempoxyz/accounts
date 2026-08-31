import { Provider as core_Provider } from 'ox'
import { DeviceCode, Transport, Wata, deviceCode as core_deviceCode } from 'wata'

import { normalizePendingApprovalResponse } from '../../../internal/deviceCode.js'
import type * as Adapter from '../../Adapter.js'
import type * as Keystore from '../../Keystore.js'
import { fromRequest } from '../internal/fromRequest.js'

/**
 * Creates a device-code adapter that forwards wallet RPC through Wata.
 *
 * Each request runs one OAuth 2.0 Device Authorization Grant exchange
 * (RFC 8628 with PKCE): the host issues a user code surfaced via
 * `onPrompt`, the user approves on the host's verification page, and the
 * adapter polls until the response arrives.
 */
export function deviceCode(options: deviceCode.Options): Adapter.Adapter {
  const {
    actions,
    fetch,
    icon,
    keystores,
    meta,
    methods,
    name,
    onPrompt,
    pollingInterval,
    rdns,
    timeout = 300_000,
    url,
  } = options

  return fromRequest({
    ...(actions ? { actions } : {}),
    ...(icon ? { icon } : {}),
    ...(keystores ? { keystores } : {}),
    name,
    rdns,
    async request(request) {
      if (methods && !methods.includes(request.method))
        throw new core_Provider.UnsupportedMethodError({
          message: `\`${request.method}\` not supported by device-code adapter.`,
        })

      // Device code is single-exchange: one register + poll cycle carries one
      // RPC request envelope, so a fresh Wata instance backs every request.
      const wata = Wata.create({
        transports: [
          core_deviceCode({
            fetch: retryPendingApproval(fetch ?? globalThis.fetch.bind(globalThis)),
            ...(meta ? { meta } : {}),
            ...(pollingInterval !== undefined ? { pollingInterval } : {}),
            url,
          }),
        ],
      })
      const session = wata.start()

      // A failed prompt surface (e.g. browser open) fails the exchange — the
      // user can never learn the code, so polling would only run out the clock.
      session.onPrompt((prompt) => {
        void (async () => onPrompt(prompt))().catch((error) => {
          void session.close(new PromptError(prompt, error))
        })
      })

      const timer = setTimeout(() => {
        void session.close(new TimeoutError(session.prompt))
      }, timeout)

      try {
        const { result } = await session.send({
          method: request.method,
          params: request.params ?? [],
          ...(request.context ? { context: request.context } : {}),
        })
        return result
      } catch (error) {
        if (error instanceof DeviceCode.UserRejectedError)
          throw new core_Provider.UserRejectedRequestError({
            message: 'User denied the device-code request.',
          })
        if (error instanceof Transport.ClosedError)
          throw new Error('Device code expired before authorization completed.', { cause: error })
        throw error
      } finally {
        clearTimeout(timer)
      }
    },
  })
}

function retryPendingApproval(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    return await normalizePendingApprovalResponse(response)
  }
}

export declare namespace deviceCode {
  /** Options for {@link deviceCode}. */
  export type Options = {
    /** Adapter-specific action overrides layered over the request-forwarding defaults. */
    actions?: fromRequest.Options['actions'] | undefined
    /** Override the transport `fetch` implementation. */
    fetch?: typeof globalThis.fetch | undefined
    /** Data URI of the provider icon, announced via EIP-6963. */
    icon?: Adapter.Meta['icon'] | undefined
    /** Keystores backing locally generated access keys (SDK default otherwise). */
    keystores?: Keystore.Keystores | undefined
    /** Consumer metadata shown on the host's approval page. */
    meta?:
      | {
          name: string
          description?: string | undefined
          icon?: string | undefined
          websiteUrl?: string | undefined
        }
      | undefined
    /** Allowlist of RPC methods forwarded over the transport. Forwards all when omitted. */
    methods?: readonly string[] | undefined
    /** Provider display name. */
    name: string
    /** Surfaces the pairing prompt (user code + verification URL) to the user. */
    onPrompt: (prompt: DeviceCode.Prompt) => Promise<void> | void
    /** Poll cadence override in milliseconds. Defaults to the host-advertised interval. */
    pollingInterval?: number | undefined
    /** Reverse-DNS provider identifier. */
    rdns: string
    /** Overall wait for user approval in milliseconds. @default 300000 */
    timeout?: number | undefined
    /** Base URL of the host's device-code endpoints (derives `/register` and `/token`). */
    url: string
  }
}

/** Thrown when the `onPrompt` callback fails (e.g. no browser could be opened). */
export class PromptError extends Error {
  override cause?: unknown | undefined
  prompt: DeviceCode.Prompt

  constructor(prompt: DeviceCode.Prompt, cause?: unknown) {
    super(
      `Failed to surface device code ${prompt.userCode}. Open ${prompt.verificationUriFull ?? prompt.verificationUri} manually.`,
    )
    this.name = 'PromptError'
    this.cause = cause
    this.prompt = prompt
  }
}

/** Thrown when the user did not approve within {@link deviceCode.Options.timeout}. */
export class TimeoutError extends Error {
  prompt: DeviceCode.Prompt | undefined

  constructor(prompt: DeviceCode.Prompt | undefined) {
    super(
      prompt
        ? `Timed out waiting for device code ${prompt.userCode}. Continue at ${prompt.verificationUriFull ?? prompt.verificationUri}.`
        : 'Timed out waiting for device code approval.',
    )
    this.name = 'TimeoutError'
    this.prompt = prompt
  }
}
