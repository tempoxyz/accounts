/**
 * Signs a CLI in through the device grant, which the user approves from any browser.
 * @module
 */
import { Base64 } from 'ox'
import { type Config, RequestError } from '../Id.js'
import type { Authorization } from '../Authorization.js'
import type * as Funding from '../Funding.js'
import * as AccessKey from '../internal/accessKey.js'
import * as Api from '../internal/api.js'
import { keyAuthorization } from '../internal/request.js'
import type { WithAccount } from '../Permissions.js'

/**
 * Starts the device grant for a CLI. The user approves `userCode` at `verificationUri`, and `wait`
 * resolves with the authorization. The instance's `clientId` names the device app, such as
 * `tempo-cli`, whose realms the sign-in uses. A CLI without a registration sends `cli:` and its
 * name, such as `cli:acme-deploy`. The device page then shows its name as unverified, and its
 * `accessKey` must name the access key's `limits` and `scopes`.
 *
 * @example
 * ```ts
 * const auth = Id.create({ clientId: 'tempo-cli' })
 * const device = await Actions.device.authorize(auth, {
 *   accessKey: {
 *     expiry: Expiry.days(1),
 *     limits: [{ limit: 10_000_000n, token: ousd }],
 *     scopes: [Scopes.tip20(ousd).transfer()],
 *   },
 * })
 * console.log(`Open ${device.verificationUriComplete}`)
 * const authorization = await device.wait()
 * ```
 */
export async function authorize<const chainId extends number = number>(
  auth: Config,
  options: authorize.Options<chainId>,
): Promise<authorize.ReturnType<chainId>> {
  const key = await AccessKey.resolve(options.accessKey.account)
  // The device authorization request (RFC 8628 §3.1), with the access key as base64url JSON.
  const code = await Api.json<{
    device_code: string
    expires_in: number
    interval: number
    user_code: string
    verification_uri: string
    verification_uri_complete: string
  }>(
    await (auth.fetch ?? fetch)(new URL('/device/code', auth.url), {
      body: new URLSearchParams({
        ...(options.challenge === undefined
          ? {}
          : { challenge: options.challenge }),
        // The instance's app is the device app that the CLI signs in to, such as `tempo-cli`.
        client_id: auth.clientId,
        device: options.device ?? hostname(),
        ...(options.funding?.currency === undefined
          ? {}
          : { funding_currency: options.funding.currency }),
        ...(options.funding ? { funding_hint: options.funding.amount } : {}),
        ...(options.funding?.token === undefined
          ? {}
          : { funding_token: options.funding.token }),
        key_authorization: Base64.fromString(
          JSON.stringify(
            keyAuthorization(auth, {
              accessKey: { ...options.accessKey, account: key.accessKey },
            }),
          ),
          { pad: false, url: true },
        ),
      }),
      method: 'POST',
    }),
  )

  /** Polls until the user approves or denies the code, or it expires. */
  async function wait(): Promise<Authorization<chainId>> {
    let interval = code.interval
    const deadline = Date.now() + code.expires_in * 1000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000))
      const body = await Api.token(auth, {
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).catch((error: unknown) => {
        // RFC 8628 §3.5: the device polls again until the user decides, and adds 5 seconds to its
        // interval on `slow_down`.
        if (!(error instanceof RequestError)) throw error
        if (error.code === 'slow_down') interval += 5
        else if (error.code in messages)
          throw new RequestError({
            code: error.code,
            message: messages[error.code as keyof typeof messages],
            status: error.status,
          })
        else if (error.code !== 'authorization_pending') throw error
        return undefined
      })
      if (!body) continue
      return Api.authorization<chainId>(
        {
          account: body.account,
          key_authorization: body.key_authorization,
          tokens: Api.tokens(body),
        },
        key,
      )
    }
    throw new RequestError({
      code: 'expired_token',
      message: 'Device code expired. Request a new code.',
      status: 400,
    })
  }

  return {
    expiresIn: code.expires_in,
    userCode: code.user_code,
    verificationUri: code.verification_uri,
    verificationUriComplete: code.verification_uri_complete,
    wait,
  }
}

export declare namespace authorize {
  type Options<chainId extends number = number> = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key. Its `access` names the Tempo Account, which defaults to the one
     * the user selects at sign-in, or the user's oldest. The grant always authorizes an access key,
     * and the user approves it, so it may exceed the headless ceiling.
     */
    accessKey: WithAccount<chainId>
    /**
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope.
     */
    challenge?: string | undefined
    /**
     * The name that the approval page shows, up to 64 characters. Defaults to the hostname in Node,
     * Bun, and Deno, or `Unknown device`.
     */
    device?: string | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page in place of the approved screen. Absent, none opens.
     */
    funding?: Funding.Funding | undefined
  }

  type ReturnType<chainId extends number = number> = {
    /** Seconds until the code expires. */
    expiresIn: number
    /** The code that the user confirms. */
    userCode: string
    /** Where the user enters the code. */
    verificationUri: string
    /** Where the user approves the code, with the code filled in. */
    verificationUriComplete: string
    /** Resolves with the authorization once the user approves, and throws on a denial or expiry. */
    wait: () => Promise<Authorization<chainId>>
  }
}

/** The message of each RFC 8628 error that ends the poll, as a CLI shows it. */
const messages = {
  access_denied: 'The user denied the request.',
  expired_token: 'Device code expired. Request a new code.',
} as const

/** The part of Node's `process` that {@link hostname} reads, which Bun and Deno provide too. */
type Process = {
  getBuiltinModule?: (id: 'node:os') => { hostname: () => string } | undefined
}

/**
 * Returns the hostname, within the 64 characters that Tempo ID accepts. `getBuiltinModule` avoids
 * an import of `node:os`, which browser and React Native bundlers fail to resolve.
 */
function hostname() {
  const process = Reflect.get(globalThis, 'process') as Process | undefined
  const name = process?.getBuiltinModule?.('node:os')?.hostname().trim()
  return name ? name.slice(0, 64) : 'Unknown device'
}
