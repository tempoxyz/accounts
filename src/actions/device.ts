/**
 * Signs a CLI in through the device grant, which the user approves from any browser.
 * @module
 */
import { Base64 } from 'ox'
import { type Config, RequestError } from '../Accounts.js'
import type { Authorization } from '../internal/Authorization.js'
import type * as Funding from '../internal/Funding.js'
import * as AccessKey from '../internal/AccessKey.js'
import * as Api from '../internal/Api.js'
import {
  fundingParameters,
  keyAuthorization,
  resources,
} from '../internal/Request.js'
import type { ChainId, HasAccessKey, WithAccount } from '../Permissions.js'

/**
 * Starts the device grant for a CLI. The user approves `userCode` at `verificationUri`, and `wait`
 * resolves with the authorization. The instance's `clientId` names the device app, such as
 * `tempo-cli`, whose realms the sign-in uses. A CLI without a registration sends `cli:` and its
 * name, such as `cli:acme-deploy`. The device page then shows its name as unverified, and its
 * `accessKey` must name the access key's `limits` and `scopes`. Without `accessKey`, the grant
 * signs `challenge` as the user's Tempo Account, which the device page shows, and `wait` resolves
 * with the tokens, the user, and `challengeSignature`.
 *
 * @example
 * ```ts
 * const auth = Accounts.create({ clientId: 'tempo-cli' })
 * const device = await Actions.device.authorize(auth, {
 *   accessKey: {
 *     expiry: '1d',
 *     limits: [{ limit: '10', token: 'ousd' }],
 *   },
 * })
 * console.log(`Open ${device.verificationUriComplete}`)
 * const authorization = await device.wait()
 * ```
 */
export async function authorize<
  const accessKey extends WithAccount | undefined = WithAccount,
