/**
 * Authorizes the app after a headless sign-in, for `Actions.email.signIn` and
 * `Actions.passkey.signIn`.
 * @module
 */
import { Authentication, type Types } from 'ox/webauthn'
import { type Config, RequestError } from '../Accounts.js'
import type { Authorization } from './Authorization.js'
import type { WithAccount } from '../Permissions.js'
import * as AccessKey from './AccessKey.js'
import * as Api from './Api.js'
import { request } from './Request.js'
import type { Tokens } from './Tokens.js'

/**
 * A headless authorization, without its access key for a sign-in without `accessKey`, and whether
 * its account can upgrade.
 */
export type Result = (Authorization | Api.WithoutAccessKey) & {
  /**
   * Whether the access key's account is a wallet.tempo passkey's that waits for its upgrade on the access key's
   * chain. The access key signed as the passkey's own account, and `Actions.account.upgrade` with it
   * registers the access key and upgrades the account.
   */
  upgradeAvailable: boolean
}

/**
 * Sends `POST /v1/account`, which creates the user's first Tempo Account, then
 * `POST /v1/authorize`. A sign-in without an access key skips the account. Each refusal is marked
 * `signedIn`. An authorization for a user other than `userId` throws `session_changed`.
 */
export async function authorize(
  auth: Config,
  options: authorize.Options,
): Promise<Result> {
  const { accessKey, challenge, getFn } = options
  // The user is signed in already, so every failure from here on, access key generation included, is marked.
  try {
    const resolved = accessKey ? await AccessKey.resolve(accessKey) : undefined
    if (resolved)
      await Api.json(
        await Api.post(auth, '/v1/account', {
          json: { client_id: auth.clientId },
        }),
      )
    // Tempo ID issues the tokens during the request that returns them, so their lifetime counts
    // from its start.
    const { response, sentAt } = await post(auth, {
      getFn,
      json: request(auth, {
        accessKey: resolved &&
          accessKey && { ...accessKey, account: resolved.signer },
        challenge,
      }),
    })
    const body = await Api.json<Api.Headless>(response)
    const authorization = await revoking(auth, {
      body,
      fn: () => {
        const authorization = resolved
          ? Api.authorization(body, {
              ...resolved,
              challenged: challenge !== undefined,
              sentAt,
            })
          : Api.withoutAccessKey(body, {
              challenged: challenge !== undefined,
              sentAt,
            })
        if (authorization.user.id !== options.userId) throw sessionChanged()
        return authorization
      },
    })
    return {
      ...authorization,
      upgradeAvailable: body.upgrade_available === true,
    }
  } catch (error) {
    return Api.signedIn(error)
  }
}

export declare namespace authorize {
  type Options = {
    /**
     * The access key to request, with the app's own access key as `account`, which defaults to a new
     * access key. Without it, the sign-in authorizes no access key.
     */
    accessKey?: WithAccount | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * A sign-in on the app's page needs the `tempo-id:sign` scope.
     */
    challenge?: string | undefined
    /** Runs the ceremony of the passkey that owns the account. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The user that the sign-in verified. */
    userId: string
  }
}

/**
 * Returns the authorization that a sign-in returned in its own response. For a response whose
 * `result` holds none, such as a sign-in that creates the account's passkey first, it calls
 * {@link authorize}. Each refusal is marked `signedIn`.
 */
