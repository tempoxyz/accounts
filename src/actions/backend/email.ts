/**
 * Signs a user in with an emailed code from an app's backend, which holds the client secret or the
 * private key of its client assertions. The
 * app's own UI, such as a native app's sign-in screen, collects the email and the code, and the
 * backend receives the user's tokens. No browser or cookie takes part.
 * @module
 */
import { Base64 } from 'ox'
import { type Config, RequestError } from '../../Accounts.js'
import type { Authorization } from '../../internal/Authorization.js'
import * as AccessKey from '../../internal/AccessKey.js'
import * as Api from '../../internal/Api.js'
import * as Code from '../../internal/Code.js'
import { keyAuthorization } from '../../internal/Request.js'
import type { ChainId, HasAccessKey, WithAccount } from '../../Permissions.js'

/** The grant type of backend sign-in with an emailed code. */
const grantType = 'urn:tempo:params:oauth:grant-type:email-code'

/**
 * Emails the user a sign-in code, from the app's backend. The response is the same for every
 * address. The instance needs `clientSecret` or `clientAssertion`, and the app needs backend sign-in.
 *
 * @throws {Accounts.RequestError} With `invalid_client` and status 0, before any request, when the
 *   instance holds no `clientSecret` or `clientAssertion`.
 *
 * @example
 * ```ts
 * const auth = Accounts.create({ clientId, clientSecret, url: 'https://id.tempo.xyz' })
 * await Actions.backend.email.sendCode(auth, { email, userIp })
 * ```
 */
export async function sendCode(
  auth: Config,
  options: sendCode.Options,
): Promise<void> {
  const { email, userIp } = options
  const offline = Api.answered(auth, {
    message:
      'The code request received no response. Check the connection, and request the code again.',
  })
  await Api.json(
    await (offline.fetch ?? fetch)(new URL('/v1/auth/code', auth.url), {
      body: JSON.stringify({
        client_id: auth.clientId,
        ...(await Api.clientAuthentication(authenticated(auth))),
        email,
        ...(userIp ? { user_ip: userIp } : {}),
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      // A redirect would send the client authentication to another origin.
      redirect: 'manual',
    }),
  )
}

export declare namespace sendCode {
  type Options = {
    /** The user's email address. */
    email: string
    /**
     * The end user's IP address, which rate limits count in place of the backend's. Leave it out
     * only when the backend has no user address.
     */
    userIp?: string | undefined
  }
}

/**
 * Signs the user in with the emailed code, from the app's backend, and returns the user's tokens.
 * The first sign-in of an address creates the user, and each sign-in creates the user's first
 * Tempo Account if the user holds none. The access key must fit the headless ceiling. A passkey-owned
 * account throws `webauthn_required`, since no page signs its access key.
 *
 * @throws {Accounts.RequestError} With `invalid_client` and status 0, before any request, when the
 *   instance holds no `clientSecret` or `clientAssertion`.
 * @throws {Accounts.RequestError} With `invalid_field`, the field `code`, and status 0, before any
 *   request, when `code` holds other than 6 digits.
 *
 * @example
 * ```ts
 * const authorization = await Actions.backend.email.signIn(auth, { code, email, userIp })
 * ```
 */
export async function signIn<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: signIn.Options<accessKey>,
): Promise<signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>> {
  const { challenge, email, userIp } = options
  // A code without 6 digits throws before any request, or the prompt of `link`'s passkey.
  const code = Code.from(options.code)
  authenticated(auth)
  const { accessKey } = options
  const resolved = accessKey ? await AccessKey.resolve(accessKey) : undefined
  // A request without a response may have spent the code.
  const offline = Api.answered(auth, {
    message:
      'The sign-in received no response. Check the connection, and sign in again. If the code is refused, request a new code.',
  })
  const body = await Api.token(offline, {
    // A challenge without an access key names the instance's chain, whose view of the account signs it.
    ...(challenge !== undefined && !resolved
      ? { chain_id: String(auth.chainId) }
      : {}),
    ...(challenge === undefined ? {} : { challenge }),
    code,
    email,
    grant_type: grantType,
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
    scope: auth.scope,
    ...(userIp ? { user_ip: userIp } : {}),
  })
  const tokens = Api.tokens(body)
  // `accessKey` decides both the type and the runtime value of the result.
  if (!resolved)
    return {
      ...tokens,
      ...Api.challengeSignature(body, { challenged: challenge !== undefined }),
      user: Api.user(tokens),
    } as signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>
  return Api.authorization<ChainId<accessKey>>(
    {
      account: body.account,
      ...(body.challenge_signature
        ? { challenge_signature: body.challenge_signature }
        : {}),
      key_authorization: body.key_authorization,
      tokens,
    },
    { ...resolved, challenged: challenge !== undefined },
  ) as signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>
}

export declare namespace signIn {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new secp256k1 access key. Without it, the sign-in authorizes no access key. It
     * names its limits and scopes, within the headless ceiling, for every app.
     */
    accessKey?: accessKey
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * A sign-in on the app's page needs the `tempo-id:sign` scope.
     */
    challenge?: string | undefined
    /**
     * The 6-digit code that Tempo ID emailed. The call drops each character other than a digit, and
     * reads a full-width or Arabic-Indic digit as its ASCII digit.
     */
    code: string
    /** The address that received the code. */
    email: string
    /** The end user's IP address, which rate limits count in place of the backend's. */
    userIp?: string | undefined
  }

  /**
   * The authorization, or the tokens, the user, and any challenge's signature for a sign-in without
   * `accessKey`.
   */
  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = false,
  > = hasAccessKey extends false ? Api.WithoutAccessKey : Authorization<chainId>
}

/** Returns `auth`, and throws `invalid_client` without a client secret or assertion. */
function authenticated(auth: Config) {
  if (auth.clientAssertion || auth.clientSecret) return auth
  throw new RequestError({
    code: 'invalid_client',
    message:
      "Missing client authentication: backend sign-in authenticates with the app's secret or a client assertion. Create the instance with `clientSecret` or `clientAssertion` on the app's backend.",
    reason: 'invalid_client',
    status: 0,
  })
}
