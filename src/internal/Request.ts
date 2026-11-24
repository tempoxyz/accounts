/**
 * Builds the requests that the actions send, in Tempo ID's wire format.
 * @module
 */
import { AbiFunction, Address, Base64, Bytes, Hash, Hex } from 'ox'
import { zeroAddress } from 'viem'
import type { Account } from 'viem/tempo'
import {
  type Config,
  RedirectUriRequiredError,
  RequestError,
} from '../Accounts.js'
import type * as Funding from './Funding.js'
import * as Pending from './Pending.js'
import * as Permissions from '../Permissions.js'
import * as AccessKey from './AccessKey.js'
import * as Api from './Api.js'

/** Unpadded URL-safe Base64, as PKCE and `key_authorization` use. */
const base64url = { pad: false, url: true } as const

/**
 * The amount of a funding hint: a decimal string of up to 18 digits and 18 decimals, as Tempo ID
 * takes it.
 */
const fundingAmount = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/

/**
 * The smallest expiry that holds milliseconds in place of Unix seconds, which a sign-in refuses: 10^12 milliseconds is September
 * 2001, and 10^12 seconds is the year 33658.
 */
export const millisecondExpiry = 1e12

/**
 * Returns the authorization URL, `/oauth2/authorize`, and the `Pending` state to keep until the
 * callback, as `Actions.redirect.createUrl` returns them. If the instance {@link pushes} its
 * requests, the request goes to `/oauth2/par` first, and the URL holds only `client_id` and
 * `request_uri`, with a popup's `display` and `redirect_uri`. A challenge without `accessKey` names
 * the instance's chain, whose view of the account signs it.
 */
export async function authorizeUrl(
  auth: Config,
  options: authorizeUrl.Options,
): Promise<authorizeUrl.ReturnType> {
  const { accessKey } = options
  const redirectUri = (() => {
    const named = options.redirectUri ?? auth.redirectUri
    if (named !== undefined) return named
    // React Native defines `window` without `location`, and a server defines neither.
    const origin = globalThis.window?.location?.origin
    if (!origin) throw new RedirectUriRequiredError()
    return `${origin}/`
  })()
  // Another party holds an access key named by its address, so the page keeps no material for it.
  const resolved =
    accessKey && !('address' in accessKey)
      ? await AccessKey.resolve(accessKey)
      : undefined
  const pending = Pending.from({
    ...(resolved
      ? resolved.material
      : { accessKey: accessKey ? ('address' as const) : false }),
    chainId: auth.chainId,
    ...(options.challenge !== undefined ? { challenge: true as const } : {}),
    clientId: auth.clientId,
    issuer: new URL(auth.url).origin,
    redirectUri,
    // `Bytes.random` needs only `crypto.getRandomValues`, which React Native polyfills.
    state: Base64.fromBytes(Bytes.random(16), base64url),
    verifier: Base64.fromBytes(Bytes.random(32), base64url),
  })
  const authorization = (() => {
    if (!accessKey) return undefined
    if ('address' in accessKey) return keyAuthorization(auth, { accessKey })
    return keyAuthorization(auth, {
      accessKey: { ...accessKey, account: resolved!.signer },
    })
  })()
  // The issuer's endpoint redirects to the sign-in page at once. `/authorize` redirects here first.
  const url = new URL('/oauth2/authorize', auth.url)
  const parameters = new URLSearchParams({
    ...challengeParameters(auth, {
      accessKey: Boolean(accessKey),
      challenge: options.challenge,
    }),
    client_id: auth.clientId,
    // In the web message mode, Tempo ID sets the challenge and redeems the code itself.
    ...(options.responseMode === 'web_message'
      ? {}
      : {
          code_challenge: Base64.fromBytes(
            Hash.sha256(Bytes.fromString(pending.verifier)),
            base64url,
          ),
          code_challenge_method: 'S256',
        }),
    ...(options.display ? { display: options.display } : {}),
    ...fundingParameters(options.funding),
    ...(options.guest === false
      ? {}
      : guestParameters(auth, { challenge: options.challenge })),
    ...(authorization
      ? {
          key_authorization: Base64.fromString(
            JSON.stringify(authorization),
            base64url,
          ),
        }
      : {}),
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    redirect_uri: redirectUri,
    ...(options.responseMode ? { response_mode: options.responseMode } : {}),
    response_type: 'code',
    scope: options.scope ?? auth.scope,
    state: pending.state,
  })
  for (const resource of resources(auth, options))
    parameters.append('resource', resource)
  // The issuer reads a pushed request from its push alone, but Tempo ID serves a popup's
  // `/oauth2/authorize` by the URL's `display` and `redirect_uri`, so a popup's URL repeats them.
  url.search =
    (options.par ?? pushes(auth))
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
    accessKey?: Permissions.WithAccount | Permissions.WithAddress | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * Tempo ID's page shows the message, from any app, with or without an access key.
     */
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
    /**
     * Whether the request offers "Continue as guest", as {@link guestParameters} decides. `false`
     * for a request whose challenge arrives later. Defaults to `true`.
     */
    guest?: boolean | undefined
    /** The address that the sign-in page's email field holds, as OpenID Connect's `login_hint`. */
    loginHint?: string | undefined
    /** Whether the request goes to `/oauth2/par` first. Defaults to {@link pushes}. */
    par?: boolean | undefined
    /** `login` requests a new sign-in of a user whom the browser holds signed in. */
    prompt?: 'login' | undefined
    /** Defaults to the instance's `redirectUri`, or the page's origin. */
    redirectUri?: string | undefined
    /** The registered resources that the tokens are for. Defaults to the instance's `resource`. */
    resource?: Config['resource']
    /**
     * `web_message` asks Tempo ID's page in a frame or a popup to post the authorization, with the
     * code that Tempo ID redeemed, in place of the callback URL. The request then sends no PKCE
     * challenge. Only `Actions.dialog` sets it. Absent, the callback carries a code that the app
     * redeems.
     */
    responseMode?: 'web_message' | undefined
    /** The scopes of the tokens, separated by spaces. Defaults to the instance's `scope`. */
    scope?: string | undefined
  }

  type ReturnType = {
    /** What to keep until the callback. */
    pending: Pending.Addressed | Pending.Pending | Pending.WithoutAccessKey
    /** Where to send the browser. */
    url: string
  }
}