export async function complete(
  auth: Config,
  options: complete.Options,
): Promise<Result> {
  const { accessKey: resolved, body } = options
  if (body.result.type !== 'authorization')
    // The request's own `accessKey.account`, so an access key that the library generates keeps its
    // material.
    return await authorize(auth, { ...options.request, userId: body.user.id })
  try {
    const pending = body.result.authorization
    // A passkey step's tokens come from its own request, which starts after the ceremony.
    const { sentAt, signed } = await (async () => {
      if (!('next' in pending))
        return { sentAt: options.sentAt, signed: pending }
      const { response, sentAt } = await sign(auth, {
        getFn: options.request.getFn,
        json: options.authorize,
        step: pending,
      })
      return { sentAt, signed: await Api.json<Api.Headless>(response) }
    })()
    const authorization = await revoking(auth, {
      body: signed,
      fn: () => {
        const authorization = resolved
          ? Api.authorization(signed, {
              ...resolved,
              challenged: options.request.challenge !== undefined,
              sentAt,
            })
          : Api.withoutAccessKey(signed, {
              challenged: options.request.challenge !== undefined,
              sentAt,
            })
        if (authorization.user.id !== body.user.id) throw sessionChanged()
        return authorization
      },
    })
    return {
      ...authorization,
      upgradeAvailable: signed.upgrade_available === true,
    }
  } catch (error) {
    return Api.signedIn(error)
  }
}

export declare namespace complete {
  type Options = {
    /** The access key that the request authorized, or `undefined` without one. */
    accessKey: AccessKey.resolve.ReturnType | undefined
    /** The authorization request that the sign-in sent, which the passkey step repeats. */
    authorize: ReturnType<typeof request>
    /** The sign-in's response. */
    body: {
      /** What the sign-in resolved to. */
      result: Completion
      /** The signed-in user. */
      user: { id: string }
    }
    /** The sign-in's options, for a response whose `result` holds no authorization. */
    request: prepare.Options
    /**
     * When the sign-in's request started, in milliseconds. The lifetime of the tokens in its
     * response counts from then.
     */
    sentAt: number
  }
}

/** The `result` of a sign-in's response, a union on `type`. */
export type Completion =
  | {
      /** The authorization, or the passkey step for a passkey-owned account. */
      authorization: Api.Headless | Step
      /** The sign-in authorized the app's request. */
      type: 'authorization'
    }
  | {
      /** The sign-in continues at a page of Tempo ID. */
      type: 'redirect'
      /** The page's URL. */
      url: string
    }
  | {
      /** The sign-in started a session and authorized no request. */
      type: 'signed_in'
    }

/**
 * Returns the access key, or none without `accessKey`, and the authorization request that a sign-in
 * sends: an emailed-code sign-in with its code, and a passkey sign-in with its options.
 */
export async function prepare(auth: Config, options: prepare.Options) {
  const { accessKey } = options
  const resolved = accessKey ? await AccessKey.resolve(accessKey) : undefined
  return {
    accessKey: resolved,
    authorize: request(auth, {
      accessKey: resolved &&
        accessKey && { ...accessKey, account: resolved.signer },
      challenge: options.challenge,
    }),
  }
}

export declare namespace prepare {
  type Options = Omit<authorize.Options, 'userId'>
}

/**
 * Reads the JSON response of a sign-in that carried the authorization request. A refusal with the
 * `Tempo-Id-Signed-In` header came after the session started, so it is marked `signedIn`. A
 * `rejected` refusal before it names `options.redirectUri` in its message, since the app never
 * passed that redirect URI.
 */
export async function read<value>(
  response: Response,
  options: read.Options = {},
): Promise<value> {
  const { redirectUri } = options
  try {
    return await Api.json<value>(response)
  } catch (error) {
    if (response.headers.get('Tempo-Id-Signed-In') === 'true')
      return Api.signedIn(error)
    if (
      !redirectUri ||
      !(error instanceof RequestError) ||
      error.reason !== 'rejected'
    )
      throw error
    throw new RequestError({
      cause: error,
      code: error.code,
      field: error.field,
      message: `${error.message} The request named ${redirectUri}, the default redirect URI, since the instance has no \`redirectUri\`. If the app did not register it, pass \`redirectUri\`, one of the app's registered redirect URIs.`,
      meta: error.meta,
      reason: error.reason,
      status: error.status,
      uri: error.uri,
    })
  }
}

