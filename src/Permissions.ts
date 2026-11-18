/**
 * What an app's access key may do, and its resolution into the key authorization that a sign-in
 * requests, with the fee allowance of an access key whose limits cannot pay its network fees.
 * @module
 */
import { Address, type Hex, Value } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import type { OneOf } from 'viem'
import { type Account, Addresses, Scopes, Selectors } from 'viem/tempo'
import { defineToken, tokens } from 'viem/tokens'
import type { AccessKey } from './internal/AccessKey.js'
import * as Chains from './internal/Chains.js'
import * as FeeAllowance from './internal/FeeAllowance.js'

/**
 * Thrown by {@link resolve}, and by each sign-in, for a decimal `limit` on a token that the chain
 * does not list, whose decimals the library thus does not list. Pass the limit in base units as a
 * bigint.
 */
export class DecimalsUnknownError extends Error {
  override readonly name = 'Permissions.DecimalsUnknownError'

  constructor(options: { token: string }) {
    super(
      `Unknown decimals for token ${options.token}: a decimal \`limit\` needs a listed token. Pass the limit in base units as a bigint, or name a listed token.`,
    )
  }
}

/**
 * Thrown by {@link resolve}, and by each sign-in, for a duration string that is not a whole number
 * and one of the units `s`, `m`, `h`, `d`, or `w`, such as `'1d'`.
 */
export class InvalidDurationError extends Error {
  override readonly name = 'Permissions.InvalidDurationError'

  constructor(options: { value: string }) {
    super(
      `Invalid duration "${options.value}": a duration is a whole number and one of the units s, m, h, d, or w, such as "30m" or "1d".`,
    )
  }
}

/**
 * Thrown by {@link resolve}, and by each sign-in, for a decimal `limit` that holds no plain decimal
 * number, such as one in exponent notation: `'1e-7'`, which `String(0.0000001)` returns. Pass the
 * limit without an exponent, or in base units as a bigint.
 */
export class InvalidLimitError extends Error {
  override readonly name = 'Permissions.InvalidLimitError'

  constructor(options: { limit: string }) {
    super(
      `Invalid limit "${options.limit}": a decimal limit holds only digits and one ".", such as "10" or "0.5". Pass the limit without an exponent, or in base units as a bigint.`,
    )
  }
}

/**
 * Thrown by {@link resolve}, and by each sign-in, for a decimal `limit` with more fractional digits
 * than its token's decimals, such as `'0.0000005'` for a 6-decimal token. Round the limit down.
 */
export class LimitPrecisionError extends Error {
  override readonly name = 'Permissions.LimitPrecisionError'

  constructor(options: { decimals: number; limit: string }) {
    super(
      `Invalid limit "${options.limit}": the token has ${options.decimals} decimals. Round the limit down to ${options.decimals} fractional digits.`,
    )
  }
}

/**
 * Thrown by {@link resolve}, and by each sign-in, for a limit that names a token symbol that the
 * chain does not list. Pass the token's address.
 */
export class TokenUnknownError extends Error {
  override readonly name = 'Permissions.TokenUnknownError'

  constructor(options: { chainId: number; token: string }) {
    super(
      `Unknown token "${options.token}" on chain ${options.chainId}. Name a token that the chain lists, such as "ousd", or pass its address.`,
    )
  }
}

/**
 * A length of time: a whole number and a unit, such as `'30m'` or `'1d'`. The units are seconds
 * (`s`), minutes (`m`), hours (`h`), days (`d`), and weeks (`w`).
 */
export type Duration = `${bigint}${'d' | 'h' | 'm' | 's' | 'w'}`

/** How much of one token an access key may spend. */
export type Limit = {
  /**
   * The total that the access key may spend: a decimal string in the token's units, such as `'10'`,
   * or a bigint in base units, such as `10_000_000n`. A decimal string needs a listed token. A
   * sign-in with a negative limit throws `Accounts.RequestError` with `invalid_field` before the
   * request that carries the access key.
   */
  limit: bigint | `${number}`
  /**
   * The period after which the limit resets: a {@link Duration}, such as `'1d'`, or whole seconds.
   * Absent for a one-time total. A sign-in with a fractional or negative number, or with a period
   * above `Number.MAX_SAFE_INTEGER` seconds, throws `Accounts.RequestError` with
   * [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period)
   * and status 0, before the request that carries the access key.
   */
  period?: Duration | number | undefined
  /**
   * The contracts that the access key may approve to spend the token. Absent, the scopes that
   * {@link resolve} fills from the limits include no `approve`. A sign-in with the zero address or
   * a repeated address throws `Accounts.RequestError` with
   * [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients)
   * and status 0, before the request that carries the access key.
   */
  spenders?: readonly Address.Address[] | undefined
  /** The token: its symbol on the chain, such as `'ousd'` or `'OUSD'`, or its address. */
  token: Token
}

