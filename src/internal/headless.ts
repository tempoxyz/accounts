/**
 * Authorizes the app after a headless sign-in, for `Actions.email.signIn` and
 * `Actions.passkey.signIn`.
 * @module
 */
import { Authentication, type Types } from 'ox/webauthn'
import { type Config, RequestError } from '../Accounts.js'
import type { Authorization } from '../Authorization.js'
import type { WithAccount } from '../Permissions.js'
import * as AccessKey from './accessKey.js'
import * as Api from './api.js'
import { request } from './request.js'

/**
 * A headless authorization, without its access key for a sign-in without `accessKey`, and whether
 * its account can upgrade.
 */
export type Result = (Authorization | Api.WithoutKey) & {
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
    const key = accessKey ? await AccessKey.resolve(accessKey) : undefined
    if (key)
      await Api.json(
        await Api.post(auth, '/v1/account', {
          json: { client_id: auth.clientId },
        }),
      )
    const body = await Api.json<Api.Headless>(
      await post(auth, {
        getFn,
        json: request(auth, {
          accessKey: key &&
            accessKey && { ...accessKey, account: key.accessKey },
          challenge,
        }),
      }),
    )
    const authorization = key
      ? Api.authorization(body, key)
      : Api.withoutKey(body)
    if (authorization.user.id !== options.userId) throw sessionChanged()
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
    /** A message that the access key's witness binds. */
    challenge?: string | undefined
    /** Runs the ceremony of the passkey that owns the account. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The user that the sign-in verified. */
    userId: string
  }
}

/**
 * Returns the authorization that a sign-in returned in its own response. For a server that returns
 * none, such as one that predates it, it calls {@link authorize}. Each refusal is marked `signedIn`.
 */
export async function complete(
  auth: Config,
  options: complete.Options,
): Promise<Result> {
  const { body, key } = options
  if (!body.authorization)
    // The request's own `accessKey.account`, so an access key that the library generates keeps its
    // material.
    return await authorize(auth, { ...options.request, userId: body.user.id })
  try {
    const signed =
      'step' in body.authorization
        ? await Api.json<Api.Headless>(
            await sign(auth, {
              getFn: options.request.getFn,
              json: options.authorize,
              step: body.authorization,
            }),
          )
        : body.authorization
    const authorization = key
      ? Api.authorization(signed, key)
      : Api.withoutKey(signed)
    if (authorization.user.id !== body.user.id) throw sessionChanged()
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
    /** The authorization request that the sign-in sent, which the passkey step repeats. */
    authorize: ReturnType<typeof request>
    /** The sign-in's response. */
    body: {
      /**
       * The authorization, or the passkey step for a passkey-owned account. Absent from a server
       * that predates the authorization in the sign-in.
       */
      authorization?: Api.Headless | Step | undefined
      /** The signed-in user. */
      user: { id: string }
    }
    /** The access key that the request authorized, or `undefined` without one. */
    key: AccessKey.resolve.ReturnType | undefined
    /** The sign-in's options, for a server that returns no authorization. */
    request: prepare.Options
  }
}

/**
 * Returns the access key, or none without `accessKey`, and the authorization request that a sign-in
 * sends: an emailed-code sign-in with its code, and a passkey sign-in with its options.
 */
export async function prepare(auth: Config, options: prepare.Options) {
  const { accessKey } = options
  const key = accessKey ? await AccessKey.resolve(accessKey) : undefined
  return {
    authorize: request(auth, {
      accessKey: key && accessKey && { ...accessKey, account: key.accessKey },
      challenge: options.challenge,
    }),
    key,
  }
}

export declare namespace prepare {
  type Options = Omit<authorize.Options, 'userId'>
}

/**
 * Reads the JSON response of a sign-in that carried the authorization request. A refusal with the
 * `Tempo-Id-Signed-In` header came after the session started, so it is marked `signedIn`.
 */