export declare namespace read {
  type Options = {
    /**
     * The redirect URI of the authorization request where the instance has no `redirectUri`, such
     * as the root of the page's origin. Absent where the instance names one.
     */
    redirectUri?: string | undefined
  }
}

/**
 * Sends `POST /v1/authorize` with `json`. For a request with an access key, on a page that runs passkey
 * ceremonies, it requests the passkey step, signs it with {@link sign}, and returns the repeated
 * request's response. Otherwise it returns the response of the one request. `sentAt` is the start
 * of the request that returned the response.
 */
export async function post(
  auth: Config,
  options: post.Options,
): Promise<post.ReturnType> {
  const { getFn, json, passkey = true } = options
  const sentAt = Date.now()
  const response = await Api.post(auth, '/v1/authorize', {
    headers: await redemption(auth),
    json: {
      ...json,
      ...(passkey && steps(json, { getFn }) ? { passkey: true } : {}),
    },
  })
  if (!response.ok) return { response, sentAt }
  // A successful response is the authorization or the step, which Tempo ID's schema validates. A
  // body that does not arrive throws `server_error` with status 0, as an unanswered request does.
  const body = await Api.json<Api.Headless | Step>(response.clone())
  if (!('next' in body)) return { response, sentAt }
  const signed = await sign(auth, { getFn, json, step: body })
  if (signed.response.ok) return signed
  // A session that ended during the ceremony reads as a missing session, as on the first request.
  // Any other refusal, such as `webauthn_rejected`, which also has status 401, throws its reason.
  const refused = (await signed.response
    .clone()
    .json()
    .catch(() => ({}))) as Partial<Api.ErrorBody>
  if (refused.reason !== 'session_required') await Api.json(signed.response)
  return signed
}

export declare namespace post {
  type Options = {
    /** Runs the ceremony of the passkey that owns the account. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The authorization request. */
    json: globalThis.ReturnType<typeof request>
    /** Whether a passkey-owned account signs the access key on the page. Defaults to `true`. */
    passkey?: boolean | undefined
  }

  type ReturnType = sign.ReturnType
}

/**
 * Throws an `AbortError` for a ceremony that the user closed, as for a closed dialog, else the
 * ceremony's error. The browser rejects a closed or timed-out prompt with a `NotAllowedError`, which
 * ox wraps. The `AbortError` holds ox's error as its `cause`. It is an `Error`, since Hermes has no
 * `DOMException`.
 */
export function closed(error: unknown): never {
  const name = (error as { cause?: { name?: unknown } } | undefined)?.cause
    ?.name
  if (name === 'NotAllowedError' || name === 'AbortError')
    throw Object.assign(new Error('The user closed the passkey prompt.'), {
      cause: error,
      name: 'AbortError',
    })
  throw error
}

/**
 * Signs the options of the passkey `step` with the passkey on the page, and repeats
 * `POST /v1/authorize` with the assertion and the step's expiry. Returns that response, and the
 * start of its request, after the ceremony, as `sentAt`. A failed
 * ceremony, such as a dismissed prompt or a passkey that this device does not hold, throws
 * `webauthn_required`, so the app can authorize through a redirect.
 */
export async function sign(
  auth: Config,
  options: sign.Options,
): Promise<sign.ReturnType> {
  const { getFn, json, step } = options
  const deserialized = Authentication.deserializeOptions(step.next.options)
  const signed = await Authentication.sign(
    // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
    getFn ? ({ ...deserialized, getFn } as never) : deserialized,
  ).catch((error: unknown) => {
    throw new RequestError({
      cause: error,
      code: 'interaction_required',
      message:
        "Passkey ceremony failed: the account's passkey did not sign the access key on this page. Authorize through a redirect, whose approval page signs it.",
      reason: 'webauthn_required',
      status: 0,
    })
  })
  const assertion = Authentication.serializeResponse(signed)
  // Tempo ID issues the tokens during this request, so their lifetime counts from after the ceremony.
  const sentAt = Date.now()
  // The step's expiry keeps the digest that the passkey signed, in place of a new default. A step
  // without one signs an access key that never expires, which an expiry of 0 requests.
  const response = await Api.post(auth, '/v1/authorize', {
    headers: await redemption(auth),
    json: {
      ...json,
      ...(json.key_authorization
        ? {
            key_authorization: {
              ...json.key_authorization,
              expiry: step.expiry ?? 0,
            },
          }
        : {}),
      passkey: { assertion },
    },
  })
  return { response, sentAt }
}