/**
 * What an app's access key may do. `Accounts.create` takes it, or a function that returns it, for
 * each sign-in, and each sign-in and `authorize` take it as `accessKey`, or `false` for no access
 * key. {@link resolve} turns it into the key authorization request at each call. Without `expiry`,
 * Tempo ID fills the
 * [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry)
 * from the app's refresh token lifetime, at most one year. Without `limits`, the access key spends
 * any amount. Without `scopes`, {@link resolve} fills them from `limits`. An access key that never
 * expires (`expiry: false`), spends any amount (no `limits`), or makes any call (`scopes: 'any'`)
 * is an
 * [access key without bounds](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#access-keys-without-bounds).
 * Tempo ID refuses it, unless a headless sign-in of an app with the `tempo-id:sign` scope requests
 * it. `chainId` types the authorization's `accessKey.chainId`.
 */
export type Permissions<chainId extends number = number> = {
  /** The access key's chain, such as `tempoTestnet.id`. Defaults to the instance's `chainId`. */
  chainId?: chainId | undefined
  /**
   * When the access key expires: a {@link Duration} from the request, such as `'1d'`, Unix
   * seconds, such as Viem's `Expiry.days(1)`, or `false` for an access key that never expires. A
   * sign-in with a number that has passed, such as a lifetime of `3600` in place of `'1h'`, throws
   * [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed) with
   * `status` 0, before the request that carries the access key or the navigation to Tempo ID. A
   * number that is not a whole number of seconds, such as `Date.now() / 1000 + 3600`, or that holds
   * milliseconds, such as `Date.now() + 3_600_000`, throws
   * [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry)
   * with status 0 there too, since Tempo ID's page reads milliseconds as an expiry thousands of
   * years away. For `false`, the request sends an expiry of 0. Tempo ID accepts it only for a headless sign-in of a
   * first-party app with the `tempo-id:sign` scope, and refuses it elsewhere with
   * [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry).
   * Absent, the request sends no expiry, and Tempo ID fills it with the app's refresh token
   * lifetime from the sign-in, at most one year. The default refresh token lifetime is 30 days.
   */
  expiry?: Duration | number | false | undefined
  /**
   * How much of each token the access key may spend, in total or per `period`, such as
   * `[{ limit: '10', token: 'ousd' }]`. Each token takes one limit. A sign-in with two limits on
   * one token, such as `'ousd'` and its address, throws `Accounts.RequestError` with
   * `duplicate_limit` before the request that carries the access key. An empty list throws
   * `Accounts.RequestError` with `empty_limits` and status 0 there too. Absent for an access key
   * that spends any amount of any token.
   */
  limits?: readonly Limit[] | undefined
  /**
   * The calls the access key may make, such as `[Scopes.tip20(token).transfer()]` from Viem, or
   * `'any'` for an access key that makes any call, also with `limits`. Absent with `limits`, the
   * scopes are `transfer` and `transferWithMemo` on each limited token, `approve` to each limit's
   * `spenders`, and `open` and `topUp` on the TIP-1034 channel reserve, which MPP sessions pay
   * through. Absent without `limits`, the request sends no scopes, and the access key makes any
   * call. Named scopes replace the filled ones. An empty list throws `Accounts.RequestError` with
   * `empty_scopes` and status 0, two scopes of one call on a target throw `duplicate_scope`, and
   * a repeated or zero address in a scope's `recipients` throws `invalid_recipients`, each with
   * status 0, before the request that carries the access key. Only a headless
   * access key of an app with `tempo-id:sign` may make any call. Tempo ID refuses it elsewhere with
   * [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions).
   */
  scopes?: KeyAuthorization.KeyAuthorization['scopes'] | 'any'
}

/**
 * The access key of a low-level action: its {@link Permissions}, and the app's own access key in
 * place of a new one, as a Viem account, or as its `publicKey` and `type` for an access key whose
 * private key the page does not hold.
 */