/**
 * Returns the parameters of an authorization request's `challenge`: the message, and for a request
 * without an access key, the instance's chain, whose view of the account signs it. Returns none
 * without `challenge`.
 */
export function challengeParameters(
  auth: Pick<Config, 'chainId'>,
  options: challengeParameters.Options,
): Record<string, string> {
  if (options.challenge === undefined) return {}
  return {
    ...(options.accessKey ? {} : { chain_id: String(auth.chainId) }),
    challenge: options.challenge,
  }
}

export declare namespace challengeParameters {
  type Options = {
    /** Whether the request names an access key, whose `chainId` names the chain that signs. */
    accessKey: boolean
    /** The message. Absent, the request names none. */
    challenge: string | undefined
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
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * Tempo ID's page shows the message, from any app, with or without an access key.
     */
    challenge?: string | undefined
  },
) {
  const { accessKey, challenge } = options
  return {
    // A challenge without an access key names the instance's chain, whose view of the account signs
    // it, and any account that signs it in place of the selected one.
    ...(challenge !== undefined && !accessKey
      ? {
          ...(options.account ? { account: options.account } : {}),
          chain_id: auth.chainId,
        }
      : {}),
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
 * Returns the resolved permissions of `accessKey`. Throws `invalid_expiry` for an expiry that is not
 * a whole number of seconds, such as `Date.now() / 1000 + 3600`, or that holds milliseconds, such as
 * `Date.now() + 3_600_000`, and `expiry_passed` for an expiry that has passed, such as a lifetime
 * passed as Unix seconds, as Tempo ID refuses them, or would read as thousands of years away. An expiry of
 * 0 never expires. Throws `empty_limits` for empty limits, `empty_scopes` for empty scopes,
 * `invalid_field` for a negative limit, `invalid_period` for a period, as a number or a duration,
 * that is not a whole number of seconds from 0 to `Number.MAX_SAFE_INTEGER`, `duplicate_limit` for
 * two limits on one token, `duplicate_scope` for two scopes of one call on a target, and
 * `invalid_recipients` for the zero address or a repeated address in `spenders` or a scope's
 * `recipients`. A dialog calls it before its popup opens, so a refused request opens no window.
 */
export function permissions(
  auth: Pick<Config, 'chainId'>,
  options: permissions.Options,
) {
  // `Permissions.resolve` fills absent scopes from the limits.
  const resolved = Permissions.resolve(options.accessKey, {
    chainId: auth.chainId,
  })
  if (resolved.expiry !== undefined && !Number.isSafeInteger(resolved.expiry))
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey.expiry',
      message: `Invalid \`expiry\`: ${resolved.expiry} is not a whole number of seconds. Round the Unix time down with \`Math.floor\`, or use a duration, such as \`'1h'\`.`,
      reason: 'invalid_expiry',
      status: 0,
    })
  // `Date.now()` returns milliseconds, which Tempo ID reads as an expiry thousands of years away, so
  // the access key would outlive the lifetime that the app names.
  if (resolved.expiry !== undefined && resolved.expiry >= millisecondExpiry)
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey.expiry',
      message: `Invalid \`expiry\`: ${resolved.expiry} is after the year 33658, such as a time in milliseconds. Use Unix seconds, such as \`Math.floor(Date.now() / 1000) + 3600\`, or a duration, such as \`'1h'\`.`,
      reason: 'invalid_expiry',
      status: 0,
    })
  if (resolved.expiry && resolved.expiry <= Date.now() / 1000)
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey.expiry',
      message: `Invalid \`expiry\`: ${new Date(resolved.expiry * 1000).toUTCString()} has passed. Use a future Unix time in seconds, or a duration, such as \`'1h'\`.`,
      reason: 'expiry_passed',
      status: 0,
    })
  // Tempo ID refuses empty limits and empty scopes in every flow, so they are refused before any
  // request.
  if (resolved.limits?.length === 0)
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey.limits',
      message:
        'Empty `limits`. Name at least one token, or leave out `limits` in a headless sign-in that may spend any amount.',
      reason: 'empty_limits',
      status: 0,
    })
  if (resolved.scopes?.length === 0)
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey.scopes',
      message:
        'Empty `scopes`. Name at least one call, or leave out `scopes` to fill them from `limits`.',
      reason: 'empty_scopes',
      status: 0,
    })
  // A negative limit has no hex quantity, so it is refused before any request, as Tempo ID refuses
  // a limit that is not one.
  const { limits = [] } = resolved
  const negative = limits
    .map((entry, index) => ({ entry, index }))
    .find((item) => item.entry.limit < 0n)
  if (negative)
    throw new RequestError({
      code: 'invalid_request',
      field: `accessKey.limits.${negative.index}.limit`,
      message: `Invalid limit on ${negative.entry.token}: the limit is negative. Use a limit of 0 or more.`,
      reason: 'invalid_field',
      status: 0,
    })
  // Tempo ID refuses a period that is fractional or negative, so it is refused before any request.
  // The check reads a requested number, since `Permissions.resolve` drops a period of `NaN`, which
  // would sign a one-time total in place of a resetting limit. It reads the resolved seconds of a
  // duration, which a double rounds above `Number.MAX_SAFE_INTEGER`, so the request would hold
  // another period than the requested one.
  const period = (options.accessKey.limits ?? [])
    .map((entry, index) => ({
      entry,
      index,
      seconds:
        typeof entry.period === 'number'
          ? entry.period
          : (limits[index]?.period ?? 0),
    }))
    .find((item) => !Number.isSafeInteger(item.seconds) || item.seconds < 0)
  if (period)
    throw new RequestError({
      code: 'invalid_request',
      field: `accessKey.limits.${period.index}.period`,
      message: `Invalid \`period\` on ${period.entry.token}: ${period.entry.period} is not a whole number of seconds from 0 to ${Number.MAX_SAFE_INTEGER}. Use a whole number of seconds, a duration, such as \`'1d'\`, or 0 for a one-time limit.`,
      reason: 'invalid_period',
      status: 0,
    })
  // Two limits on one token, such as by its symbol and by its address, are refused before any
  // request, as Tempo ID refuses them, since TIP-1011 limits each token once.
  const duplicate = limits
    .map((entry, index) => ({ entry, index }))
    .find((item) =>
      limits
        .slice(0, item.index)
        .some((earlier) => Address.isEqual(earlier.token, item.entry.token)),
    )
  if (duplicate)
    throw new RequestError({
      code: 'invalid_request',
      field: `accessKey.limits.${duplicate.index}.token`,
      message: `Duplicate limit for ${duplicate.entry.token}. Limit each token once.`,
      reason: 'duplicate_limit',
      status: 0,
    })
  // Tempo ID refuses two scopes of one call on a target, or a scope of any call beside another on
  // its target, since TIP-1011 holds one rule for each call. So they are refused before any request,
  // also in a page's sign-in, whose callback holds no `reason`.
  const scopes = resolved.scopes ?? []
  // Each target's selectors so far, with `undefined` for a scope of any call, so the check reads
  // each scope once.
  const rules = new Map<string, Set<string | undefined>>()
  const repeated = scopes
    .map((scope, index) => ({ index, scope }))
    .find((item) => {
      const { address } = item.scope
      if (!Address.validate(address, { strict: false })) return false
      const key = address.toLowerCase()
      const call =
        item.scope.selector === undefined
          ? undefined
          : selector(item.scope.selector)
      const named = rules.get(key)
      if (
        named &&
        (call === undefined || named.has(undefined) || named.has(call))
      )
        return true
      rules.set(key, (named ?? new Set()).add(call))
      return false
    })
  if (repeated)
    throw new RequestError({
      code: 'invalid_request',
      field: `accessKey.scopes.${repeated.index}.selector`,
      message: `Duplicate scope for ${repeated.scope.selector ?? 'any call'} on ${repeated.scope.address}. Name each call on a target once.`,
      reason: 'duplicate_scope',
      status: 0,
    })
  // Tempo ID refuses the zero address or a repeated address among the recipients of a scope, which
  // `spenders` fills, so they are refused before any request too. A malformed address is left to Tempo ID. Without `scopes`, the error names
  // the limit's `spenders`, which the app wrote.
  const recipient = (() => {
    const lists =
      options.accessKey.scopes === undefined
        ? (options.accessKey.limits ?? []).map((entry, index) => ({
            field: `accessKey.limits.${index}.spenders`,
            values: entry.spenders ?? [],
          }))
        : scopes.map((scope, index) => ({
            field: `accessKey.scopes.${index}.recipients`,
            values: scope.recipients ?? [],
          }))
    for (const list of lists) {
      const seen = new Set<string>()
      const position = list.values.findIndex((value) => {
        if (!Address.validate(value, { strict: false })) return false
        const address = value.toLowerCase()
        if (address === zeroAddress || seen.has(address)) return true
        seen.add(address)
        return false
      })
      if (position !== -1)
        return {
          field: `${list.field}.${position}`,
          value: list.values[position]!,
        }
    }
    return undefined
  })()
  if (recipient)
    throw new RequestError({
      code: 'invalid_request',
      field: recipient.field,
      message: `Invalid recipient ${recipient.value}: it is the zero address, or it repeats. Name each recipient once, and never the zero address.`,
      reason: 'invalid_recipients',
      status: 0,
    })
  return resolved
}