export declare namespace sign {
  type Options = {
    /** Runs the passkey's ceremony. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The authorization request that returned the step. */
    json: globalThis.ReturnType<typeof request>
    /** The passkey step. */
    step: Step
  }

  type ReturnType = {
    /** The response of the request that sent the assertion, or of the one request. */
    response: Response
    /**
     * When that request started, in milliseconds. The lifetime of the tokens in its response counts
     * from then.
     */
    sentAt: number
  }
}

/**
 * Returns whether a request asks for the passkey step: it carries an access key or a challenge, and
 * the page runs passkey ceremonies, through `getFn` or `navigator.credentials`.
 */
export function steps(
  json: ReturnType<typeof request>,
  options: Pick<post.Options, 'getFn'>,
) {
  if (!json.key_authorization && json.challenge === undefined) return false
  return (
    options.getFn !== undefined ||
    globalThis.navigator?.credentials !== undefined
  )
}

/** The passkey step of a headless authorization, which the page signs before it repeats the request. */
export type Step = {
  /**
   * The access key's expiry in Unix seconds, as Tempo ID filled or the request named it, which the
   * repeated request sends. 0, or absent, for an access key that never expires.
   */
  expiry?: number | undefined
  /** The next action: the passkey signs. */
  next: {
    /** The options for `navigator.credentials.get()`, whose challenge is the access key's digest. */
    options: Types.CredentialRequestOptions<true>
    /** The kind of action. */
    type: 'webAuthn'
  }
}

/**
 * Returns the DPoP proof of the code's redemption, for an instance with a DPoP key. Tempo ID
 * redeems the code of `POST /v1/authorize`, and of a sign-in that carries the authorization, at its
 * token endpoint in process, so the proof names `POST /oauth2/token`.
 */
export function redemption(auth: Config) {
  return Api.dpop(auth, { method: 'POST', path: '/oauth2/token' })
}

/**
 * Returns what `options.fn` returns for the authorization `options.body`. If `fn` refuses the authorization, such as
 * one without the challenge's signature or for another user, no session holds its tokens, so it
 * revokes the refresh token first, and then rethrows.
 */
export async function revoking<value>(
  auth: Config,
  options: revoking.Options<value>,
): Promise<value> {
  const { body, fn } = options
  try {
    return fn()
  } catch (error) {
    // A response that the refusal names as malformed can hold no tokens.
    const tokens = body.tokens as
      | Partial<Api.TokenResponse & Tokens>
      | undefined
    const refreshToken = tokens?.refreshToken ?? tokens?.refresh_token
    // A failed revocation leaves a refresh token that nothing holds, so the refusal stays the error.
    if (typeof refreshToken === 'string')
      await Api.revoke(auth, { refreshToken }).catch(() => undefined)
    throw error
  }
}

declare namespace revoking {
  type Options<value> = {
    /** The response that holds the authorization and its tokens. */
    body: Pick<Api.Headless, 'tokens'>
    /** Reads the authorization, and throws its refusal. */
    fn: () => value
  }
}

/** The refusal of an authorization whose user is not the sign-in's, after another sign-in replaced it. */
export function sessionChanged() {
  return new RequestError({
    code: 'invalid_request',
    message:
      'Session changed: another sign-in replaced this one before the authorization. Sign in again.',
    reason: 'session_changed',
    status: 409,
  })
}
