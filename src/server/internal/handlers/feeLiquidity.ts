import { type Address, type Client, zeroAddress } from 'viem'
import { getBlock, readContract } from 'viem/actions'
import { Abis, Actions, Addresses, Hardfork } from 'viem/tempo'

/** Checks fee settlement against the latest block producer's preferred token. */
export async function has(client: Client, options: has.Options): Promise<boolean> {
  const { token, amount } = options
  const block = await getBlock(client)
  const preference = await Actions.fee.getValidatorToken(client, { validator: block.miner })
  const validator = preference?.address ?? Addresses.pathUsd
  if (token.toLowerCase() === validator.toLowerCase()) return true

  // FeeAMM takes 30 bps on each hop, rounding down in token base units.
  const output = (amount * 9970n) / 10000n
  const direct = await Actions.amm.getPool(client, { userToken: token, validatorToken: validator })
  if (direct.reserveValidatorToken >= output) return true

  const hardfork = (client.chain as { hardfork?: string } | undefined)?.hardfork
  if (hardfork && Hardfork.lt(hardfork, 't5')) return false

  const quote = await readContract(client, {
    address: token,
    abi: Abis.tip20,
    functionName: 'quoteToken',
  })
  if (quote === zeroAddress || quote.toLowerCase() === validator.toLowerCase()) return false
  const [first, second] = await Promise.all([
    Actions.amm.getPool(client, { userToken: token, validatorToken: quote }),
    Actions.amm.getPool(client, { userToken: quote, validatorToken: validator }),
  ])
  return (
    first.reserveValidatorToken >= output &&
    second.reserveValidatorToken >= (output * 9970n) / 10000n
  )
}

/** Parameters for the fee-liquidity check. */
export declare namespace has {
  /** Fee token and maximum fee, in TIP-20 base units. */
  type Options = {
    /** User's fee token. */
    token: Address
    /** Maximum transaction fee, rounded up to microdollars. */
    amount: bigint
  }
}
