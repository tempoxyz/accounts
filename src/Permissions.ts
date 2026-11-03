/**
 * What an app's access key may do, and its resolution into the key authorization that a sign-in
 * requests.
 * @module
 */
import { Address, Value } from 'ox'
import type { KeyAuthorization } from 'ox/tempo'
import { type Account, Addresses, Scopes, Selectors } from 'viem/tempo'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import { defineToken, tokens } from 'viem/tokens'

/** A limit with a decimal `limit` names a token whose decimals the library does not list. */
export class DecimalsUnknownError extends Error {
  override readonly name = 'Permissions.DecimalsUnknownError'

  constructor(options: { token: string }) {
    super(
      `Unknown decimals for token ${options.token}: a decimal \`limit\` needs a listed token. Pass the limit in base units as a bigint, or name a listed token.`,
    )
  }
}

/** A duration string has no number or no known unit. */
export class InvalidDurationError extends Error {
  override readonly name = 'Permissions.InvalidDurationError'

  constructor(options: { value: string }) {
    super(
      `Invalid duration "${options.value}": a duration is a whole number and one of the units s, m, h, d, or w, such as "30m" or "1d".`,
    )
  }
}

/** A decimal `limit` has more fractional digits than its token's decimals. */
export class LimitPrecisionError extends Error {
  override readonly name = 'Permissions.LimitPrecisionError'

  constructor(options: { decimals: number; limit: string }) {
    super(
      `Invalid limit "${options.limit}": the token has ${options.decimals} decimals. Round the limit down to ${options.decimals} fractional digits.`,
    )
  }
}

/** A limit names a token symbol that the chain does not list. */
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
   * or a bigint in base units, such as `10_000_000n`. A decimal string needs a listed token.
   */
  limit: bigint | `${number}`
  /**
   * The period after which the limit resets: a {@link Duration}, such as `'1d'`, or whole seconds.
   * Absent for a one-time total.
   */
  period?: Duration | number | undefined
  /**
   * The contracts that the access key may approve to spend the token. Absent, the scopes that
   * {@link resolve} fills from the limits include no `approve`.
   */
  spenders?: readonly Address.Address[] | undefined
  /** The token: its symbol on the chain, such as `'ousd'` or `'OUSD'`, or its address. */
  token: Token
}

/**
 * What an app's access key may do. Without `expiry`, Tempo ID fills the expiry from the app's
 * refresh token lifetime, at most one year. Without `limits`, the access key spends any amount.
 * Without `scopes`, {@link resolve} fills them from `limits`. Tempo ID refuses an access key that
 * never expires (`expiry: false`), spends any amount (no `limits`), or makes any call
 * (`scopes: 'any'`), unless a headless sign-in of an app with the `tempo-id:sign` scope requests it. `chainId` types the
 * authorization's `key.chainId`.
 */
export type Permissions<chainId extends number = number> = {
  /** The access key's chain, such as `tempoTestnet.id`. Defaults to the instance's `chainId`. */
  chainId?: chainId | undefined
  /**
   * When the access key expires: a {@link Duration} from the request, such as `'1d'`, Unix
   * seconds, such as Viem's `Expiry.days(1)`, or `false` for an access key that never expires.
   * Absent, Tempo ID fills it with the app's refresh token lifetime from the sign-in, at most one
   * year.
   */
  expiry?: Duration | number | false | undefined
  /**
   * How much of each token the access key may spend, in total or per `period`. Absent for an access
   * key that spends any amount.
   */
  limits?: readonly Limit[] | undefined
  /**
   * The calls the access key may make, or `'any'` for an access key that makes any call. Absent
   * with `limits`, the scopes are `transfer` and `transferWithMemo` on each limited token, `approve`
   * to each limit's `spenders`, and `open` and `topUp` on the TIP-1034 channel reserve, which MPP
   * sessions pay through. Absent without `limits`, the access key makes any call. Named scopes
   * replace the filled ones.
   */
  scopes?: KeyAuthorization.KeyAuthorization['scopes'] | 'any'
}

/**
 * The access key of a low-level action: its {@link Permissions}, and the app's own access key as a
 * Viem account, in place of a new one.
 */
export type WithAccount<chainId extends number = number> =
  Permissions<chainId> & {
    /**
     * The app's own access key, as a Viem account. Its `access` names the Tempo Account, which
     * defaults to the app's selected account, or the user's oldest. Defaults to a new access key,
     * whose material the authorization keeps.
     */
    account?: Account.Account | undefined
  }

/**
 * The permissions that {@link resolve} returns, as the key authorization request sends them: Unix
 * seconds, base units, addresses, and scopes.
 */
export type Resolved = {
  /** The access key's chain. */
  chainId: number
  /**
   * When the access key expires, in Unix seconds, or 0 for an access key that never expires. Absent
   * for the expiry that Tempo ID fills.
   */
  expiry?: number | undefined
  /** How much of each token the access key may spend, in base units. */
  limits?: KeyAuthorization.KeyAuthorization['limits']
  /** The calls the access key may make. Absent for an access key that makes any call. */
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
 * for none, and `boolean` for a value that may be either.
 */
export type Keyed<accessKey> = accessKey extends undefined ? false : true

/** The chain that `accessKey` names, or `fallback` for an access key that names none. */
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
    [tempo.id]: '0x20c000000000000000000000f37de3740adec032',
    [tempoTestnet.id]: '0x20c000000000000000000000f37de3740adec032',
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
 * Returns `permissions` as the key authorization request sends them, on `chainId` unless they name
 * a chain. A {@link Duration} expiry counts from the call, `expiry: false` becomes 0, and an absent
 * expiry stays absent, for Tempo ID to fill. A token symbol becomes the token's address, and a
 * decimal limit becomes base units. Without `scopes`, the scopes come from `limits`, as
 * {@link Permissions} describes, and `scopes: 'any'` resolves to no scopes. Throws
 * `Permissions.TokenUnknownError` for a symbol that the chain does not list,
 * `Permissions.DecimalsUnknownError` for a decimal limit on an unlisted token,
 * `Permissions.LimitPrecisionError` for a decimal limit finer than its token, and
 * `Permissions.InvalidDurationError` for a malformed duration.
 *
 * @example
 * ```ts
 * const resolved = Permissions.resolve(
 *   { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
 *   { chainId: tempo.id },
 * )
 * ```
 */
export function resolve(
  permissions: Permissions,
  options: resolve.Options,
): Resolved {
  const chainId = permissions.chainId ?? options.chainId

  const limits = permissions.limits?.map((entry) => {
    const token = listing({ chainId, token: entry.token })
    const limit = (() => {
      if (typeof entry.limit === 'bigint') return entry.limit
      if (!token.decimals)
        throw new DecimalsUnknownError({ token: entry.token })
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
  const listed = [...tokens.tempo, mach].flatMap((entry) => {
    const addresses = entry.addresses as Record<number, string>
    // Devnets and a local Tempo node predeploy the testnet's tokens at the same addresses, which
    // Viem's list does not name. OUSD has its mainnet address on every Tempo chain.
    const address =
      addresses[chainId] ??
      (chainId === tempoDevnet.id || chainId === tempoLocalnet.id
        ? addresses[tempoTestnet.id]
        : undefined) ??
      (entry.symbol === 'OUSD' ? addresses[tempo.id] : undefined)
    if (!address) return []
    return [
      {
        address: Address.checksum(address as Address.Address),
        decimals: entry.decimals,
        symbol: entry.symbol.toLowerCase(),
      },
    ]
  })

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
