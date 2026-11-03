/**
 * Signs a user in with an emailed code from an app's backend, which holds the client secret or the
 * private key of its client assertions. The
 * app's own UI, such as a native app's sign-in screen, collects the email and the code, and the
 * backend receives the user's tokens. No browser or cookie takes part.
 * @module
 */
import { Base64 } from 'ox'
import {
  type Config,
  ChallengeWithoutKeyError,
  RequestError,
} from '../../Id.js'
import type { Authorization } from '../../Authorization.js'
import * as AccessKey from '../../internal/accessKey.js'
import * as Api from '../../internal/api.js'
import { keyAuthorization } from '../../internal/request.js'
import type { ChainId, Keyed, WithAccount } from '../../Permissions.js'
import type { Tokens } from '../../Tokens.js'
import type { User } from '../../User.js'

/** The grant type of backend sign-in with an emailed code. */
const grantType = 'urn:tempo:params:oauth:grant-type:email-code'

/**
 * Emails the user a sign-in code, from the app's backend. The response is the same for every
 * address. The instance needs `clientSecret` or `clientAssertion`, and the app needs backend sign-in.
 *
 * @example
 * ```ts
 * const auth = Id.create({ clientId, clientSecret, url: 'https://id.tempo.xyz' })
 * await Actions.backend.email.sendCode(auth, { email, userIp })
 * ```
 */
export async function sendCode(
  auth: Config,
  options: sendCode.Options,
): Promise<void> {
  const { email, userIp } = options
  await Api.json(
    await (auth.fetch ?? fetch)(new URL('/v1/auth/code', auth.url), {
      body: JSON.stringify({
        client_id: auth.clientId,
        ...(await Api.clientAuthentication(authenticated(auth))),
        email,
        ...(userIp ? { user_ip: userIp } : {}),
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
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
): Promise<signIn.ReturnType<ChainId<accessKey>, Keyed<accessKey>>> {
  const { challenge, code, email, userIp } = options
  // A challenge rides in the access key, so a sign-in without one refuses it before it signs in.
  if (!options.accessKey && challenge !== undefined)
    throw new ChallengeWithoutKeyError()

  authenticated(auth)
  const { accessKey } = options
  const key = accessKey ? await AccessKey.resolve(accessKey) : undefined
  const body = await Api.token(auth, {
    ...(challenge === undefined ? {} : { challenge }),
    code,
    email,
    grant_type: grantType,
    ...(key && accessKey
      ? {
          key_authorization: Base64.fromString(
            JSON.stringify(
              keyAuthorization(auth, {
                accessKey: { ...accessKey, account: key.accessKey },
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
  // `key` decides both the type and the runtime value of the result.
  if (!key)
    return { ...tokens, user: Api.user(tokens) } as signIn.ReturnType<
      ChainId<accessKey>,
      Keyed<accessKey>
    >
  return Api.authorization<ChainId<accessKey>>(
    {
      account: body.account,
      key_authorization: body.key_authorization,
      tokens,
    },
    key,
  ) as signIn.ReturnType<ChainId<accessKey>, Keyed<accessKey>>
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
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope and an access key.
     */
    challenge?: ([accessKey] extends [undefined] ? never : string) | undefined
    /** The 6-digit code that Tempo ID emailed. */
    code: string
    /** The address that received the code. */
    email: string
    /** The end user's IP address, which rate limits count in place of the backend's. */
    userIp?: string | undefined
  }

  /** The authorization, or the tokens and the user for a sign-in without `accessKey`. */
  type ReturnType<
    chainId extends number = number,
    key extends boolean = false,
  > = key extends false ? Tokens & { user: User } : Authorization<chainId>
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