>(
  auth: Config,
  options: authorize.Options<accessKey>,
): Promise<authorize.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>> {
  const { accessKey } = options
  const resolved = accessKey ? await AccessKey.resolve(accessKey) : undefined
  // The device authorization request (RFC 8628 §3.1), with the access key as base64url JSON.
  const body = new URLSearchParams({
    // A challenge without an access key names the instance's chain, whose view of the account signs it.
    ...(options.challenge !== undefined && !resolved
      ? { chain_id: String(auth.chainId) }
      : {}),
    ...(options.challenge === undefined
      ? {}
      : { challenge: options.challenge }),
    // The instance's app is the device app that the CLI signs in to, such as `tempo-cli`.
    client_id: auth.clientId,
    device: options.device ?? hostname(),
    ...fundingParameters(options.funding),
    ...(resolved && accessKey
      ? {
          key_authorization: Base64.fromString(
            JSON.stringify(
              keyAuthorization(auth, {
                accessKey: { ...accessKey, account: resolved.signer },
              }),
            ),
            { pad: false, url: true },
          ),
        }
      : {}),
  })
  // RFC 8707 §2: one `resource` parameter for each resource. The poll names none, so the tokens
  // are for the code's resources.
  for (const resource of resources(auth, options))
    body.append('resource', resource)
  // Each ID token needs `openid` and `email`, so the call's scopes add to the instance's.
  if (options.scope !== undefined)
    body.set(
      'scope',
      [...new Set([...auth.scope.split(' '), ...options.scope.split(' ')])]
        .filter(Boolean)
        .join(' '),
    )
  const code = await Api.json<{
    device_code: string
    expires_in: number
    interval: number
    user_code: string
    verification_uri: string
    verification_uri_complete: string
  }>(
    await (auth.fetch ?? fetch)(new URL('/device/code', auth.url), {
      body,
      method: 'POST',
      // A redirect would post the request to another origin, and each poll refuses it.
      redirect: 'manual',
    }).catch((error: unknown) => {
      throw new RequestError({
        cause: error,
        code: 'server_error',
        message:
          'The code request received no response. Check the connection, and request a new code.',
        status: 0,
      })
    }),
  )

  // Whether the grant carries a challenge, whose signature the approval must hold.
  const challenged = options.challenge !== undefined

  /** Polls until the user approves or denies the code, or it expires, or `signal` aborts. */
  async function wait(
    options: authorize.wait.Options = {},
  ): Promise<
    authorize.Authorized<ChainId<accessKey>, HasAccessKey<accessKey>>
  > {
    const { signal } = options
    // React Native's `AbortSignal` has neither `reason` nor `throwIfAborted`, and Hermes has no
    // `DOMException`.
    const aborted = () =>
      signal?.reason ??
      Object.assign(new Error('The wait was aborted.'), { name: 'AbortError' })
    let interval = code.interval
    // Doubles at each transient failure in a row, and returns to 1 once a poll is answered.
    let backoff = 1
    let failure: unknown
    const deadline = Date.now() + code.expires_in * 1000
    // Only a fetch that rejects is a poll without a response. A fault before it, such as in the
    // client assertion or the DPoP proof, rejects the poll at once.
    // An abort lets a poll in flight finish, so an approval that it carries reaches the caller,
    // which revokes its tokens, such as a sign-in that a sign-out overtook.
    const poll = answered(auth)
    while (Date.now() < deadline) {
      if (signal?.aborted) throw aborted()
      // A wait never outlasts the code, so a doubled interval ends at its expiry. An abort ends the
      // wait at once, so no poll follows it.
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(aborted())
        }
        const timer = setTimeout(
          () => {
            signal?.removeEventListener('abort', abort)
            resolve()
          },
          Math.min(interval * backoff * 1000, deadline - Date.now()),
        )
        signal?.addEventListener('abort', abort, { once: true })
      })
      failure = undefined
      const result = await request<ChainId<accessKey>, HasAccessKey<accessKey>>(
        poll,
        {
          accessKey: resolved,
          challenged,
          deviceCode: code.device_code,
        },
      ).catch((error: unknown) => {
        // A failure after an approval keeps its error, so the caller still empties the session.
        if (error instanceof RequestError && error.signedIn) throw error
        if (signal?.aborted) throw aborted()
        // A rate limit, a server error, or a request without a response doubles the wait until a
        // poll is answered, since the code stays valid.
        if (!transient(error)) throw error
        failure = error
        backoff *= 2
        return undefined
      })
      if (result?.status === 'approved') return result.authorization
      if (signal?.aborted) throw aborted()
      if (!result) continue
      backoff = 1
      if (result.slowDown) interval += 5
    }
    throw new RequestError({
      cause: failure,
      code: 'expired_token',
      message: 'Device code expired. Request a new code.',
      status: 400,
    })
  }

  return {
    deviceCode: code.device_code,
    expiresIn: code.expires_in,
    interval: code.interval,
    userCode: code.user_code,
    verificationUri: code.verification_uri,
    verificationUriComplete: code.verification_uri_complete,
    wait,
  }
}

export declare namespace authorize {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key. Its `access` names the Tempo Account, which defaults to the one
     * the user selects at sign-in, or the user's oldest. The user approves it, so it may exceed the
     * headless ceiling. `undefined` requests none, for a grant that signs `challenge` alone.
     */
    accessKey: accessKey
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * Tempo ID's page shows the message, from any app, with or without an access key.
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
    /**
     * The registered resources (RFC 8707) that the tokens are for, such as `https://mercator.sh/mcp`.
     * Each access token names them as `aud`. Defaults to the instance's `resource`, or else Tempo
     * ID's origin. An unknown or disabled resource fails with `invalid_target`.
     */
    resource?: Config['resource']
    /** Scopes that the code requests beside the instance's `scope`, as `device.signIn` describes. */
    scope?: string | undefined
  }

  /** The authorization of an approved grant, without an access key for a grant without one. */
  type Authorized<
    chainId extends number = number,
    hasAccessKey extends boolean = true,
  > = hasAccessKey extends true ? Authorization<chainId> : Api.WithoutAccessKey

  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = true,
  > = {
    /**
     * The secret code that {@link poll} sends, for a program that polls across processes or
     * requests, such as a server that waits for the user in later requests. Keep it as secret as a
     * token, since its poll returns the approved key authorization.
     */
    deviceCode: string
    /** Seconds until the code expires. */
    expiresIn: number
    /** Seconds to wait between polls, as Tempo ID sets them. A `slow_down` adds 5. */
    interval: number
    /** The code that the user confirms. */
    userCode: string
    /** Where the user enters the code. */
    verificationUri: string
    /** Where the user approves the code, with the code filled in. */
    verificationUriComplete: string
    /**
     * Resolves with the authorization once the user approves, and throws on a denial or expiry. A
     * poll that fails with a network error, a rate limit, or a server error doubles the wait until a
     * poll is answered, and the poll continues until the code expires. If `options.signal` aborts,
     * it sends no further poll. A poll in flight finishes, and an approval that it carries resolves.
     */
    wait: (options?: wait.Options) => Promise<Authorized<chainId, hasAccessKey>>
  }

  namespace wait {
    type Options = {
      /** Rejects the wait with the signal's reason, and stops the polls. Absent, the wait ends only with the code. */
      signal?: AbortSignal | undefined
    }
  }
}