export type WithAccount<chainId extends number = number> =
  Permissions<chainId> &
    OneOf<
      | {
          /**
           * The app's own access key, as a Viem account. Its `access` names the Tempo Account, which
           * defaults to the app's selected account, or the user's oldest. Defaults to a new access
           * key, whose material the authorization keeps.
           */
          account?: Account.Account | undefined
        }
      | {
          /**
           * The public key of the app's own access key, with or without its `0x04` prefix. The
           * result's `signer` rejects each signature with `AccessKey.SignerRequiredError`.
           */
          publicKey: Hex.Hex
          /** The signature type of the access key of `publicKey`. Defaults to `secp256k1`. */
          type?: 'p256' | 'secp256k1' | undefined
        }
    >

/**
 * The access key of a redirect or dialog sign-in that another party holds, such as an MPP merchant,
 * named by its `address`. The result holds the signed access key, and no `signer`, since nothing on
 * the page signs with it.
 */
export type WithAddress<chainId extends number = number> =
  Permissions<chainId> & {
    /**
     * The Tempo Account that the access key acts for. Defaults to the app's selected account, or
     * the user's oldest.
     */
    access?: Address.Address | undefined
    /** The access key's address. */
    address: Address.Address
    /** The signature type of the access key. Defaults to `secp256k1`. */
    type?: 'p256' | 'secp256k1' | 'webAuthn' | undefined
    /**
     * 32 bytes that the key authorization binds unchanged as its `witness`, such as the ID of an
     * MPP subscription challenge. Absent, the key authorization binds none.
     */
    witness?: Hex.Hex | undefined
  }

/**
 * Whether an action's `accessKey` names an access key that another party holds, by its address.
 */
export type Addressed<accessKey> = accessKey extends {
  address: Address.Address
}
  ? true
  : false

/**
 * The permissions that {@link resolve} returns, as the key authorization request sends them: Unix
 * seconds, base units, addresses, and scopes. The request sends `fees` after `limits`, as limits of
 * the access key.
 */
export type Resolved = {
  /** The access key's chain: the chain that the permissions name, else the `chainId` option. */
  chainId: number
  /**
   * When the access key expires, in Unix seconds, or 0 for an access key that never expires. Absent
   * for the expiry that Tempo ID fills.
   */
  expiry?: number | undefined
  /**
   * The fee allowance: how much of each stablecoin the access key may spend on network fees, in base
   * units, apart from `limits`. Tempo charges the fees of an access key to its limit of the fee
   * token, so limits that name no stablecoin, such as limits of MACH alone, pay no fee. The
   * allowance is 0.1 of each of pathUSD, USDC.e, USDT0, OUSD, alphaUSD, betaUSD, and thetaUSD that
   * the chain lists. No scope calls those tokens, so the allowance pays fees only. Absent for
   * limits that name one of those stablecoins, for an access key without limits or without scopes,
   * for an access key that another party holds, whose holder verifies the limits that it named,
   * and for scopes that call a contract that spends the token that its call names: the TIP-1034
   * channel reserve, the stablecoin DEX, or the fee manager. The scopes that `resolve` fills from
   * the limits call the channel reserve, so only named scopes receive an allowance.
   */
  fees?: KeyAuthorization.KeyAuthorization['limits']
  /**
   * How much of each token the access key may spend, in base units, with each `period` in seconds,
   * as the permissions name it, without `fees`.
   */
  limits?: KeyAuthorization.KeyAuthorization['limits']
  /**
   * The calls the access key may make. Absent for an access key that makes any call: for
   * `scopes: 'any'`, or for permissions without `scopes` and `limits`.
   */
  scopes?: KeyAuthorization.KeyAuthorization['scopes']
}

/** The symbol of a token that the library lists for Tempo chains, as listed or in lowercase. */
export type TokenSymbol =
  | (typeof tokens.tempo)[number]['symbol']
  | Lowercase<(typeof tokens.tempo)[number]['symbol']>
  | 'mach'
  | 'MACH'

/** A token: its symbol on the chain, as listed or in lowercase, or its address. */
export type Token = Address.Address | TokenSymbol

/**
 * Whether an action with `accessKey` authorizes an access key: `true` for an access key, `false`
 * for none, and `boolean` for a value that may be either. It decides whether the result holds
 * `accessKey` and `signer`.
 */
export type HasAccessKey<accessKey> = accessKey extends undefined ? false : true

/**
 * The literal chain that `accessKey` names, or `fallback`, such as the instance's chain, for an
 * access key that names none. It types the result's `key.chainId`.
 */
export type ChainId<
  accessKey,
  fallback extends number = number,
> = accessKey extends { chainId?: infer id }
  ? // A `Permissions<chainId>` names its chain in an optional property.
    [Exclude<id, undefined>] extends [never]
    ? fallback
    : Exclude<id, undefined> extends number
      ? Exclude<id, undefined>
      : fallback
  : fallback

