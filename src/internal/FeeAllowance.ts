/**
 * The fee allowance of an access key: the limits that pay only its network fees. Tempo charges the
 * fees of an access key to its limit of the fee token, so limits that name no stablecoin pay no
 * fee. The module holds the rule that adds the allowance to a request, and the rule that finds it
 * in a signed key authorization.
 * @module
 */
import { Address, Value } from 'ox'
import type { KeyAuthorization } from 'ox/tempo'
import { Addresses } from 'viem/tempo'

/**
 * The amount of each token of {@link symbols} that a fee allowance holds, in the token's units. It
 * covers the network fees of an access key.
 */
export const amount = '0.1'

/**
 * The contracts that spend the caller's balance of the token that the call names: fee AMM
 * liquidity, stablecoin DEX orders, and payment channel deposits. A scope on one of them could
 * spend a fee allowance on more than fees.
 */
const spenders = [
  Addresses.feeManager,
  Addresses.stablecoinDex,
  Addresses.tip20ChannelReserve,
] as const

/**
 * The symbols of the stablecoins that pay network fees, in lowercase. A fee allowance holds each
 * one that the chain lists, so the access key pays in the one that the account holds.
 */
const symbols: readonly string[] = [
  'alphausd',
  'betausd',
  'ousd',
  'pathusd',
  'thetausd',
  'usdc.e',
  'usdt0',
]

/**
 * Returns the fee allowance of an access key with `options.limits` and `options.scopes`: 0.1 of
 * each stablecoin of `options.tokens` that pays fees and that no scope calls, in base units.
 * Returns `undefined` for an access key without limits, which pays its fees, for one without
 * scopes, which could spend an allowance with any call, for limits that name one of those
 * stablecoins, which holds the fees, and for scopes that call a contract that spends the token
 * that its call names.
 *
 * @example
 * ```ts
 * const fees = FeeAllowance.from({
 *   limits: [{ address: mach }],
 *   scopes: [{ address: mach }],
 *   tokens: [{ address: pathUsd, decimals: 6, symbol: 'pathusd' }],
 * })
 * // [{ limit: 100000n, token: pathUsd }]
 * ```
 */
export function from(options: from.Options): from.ReturnType {
  const { limits, scopes, tokens } = options
  if (!limits?.length || !scopes?.length) return undefined
  if (spends(scopes.map((scope) => scope.address))) return undefined

  const stablecoins = tokens.filter((token) => symbols.includes(token.symbol))
  // Limits that name a stablecoin already hold the fees of the access key.
  if (
    stablecoins.some((token) =>
      limits.some((entry) => Address.isEqual(entry.address, token.address)),
    )
  )
    return undefined

  // A stablecoin that a scope calls is one that the access key could send.
  const allowance = stablecoins
    .filter(
      (token) =>
        !scopes.some((scope) => Address.isEqual(scope.address, token.address)),
    )
    .map((token) => ({
      limit: Value.from(amount, token.decimals),
      token: token.address,
    }))
  return allowance.length ? allowance : undefined
}

export declare namespace from {
  type Options = {
    /** The token of each limit that the access key names. Absent for an access key without limits. */
    limits: readonly { address: Address.Address }[] | undefined
    /** The contract of each call that the access key may make. Absent for an access key that makes any call. */
    scopes: readonly { address: Address.Address }[] | undefined
    /** The tokens that the chain lists, with each symbol in lowercase. */
    tokens: readonly {
      address: Address.Address
      decimals: number
      symbol: string
    }[]
  }

  type ReturnType = KeyAuthorization.KeyAuthorization['limits']
}

/**
 * Returns the limits of a signed key authorization that pay only network fees: each limit whose
 * token no scope calls, of an access key whose scopes call no contract that spends the token that
 * its call names. The access key sends none of such a token, whatever its limit holds. The fee
 * allowance that {@link from} adds is among them. Returns none for an access key without limits
 * or without scopes.
 *
 * @example
 * ```ts
 * const fees = FeeAllowance.of(session.accessKey.keyAuthorization)
 * // [{ limit: '0x186a0', token: '0x20c0…' }]
 * ```
 */
export function of(
  authorization: Pick<KeyAuthorization.Rpc, 'allowedCalls' | 'limits'>,
): NonNullable<KeyAuthorization.Rpc['limits']> {
  const { allowedCalls, limits } = authorization
  if (!limits?.length || !allowedCalls?.length) return []

  const targets = allowedCalls.map((scope) => scope.target)
  if (spends(targets)) return []

  return limits.filter(
    (entry) => !targets.some((target) => Address.isEqual(target, entry.token)),
  )
}

/** Returns whether one of `targets` is a contract of {@link spenders}. */
function spends(targets: readonly Address.Address[]) {
  return targets.some((target) =>
    spenders.some((address) => Address.isEqual(target, address)),
  )
}