/**
 * Sends one poll of a device code that {@link authorize} started, for a program that polls across
 * processes or requests, such as a server that keeps `deviceCode` in its database. It returns
 * `pending` until the user decides, with `slowDown` when the poll came before the interval, and
 * `approved` with the authorization once. It throws on a denial, an expiry, or a poll without a
 * decision, such as a network error, a rate limit, or a server error, after which the code stays
 * valid. `accessKey` names the app's own access key, the one that `authorize` received, since no
 * private key outlives the call that created it. `false` names none, for a grant without an access
 * key, whose authorization holds the tokens, the user, and any `challengeSignature`.
 *
 * @example
 * ```ts
 * const result = await Actions.device.poll(auth, {
 *   accessKey: { publicKey, type: 'p256' },
 *   deviceCode,
 * })
 * if (result.status === 'approved') save(result.authorization.accessKey)
 * ```
 */
export async function poll<
  const chainId extends number = number,
  const accessKey extends AccessKey.own.Options | false = AccessKey.own.Options,
>(
  auth: Config,
  options: poll.Options<accessKey>,
): Promise<poll.ReturnType<chainId, accessKey extends false ? false : true>> {
  const { deviceCode } = options
  // A grant without an access key carries a challenge unless the caller says otherwise, so an
  // approval without its signature throws.
  const challenged = options.challenged ?? options.accessKey === false
  if (options.accessKey === false)
    return request<chainId, accessKey extends false ? false : true>(
      answered(auth),
      {
        accessKey: undefined,
        challenged,
        deviceCode,
      },
    )
  const signer = AccessKey.own(options.accessKey)
  if (!signer) throw new AccessKey.SignerRequiredError()

  return request<chainId, accessKey extends false ? false : true>(
    answered(auth),
    {
      accessKey: { material: {}, signer },
      challenged,
      deviceCode,
    },
  )
}

export declare namespace poll {
  type Options<
    accessKey extends AccessKey.own.Options | false =
      | AccessKey.own.Options
      | false,
  > = {
    /**
     * The app's own access key, which the poll's authorization names: its `account`, or its
     * `publicKey` and `type`. `false` for a grant without an access key.
     */
    accessKey: accessKey
    /**
     * Whether the grant carried `challenge`, so an approval without `challengeSignature` throws.
     * Defaults to `true` for `accessKey: false`, else `false`. A grant without an access key or a
     * challenge passes `false`.
     */
    challenged?: boolean | undefined
    /** The device code that {@link authorize} returned. */
    deviceCode: string
  }

  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = true,
  > =
    | {
        /** The user approved the code. A later poll of it fails with `invalid_grant`. */
        status: 'approved'
        /**
         * The authorization, with the signed key authorization and the tokens, or the tokens and any
         * `challengeSignature` for a grant without an access key.
         */
        authorization: authorize.Authorized<chainId, hasAccessKey>
      }
    | {
        /** The user has not decided. */
        status: 'pending'
        /** Whether Tempo ID answered `slow_down`, so the next poll waits 5 seconds more. */
        slowDown: boolean
      }
}