/** Seconds in each unit of a {@link Duration}. */
const units = {
  d: 86_400,
  h: 3_600,
  m: 60,
  s: 1,
  w: 604_800,
} as const

/**
 * MACH, the machine token that MPP sessions pay in, at the same address on mainnet and Moderato.
 * Viem's token list does not name it.
 */
const mach = defineToken({
  addresses: {
    [Chains.ids.mainnet]: '0x20c000000000000000000000f37de3740adec032',
    [Chains.ids.testnet]: '0x20c000000000000000000000f37de3740adec032',
  },
  currency: 'USD',
  decimals: 6,
  name: 'MACH',
  symbol: 'MACH',
})

/**
 * Instantiates a {@link Permissions}, keeping `chainId` as a literal type.
 *
 * @example
 * ```ts
 * const permissions = Permissions.from({
 *   expiry: '1d',
 *   limits: [{ limit: '10', token: 'ousd' }],
 * })
 * ```
 */
export function from<const chainId extends number = number>(
  value: Permissions<chainId>,
): Permissions<chainId> {
  return value
}

/**
 * Returns what an access key's signed authorization permits: its chain, its limits in base units,
 * and its scopes, without its expiry. A limit without a period holds no `period`. An authorization
 * without scopes makes any call, so its `scopes` are `'any'`. A renewal of an expired access key
 * requests them again, so the new access key does what the old one did.
 *
 * @example
 * ```ts
 * import { Permissions } from 'accounts'
 *
 * const { session } = accounts.useSession()
 * const { limits } = Permissions.fromAccessKey(session.accessKey)
 * ```
 */
export function fromAccessKey(
  accessKey: Pick<AccessKey, 'keyAuthorization'>,
): Permissions {
  const authorization = KeyAuthorization.fromRpc(accessKey.keyAuthorization)
  return {
    chainId: Number(authorization.chainId),
    limits: authorization.limits?.map((entry) => ({
      limit: entry.limit,
      period: entry.period || undefined,
      token: entry.token,
    })),
    scopes: authorization.scopes ?? 'any',
  }
}

/**
 * Returns `permissions` as the key authorization request sends them, on `chainId` unless they name
 * a chain. Each sign-in and `authorize` calls it, so an app calls it only to read what a request
 * will send, such as to show the access key before a sign-in. A {@link Duration} expiry counts from
 * the call, `expiry: false` becomes 0, and an absent expiry stays absent, for Tempo ID to fill. A
 * token symbol becomes the token's address on the chain, and a decimal limit becomes base units
 * with the token's decimals. Without `scopes`, the scopes come from `limits`, as
 * {@link Permissions} describes, and `scopes: 'any'` resolves to no scopes. Limits that name no
 * stablecoin, with named scopes that spend no other token, receive the fee allowance that
 * {@link Resolved} describes, as `fees`, apart from `limits`. An access key that another party
 * holds, which names its `address`, receives none.
 * @throws {DecimalsUnknownError} For a decimal limit on an unlisted token.
 * @throws {InvalidDurationError} For a malformed duration.
 * @throws {InvalidLimitError} For a decimal limit that holds no plain decimal number.
 * @throws {LimitPrecisionError} For a decimal limit finer than its token.
 * @throws {TokenUnknownError} For a symbol that the chain does not list.
 *
 * @example
 * ```ts
 * import { Permissions } from 'accounts'
 * import { tempo } from 'viem/tempo/chains'
 *
 * const resolved = Permissions.resolve(
 *   { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
 *   { chainId: tempo.id },
 * )
 * ```
 */