export declare namespace permissions {
  type Options = {
    /** What the access key may do. */
    accessKey: Permissions.Permissions
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
  // Tempo ID fills an absent expiry.
  const { accessKey } = options
  const resolved = permissions(auth, { accessKey })
  // An access key that another party holds names only its address, and its Tempo Account, if any.
  const named = (() => {
    if ('address' in accessKey)
      return {
        account: options.account ?? accessKey.access,
        address: accessKey.address,
        keyType: accessKey.type ?? 'secp256k1',
        witness: accessKey.witness,
      }
    const { account: signer } = accessKey
    return {
      account:
        options.account ??
        (signer.accessKeyAddress ? signer.address : undefined),
      address: signer.accessKeyAddress ?? signer.address,
      keyType: signer.keyType,
      witness: undefined,
    }
  })()
  return {
    ...(named.account ? { account: named.account } : {}),
    address: named.address,
    chainId: Hex.fromNumber(resolved.chainId),
    expiry: resolved.expiry,
    keyType: named.keyType,
    // TIP-1011 holds a fee allowance as limits, so the request sends it after the app's own.
    limits:
      resolved.limits &&
      [...resolved.limits, ...(resolved.fees ?? [])].map(
        ({ limit, period, token }) => ({
          limit: Hex.fromNumber(limit),
          ...(period ? { period } : {}),
          token,
        }),
      ),
    scopes: resolved.scopes,
    ...(named.witness ? { witness: named.witness } : {}),
  }
}

export declare namespace keyAuthorization {
  /** What the access key may do, and the Viem account that signs with it. */
  type AccessKey = Permissions.Permissions & {
    /** The access key that the request authorizes, the app's own or a new one. */
    account: Account.Account
  }