/**
 * Sends one poll (RFC 8628 §3.4), and maps the token endpoint's answer. `authorization_pending` and
 * `slow_down` return `pending` (§3.5). A denial and an expiry throw with a CLI's message.
 */
async function request<chainId extends number, hasAccessKey extends boolean>(
  auth: Config,
  options: request.Options,
): Promise<poll.ReturnType<chainId, hasAccessKey>> {
  const { accessKey: resolved, deviceCode } = options
  const body = await Api.token(auth, {
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  }).catch((error: unknown) => {
    if (!(error instanceof RequestError) || transient(error)) throw error
    if (error.code === 'authorization_pending' || error.code === 'slow_down')
      return error.code
    // A refusal of Tempo ID with a `reason`, such as `foreign_account`, keeps its fields. Only the
    // user's denial and the expiry of the code, which carry none, take a CLI's message.
    if (error.code in messages && error.reason === undefined)
      throw new RequestError({
        code: error.code,
        message: messages[error.code as keyof typeof messages],
        status: error.status,
      })
    throw error
  })
  if (typeof body === 'string')
    return { slowDown: body === 'slow_down', status: 'pending' }

  // `accessKey` decides both the type and the runtime value of the authorization.
  const read = () =>
    resolved
      ? Api.authorization<chainId>(
          {
            account: body.account,
            ...(body.challenge_signature
              ? { challenge_signature: body.challenge_signature }
              : {}),
            key_authorization: body.key_authorization,
            tokens: Api.tokens(body),
          },
          { ...resolved, challenged: options.challenged },
        )
      : Api.withoutAccessKey(
          { ...body, tokens: Api.tokens(body) },
          { challenged: options.challenged },
        )
  const authorization = await (async () => {
    try {
      return read()
    } catch (error) {
      // No session holds a refused approval's refresh token, so it is revoked, as the redirect
      // path revokes a refused response's. A failed revocation leaves the refusal as the error.
      const refreshToken = (body as { refresh_token?: unknown }).refresh_token
      if (typeof refreshToken === 'string')
        await Api.revoke(auth, { refreshToken }).catch(() => undefined)
      throw error
    }
  })()
  return {
    authorization: authorization as authorize.Authorized<chainId, hasAccessKey>,
    status: 'approved',
  }
}

declare namespace request {
  type Options = {
    /** The access key that the authorization names, with what rebuilds it. Absent without one. */
    accessKey: AccessKey.resolve.ReturnType | undefined
    /** Whether the grant sent a challenge, whose signature the token response must carry. */
    challenged?: boolean | undefined
    /** The device code to poll. */
    deviceCode: string
  }
}

/**
 * Returns `auth` with a `fetch` that throws `RequestError` with status 0 for a poll without a response,
 * such as offline. Only a fetch that rejects is a poll without a response.
 */
function answered(auth: Config): Config {
  return {
    ...auth,
    fetch: ((input, init) =>
      (auth.fetch ?? fetch)(input, init).catch((error: unknown) => {
        throw new RequestError({
          cause: error,
          code: 'server_error',
          message:
            'The poll received no response. Check the connection, and poll again.',
          status: 0,
        })
      })) satisfies typeof fetch,
  }
}

/** The message of each RFC 8628 error that ends the poll, as a CLI shows it. */
const messages = {
  access_denied: 'The user denied the request.',
  expired_token: 'Device code expired. Request a new code.',
} as const

/**
 * Returns whether a poll failed without the token endpoint's decision: a request without a response,
 * a rate limit, or a server error. A refused redirect is final.
 */
function transient(error: unknown) {
  if (!(error instanceof RequestError)) return false
  // A refused redirect has status 0, but each poll meets the same redirect.
  if (Api.redirectRefused(error)) return false
  return error.status === 0 || error.status === 429 || error.status >= 500
}

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
