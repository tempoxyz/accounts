import { type Address, type Client, isAddressEqual, zeroAddress } from 'viem'
import { getBlock, readContract } from 'viem/actions'
import { Abis, Actions, Addresses, Hardfork } from 'viem/tempo'

import type * as Kv from '../../Kv.js'
import { cached } from '../kv.js'

/** Number of recent block producers the node's pool admission considers. */
const producerWindow = 10

/**
 * Checks whether the fee AMM can settle the fee for at least one recent block
 * producer's preferred token. Mirrors the node's pool admission check, so a
 * token is only rejected here when the node would reject it too.
 */
export async function has(client: Client, options: has.Options): Promise<boolean> {
  const check = await prepare(client, options)
  return check(options.amount)
}

/** Reads fee reserves ahead of filling and returns a reusable maximum-fee check. */
export async function prepare(client: Client, options: prepare.Options) {
  const { kv, token } = options
  const validatorTokens = await getValidatorTokens(client, { kv })
  if (validatorTokens.some((validatorToken) => isAddressEqual(validatorToken, token)))
    return async (_amount: bigint) => true

  const hardfork = (client.chain as { hardfork?: string } | undefined)?.hardfork
  const twoHop = !hardfork || !Hardfork.lt(hardfork, 't5')

  const [direct, quote] = await Promise.all([
    Promise.all(
      validatorTokens.map((validatorToken) =>
        Actions.amm.getPool(client, { userToken: token, validatorToken }),
      ),
    ),
    twoHop
      ? readContract(client, { address: token, abi: Abis.tip20, functionName: 'quoteToken' })
      : undefined,
  ])
  const targets = quote
    ? validatorTokens.filter((validatorToken) => !isAddressEqual(validatorToken, quote))
    : []
  const route =
    quote && quote !== zeroAddress && targets.length > 0
      ? Promise.all([
          Actions.amm.getPool(client, { userToken: token, validatorToken: quote }),
          ...targets.map((validatorToken) =>
            Actions.amm.getPool(client, { userToken: quote, validatorToken }),
          ),
        ])
      : undefined
  void route?.catch(() => {})
  return async (amount: bigint) => {
    const output = (amount * 9970n) / 10000n
    if (direct.some((pool) => pool.reserveValidatorToken >= output)) return true
    if (!route) return false
    const [first, ...second] = await route
    if (first!.reserveValidatorToken < output) return false
    return second.some((pool) => pool.reserveValidatorToken >= (output * 9970n) / 10000n)
  }
}

/** Parameters for prefetching a token's fee reserves. */
export declare namespace prepare {
  /** Fee token and producer-preference cache. */
  type Options = Pick<has.Options, 'token' | 'kv'>
}

/** Parameters for the fee-liquidity check. */
export declare namespace has {
  /** Fee token and maximum fee, in TIP-20 base units. */
  type Options = {
    /** User's fee token. */
    token: Address
    /** Maximum transaction fee, rounded up to microdollars. */
    amount: bigint
    /** Caches the recent producers' fee tokens across fills. */
    kv?: Kv.Kv | undefined
  }
}

/** Resolves the unique fee tokens preferred by the producers of the latest blocks. */
async function getValidatorTokens(
  client: Client,
  options: { kv?: Kv.Kv | undefined },
): Promise<readonly Address[]> {
  async function load() {
    const latest = await getBlock(client)
    const number = latest.number ?? 0n
    const previous = await Promise.all(
      Array.from({ length: producerWindow - 1 }, (_, index) => number - BigInt(index + 1))
        .filter((blockNumber) => blockNumber >= 0n)
        .map((blockNumber) => getBlock(client, { blockNumber })),
    )
    const validators = unique([latest, ...previous].map((block) => block.miner))
    const tokens = await Promise.all(
      validators.map(async (validator) => {
        const preference = await Actions.fee.getValidatorToken(client, { validator })
        return preference?.address ?? Addresses.pathUsd
      }),
    )
    return unique(tokens)
  }

  // Producer preferences rarely change, and a stale entry only delays picking
  // up a new producer's token until the cache expires.
  const { kv } = options
  if (!kv) return load()
  return cached(kv, `fee.validatorTokens:${client.chain?.id ?? 0}`, load, { ttl: 60 })
}

function unique(addresses: readonly Address[]): Address[] {
  const seen = new Map<string, Address>()
  for (const address of addresses) seen.set(address.toLowerCase(), address)
  return [...seen.values()]
}