  type Options = {
    /** The access key to authorize, or one that another party holds, by its address. */
    accessKey: AccessKey | Permissions.WithAddress
    /** The Tempo Account the access key acts for, in place of the one `accessKey.account` names. */
    account?: `0x${string}` | undefined
  }
}

/**
 * Returns `guest=offer` for a sign-in request of an instance with `guest: 'offer'`, so Tempo ID's
 * sign-in page offers "Continue as guest". A request with a challenge offers none, since a guest
 * session signs no challenge. Returns none otherwise.
 */
export function guestParameters(
  auth: Pick<Config, 'guest'>,
  options: guestParameters.Options,
): Record<string, string> {
  if (auth.guest !== 'offer' || options.challenge !== undefined) return {}
  return { guest: 'offer' }
}

export declare namespace guestParameters {
  type Options = {
    /** The request's challenge. Absent, the request names none. */
    challenge: unknown
  }
}

/**
 * Returns the funding hint parameters of `hint`, or none without a hint. Throws `invalid_field` with
 * status 0 and the hint's `field` for an `amount` that is not a decimal string above 0, a
 * `currency` that is not three capital letters, or a `token` that is empty or longer than 64
 * characters, as Tempo ID refuses them. A field that is not a string, such as from untyped input,
 * fails the same way. A redirect sign-in thus leaves no page for a hint that
 * Tempo ID sends back.
 */
export function fundingParameters(
  hint: Funding.Funding | undefined,
): Record<string, string> {
  if (!hint) return {}
  if (
    typeof hint.amount !== 'string' ||
    !fundingAmount.test(hint.amount) ||
    /^0(?:\.0*)?$/.test(hint.amount)
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'funding.amount',
      message: `Invalid \`funding.amount\`: "${String(hint.amount)}" is not a decimal amount above 0 with at most 18 digits and 18 decimals. Pass such a decimal string, such as \`'10'\`.`,
      reason: 'invalid_field',
      status: 0,
    })
  if (
    hint.currency !== undefined &&
    (typeof hint.currency !== 'string' || !/^[A-Z]{3}$/.test(hint.currency))
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'funding.currency',
      message: `Invalid \`funding.currency\`: "${String(hint.currency)}" is not an ISO 4217 code. Pass three capital letters, such as \`'USD'\`.`,
      reason: 'invalid_field',
      status: 0,
    })
  if (
    hint.token !== undefined &&
    (typeof hint.token !== 'string' ||
      hint.token.length === 0 ||
      hint.token.length > 64)
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'funding.token',
      message:
        "Invalid `funding.token`: the token is empty or longer than 64 characters. Pass the symbol or address of a token, such as `'USDC.e'`.",
      reason: 'invalid_field',
      status: 0,
    })
  return {
    ...(hint.currency === undefined ? {} : { funding_currency: hint.currency }),
    funding_hint: hint.amount,
    ...(hint.token === undefined ? {} : { funding_token: hint.token }),
  }
}

/**
 * Returns the registered resources (RFC 8707) that a request names as `resource`: those of
 * `options`, or else the instance's. Empty, the request names none, and its tokens are for Tempo
 * ID's origin.
 */
export function resources(
  auth: Pick<Config, 'resource'>,
  options: resources.Options = {},
): readonly string[] {
  const resource = options.resource ?? auth.resource
  if (resource === undefined) return []
  return typeof resource === 'string' ? [resource] : resource
}

export declare namespace resources {
  type Options = {
    /** The resources of the request, in place of the instance's. */
    resource?: Config['resource']
  }
}

/** Returns whether the instance pushes each authorization request to `/oauth2/par` (RFC 9126). */
export function pushes(auth: Config) {
  // A pushed request reaches Tempo ID from the app, so no one between can change it.
  return auth.par ?? Boolean(auth.clientSecret || auth.clientAssertion)
}

/**
 * Returns a scope's selector as the 4-byte form that two scopes compare by, from a selector or a
 * function signature. A signature that does not parse stays as written, for Tempo ID to refuse.
 */
function selector(value: string) {
  if (value.startsWith('0x')) return value.toLowerCase()
  try {
    return AbiFunction.getSelector(value)
  } catch {
    return value
  }
}