export function resolve(
  permissions: Permissions | WithAddress,
  options: resolve.Options,
): Resolved {
  const chainId = permissions.chainId ?? options.chainId

  const limits = permissions.limits?.map((entry) => {
    const token = listing({ chainId, token: entry.token })
    const limit = (() => {
      if (typeof entry.limit === 'bigint') return entry.limit
      if (!token.decimals)
        throw new DecimalsUnknownError({ token: entry.token })
      // `String(amount)` writes a small or a large number in exponent notation, which the type
      // admits. A negative limit passes, so the sign-in refuses it with its own reason.
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(entry.limit))
        throw new InvalidLimitError({ limit: entry.limit })
      // A rounded limit could exceed the maximum that the app names, so excess digits throw.
      const fraction = entry.limit.split('.')[1] ?? ''
      if (fraction.replace(/0+$/, '').length > token.decimals)
        throw new LimitPrecisionError({
          decimals: token.decimals,
          limit: entry.limit,
        })
      return Value.from(entry.limit, token.decimals)
    })()
    return {
      address: token.address,
      limit,
      period: entry.period,
      spenders: entry.spenders,
    }
  })

  const scopes = (() => {
    if (permissions.scopes === 'any') return undefined
    if (permissions.scopes || !limits) return permissions.scopes
    const reserve = Scopes.contract(
      Addresses.tip20ChannelReserve,
      Selectors.tip20ChannelReserve,
    )
    return [
      ...limits.flatMap((entry) => {
        const tip20 = Scopes.tip20(entry.address)
        return [
          tip20.transfer(),
          tip20.transferWithMemo(),
          ...(entry.spenders?.length
            ? [tip20.approve({ recipients: entry.spenders })]
            : []),
        ]
      }),
      reserve.open(),
      reserve.topUp(),
    ]
  })()

  // The holder of an access key verifies the limits that it named, so its request holds no more.
  const fees =
    'address' in permissions
      ? undefined
      : FeeAllowance.from({
          limits,
          scopes,
          tokens: listings({ chainId }),
        })

  const expiry = (() => {
    const value = permissions.expiry
    if (value === undefined) return undefined
    // TIP-1011 signs an expiry of 0 as an access key that never expires.
    if (value === false) return 0
    if (typeof value === 'number') return value
    return Math.floor(Date.now() / 1000) + seconds({ value })
  })()

  return {
    chainId,
    ...(expiry === undefined ? {} : { expiry }),
    ...(fees ? { fees } : {}),
    ...(limits
      ? {
          limits: limits.map((entry) => {
            const period =
              typeof entry.period === 'string'
                ? seconds({ value: entry.period })
                : entry.period
            // A period of 0 is a one-time total, which the request sends without a period.
            return {
              limit: entry.limit,
              ...(period ? { period } : {}),
              token: entry.address,
            }
          }),
        }
      : {}),
    ...(scopes ? { scopes } : {}),
  }
}

export declare namespace resolve {
  type Options = {
    /** The chain of permissions that name none, such as the instance's `chainId`. */
    chainId: number
  }
}

/**
 * Returns the address and decimals of `token` on the chain, as Tempo ID lists it. An address that
 * the chain does not list returns no decimals.
 */
function listing(options: listing.Options): {
  address: Address.Address
  decimals?: number | undefined
} {
  const { chainId, token } = options
  const listed = listings({ chainId })

  if (Address.validate(token, { strict: false })) {
    const match = listed.find((entry) => Address.isEqual(entry.address, token))
    return match ?? { address: token }
  }

  const match = listed.find((entry) => entry.symbol === token.toLowerCase())
  if (!match) throw new TokenUnknownError({ chainId, token })
  return match
}

declare namespace listing {
  type Options = {
    /** The chain's ID. */
    chainId: number
    /** The token's symbol or address. */
    token: Token
  }
}

/**
 * Returns the tokens of the chain, as Tempo ID lists them: each one's address, decimals, and symbol
 * in lowercase.
 */
function listings(options: listings.Options) {
  const { chainId } = options
  return [...tokens.tempo, mach].flatMap((entry) => {
    const addresses = entry.addresses as Record<number, string>
    // Devnets and a local Tempo node predeploy the testnet's tokens at the same addresses, which
    // Viem's list does not name. OUSD has its mainnet address on every Tempo chain.
    const address =
      addresses[chainId] ??
      (chainId === Chains.devIds.devnet || chainId === Chains.devIds.localnet
        ? addresses[Chains.ids.testnet]
        : undefined) ??
      (entry.symbol === 'OUSD' ? addresses[Chains.ids.mainnet] : undefined)
    if (!address) return []
    return [
      {
        address: Address.checksum(address as Address.Address),
        decimals: entry.decimals,
        symbol: entry.symbol.toLowerCase(),
      },
    ]
  })
}

declare namespace listings {
  type Options = {
    /** The chain's ID. */
    chainId: number
  }
}

/** Returns the seconds in a {@link Duration}. Throws `Permissions.InvalidDurationError`. */
function seconds(options: seconds.Options) {
  const match = /^(\d+)(d|h|m|s|w)$/.exec(options.value)
  if (!match) throw new InvalidDurationError({ value: options.value })
  return Number(match[1]) * units[match[2] as keyof typeof units]
}

declare namespace seconds {
  type Options = {
    /** The duration, such as `'1d'`. */
    value: string
  }
}
