/**
 * Builds the requests that the actions send, in Tempo ID's wire format.
 * @module
 */
import { Base64, Bytes, Hash, Hex } from 'ox'
import type { Account } from 'viem/tempo'
import { type Config, ChallengeWithoutKeyError } from '../Accounts.js'
import type * as Funding from '../Funding.js'
import * as Pending from '../Pending.js'
import * as Permissions from '../Permissions.js'
import * as AccessKey from './accessKey.js'
import * as Api from './api.js'

/** Unpadded URL-safe Base64, as PKCE and `key_authorization` use. */
const base64url = { pad: false, url: true } as const

/**
 * Returns the authorization URL, `/oauth2/authorize`, and the `Pending` state to keep until the
 * callback, as `Actions.redirect.createUrl` returns them. If the instance {@link pushes} its
 * requests, the request goes to `/oauth2/par` first, and the URL holds only `client_id` and
 * `request_uri`, with a popup's `display` and `redirect_uri`. Throws `Accounts.ChallengeWithoutKeyError`
 * for a challenge without `accessKey`.
 */
export async function authorizeUrl(
  auth: Config,
  options: authorizeUrl.Options,
): Promise<authorizeUrl.ReturnType> {
  const { accessKey } = options
  if (!accessKey && options.challenge !== undefined)
    throw new ChallengeWithoutKeyError()
  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  const key = accessKey ? await AccessKey.resolve(accessKey) : undefined
  const pending = Pending.from({
    ...(key ? key.material : { key: false }),
    chainId: auth.chainId,
    clientId: auth.clientId,
    redirectUri,
    // `Bytes.random` needs only `crypto.getRandomValues`, which React Native polyfills.
    state: Base64.fromBytes(Bytes.random(16), base64url),
    verifier: Base64.fromBytes(Bytes.random(32), base64url),
  })
  const authorization =
    key && accessKey
      ? keyAuthorization(auth, {
          accessKey: { ...accessKey, account: key.accessKey },
        })
      : undefined
  // The issuer's endpoint redirects to the sign-in page at once. `/authorize` redirects here first.
  const url = new URL('/oauth2/authorize', auth.url)
  const parameters = new URLSearchParams({
    ...(options.challenge === undefined
      ? {}
      : { challenge: options.challenge }),
    client_id: auth.clientId,
    code_challenge: Base64.fromBytes(
      Hash.sha256(Bytes.fromString(pending.verifier)),
      base64url,
    ),
    code_challenge_method: 'S256',
    ...(options.display ? { display: options.display } : {}),
    ...funding(options),
    ...(authorization
      ? {
          key_authorization: Base64.fromString(
            JSON.stringify(authorization),
            base64url,
          ),
        }
      : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: auth.scope,
    state: pending.state,
  })
  // The issuer reads a pushed request from its push alone, but Tempo ID serves a popup's
  // `/oauth2/authorize` by the URL's `display` and `redirect_uri`, so a popup's URL repeats them.
  url.search = pushes(auth)
    ? new URLSearchParams({
        client_id: auth.clientId,
        ...(options.display
          ? { display: options.display, redirect_uri: redirectUri }
          : {}),
        request_uri: (await Api.par(auth, parameters)).request_uri,
      }).toString()
    : parameters.toString()
  return { pending, url: url.href }
}

export declare namespace authorizeUrl {
  type Options = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key, whose material `pending` keeps. Absent, the request names no
     * access key.
     */
    accessKey?: Permissions.WithAccount | undefined
    /** A message whose EIP-191 hash the key authorization binds as its `witness`. */
    challenge?: string | undefined
    /**
     * `popup` requests the compact screens of a popup, as OpenID Connect's `display=popup` does. The
     * last page then posts the callback to `window.opener` in place of the redirect, so only
     * `Actions.dialog` sets it. A pushed request holds it in the push, and its URL repeats it with
     * `redirect_uri`.
     */
    display?: 'popup' | undefined
    /**
     * The amount that the app needs in the user's Tempo Account. After the approval, an account that
     * holds less opens Tempo ID's funding page before the callback. Absent, no funding page opens.
     */
    funding?: Funding.Funding | undefined
    /** `login` requests a new sign-in of a user whom the browser holds signed in. */
    prompt?: 'login' | undefined
    /** Defaults to the instance's `redirectUri`, or the page's origin. */
    redirectUri?: string | undefined
  }

  type ReturnType = {
    /** What to keep until the callback. */
    pending: Pending.Pending | Pending.WithoutKey
    /** Where to send the browser. */
    url: string
  }
}