export async function read<value>(response: Response): Promise<value> {
  try {
    return await Api.json<value>(response)
  } catch (error) {
    if (response.headers.get('Tempo-Id-Signed-In') === 'true')
      return Api.signedIn(error)
    throw error
  }
}

/**
 * Sends `POST /v1/authorize` with `json`. For a request with an access key, on a page that runs passkey
 * ceremonies, it requests the passkey step, signs it with {@link sign}, and returns the repeated
 * request's response. Otherwise it returns the response of the one request.
 */
export async function post(auth: Config, options: post.Options) {
  const { getFn, json, passkey = true } = options
  const response = await Api.post(auth, '/v1/authorize', {
    headers: await redemption(auth),
    json: {
      ...json,
      ...(passkey && steps(json, { getFn }) ? { passkey: true } : {}),
    },
  })
  if (!response.ok) return response
  // A successful response is the authorization or the step, which Tempo ID's schema validates.
  const body = (await response.clone().json()) as Api.Headless | Step
  if (!('step' in body)) return response
  const signed = await sign(auth, { getFn, json, step: body })
  if (signed.ok) return signed
  // A session that ended during the ceremony reads as a missing session, as on the first request.
  // Any other refusal, such as `webauthn_rejected`, which also has status 401, throws its reason.
  const refused = (await signed
    .clone()
    .json()
    .catch(() => ({}))) as Partial<Api.ErrorBody>
  if (refused.reason !== 'session_required') await Api.json(signed)
  return signed
}

export declare namespace post {
  type Options = {
    /** Runs the ceremony of the passkey that owns the account. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The authorization request. */
    json: ReturnType<typeof request>
    /** Whether a passkey-owned account signs the access key on the page. Defaults to `true`. */
    passkey?: boolean | undefined
  }
}

/**
 * Signs the options of the passkey `step` with the passkey on the page, and repeats
 * `POST /v1/authorize` with the assertion and the step's expiry. Returns that response. A failed
 * ceremony, such as a dismissed prompt or a passkey that this device does not hold, throws
 * `webauthn_required`, so the app can authorize through a redirect.
 */
export async function sign(auth: Config, options: sign.Options) {
  const { getFn, json, step } = options
  const deserialized = Authentication.deserializeOptions(step.step.options)
  const signed = await Authentication.sign(
    // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
    getFn ? ({ ...deserialized, getFn } as never) : deserialized,
  ).catch((error: unknown) => {
    throw new RequestError({
      cause: error,
      code: 'interaction_required',
      message:
        "Passkey ceremony failed: the account's passkey did not sign the key on this page. Authorize through a redirect, whose approval page signs it.",
      reason: 'webauthn_required',
      status: 0,
    })
  })
  const assertion = Authentication.serializeResponse(signed)
  // The step's expiry keeps the digest that the passkey signed, in place of a new default. A step
  // without one signs an access key that never expires, which an expiry of 0 requests.
  return await Api.post(auth, '/v1/authorize', {
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
}

export declare namespace sign {
  type Options = {
    /** Runs the passkey's ceremony. Defaults to `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The authorization request that returned the step. */
    json: ReturnType<typeof request>
    /** The passkey step. */
    step: Step
  }
}

/**
 * Returns whether a request asks for the passkey step: it carries an access key, and the page runs passkey
 * ceremonies, through `getFn` or `navigator.credentials`.
 */
export function steps(
  json: ReturnType<typeof request>,
  options: Pick<post.Options, 'getFn'>,
) {
  if (!json.key_authorization) return false
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
  /** The step. */
  step: {
    /** The options for `navigator.credentials.get()`, whose challenge is the access key's digest. */
    options: Types.CredentialRequestOptions<true>
    /** The kind of step. */
    type: 'passkey'
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

/** Returns the refusal of an authorization for another user than the sign-in's. */
function sessionChanged() {
  return new RequestError({
    code: 'invalid_request',
    message:
      'Session changed: another sign-in replaced this one before the authorization. Sign in again.',
    reason: 'session_changed',
    status: 409,
  })
}