/** Returns the authorization request, with a key authorization request when `accessKey` is set. */
export function request(
  auth: Config,
  options: {
    /** The access key to authorize, if any, with the Viem account that signs with it. */
    accessKey?: keyAuthorization.AccessKey | undefined
    /** The Tempo Account the access key acts for, in place of the one `accessKey.account` names. */
    account?: `0x${string}` | undefined
    /** A message that the access key's witness binds. */
    challenge?: string | undefined
  },
) {
  const { accessKey, challenge } = options
  return {
    ...(challenge === undefined ? {} : { challenge }),
    client_id: auth.clientId,
    ...(accessKey
      ? {
          key_authorization: keyAuthorization(auth, {
            accessKey,
            account: options.account,
          }),
        }
      : {}),
    redirect_uri:
      auth.redirectUri ?? `${globalThis.location?.origin ?? auth.url}/`,
    scope: auth.scope,
    // An access key of a wallet.tempo passkey's account that waits for its upgrade signs as the passkey's
    // own account, and the sign-in then registers the access key and upgrades the account.
    ...(accessKey ? { skip_upgrade: true } : {}),
  }
}

/**
 * Returns the key authorization request. An access key account names its Tempo Account, and a plain
 * access key leaves the choice to Tempo ID.
 */
export function keyAuthorization(
  auth: Config,
  options: keyAuthorization.Options,
) {
  // Tempo ID fills an absent expiry. `Permissions.resolve` fills absent scopes from the limits.
  const { account: signer } = options.accessKey
  const permissions = Permissions.resolve(options.accessKey, {
    chainId: auth.chainId,
  })
  const account =
    options.account ?? (signer.accessKeyAddress ? signer.address : undefined)
  return {
    ...(account ? { account } : {}),
    address: signer.accessKeyAddress ?? signer.address,
    chainId: Hex.fromNumber(permissions.chainId),
    expiry: permissions.expiry,
    keyType: signer.keyType,
    limits: permissions.limits?.map(({ limit, period, token }) => ({
      limit: Hex.fromNumber(limit),
      ...(period ? { period } : {}),
      token,
    })),
    scopes: permissions.scopes,
  }
}

export declare namespace keyAuthorization {
  /** What the access key may do, and the Viem account that signs with it. */
  type AccessKey = Permissions.Permissions & {
    /** The access key that the request authorizes, the app's own or a new one. */
    account: Account.Account
  }

  type Options = {
    /** The access key to authorize. */
    accessKey: AccessKey
    /** The Tempo Account the access key acts for, in place of the one `accessKey.account` names. */
    account?: `0x${string}` | undefined
  }
}

/** Returns the funding hint parameters of `options`, or none without a hint. */
function funding(options: authorizeUrl.Options): Record<string, string> {
  const hint = options.funding
  if (!hint) return {}
  return {
    ...(hint.currency === undefined ? {} : { funding_currency: hint.currency }),
    funding_hint: hint.amount,
    ...(hint.token === undefined ? {} : { funding_token: hint.token }),
  }
}

/** Returns whether the instance pushes each authorization request to `/oauth2/par` (RFC 9126). */
export function pushes(auth: Config) {
  // A pushed request reaches Tempo ID from the app, so no one between can change it.
  return auth.par ?? Boolean(auth.clientSecret || auth.clientAssertion)
}
