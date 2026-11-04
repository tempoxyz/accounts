/**
 * The built-in Tempo chains, by the name that the `chain` parameter of Tempo ID's pages takes.
 * @module
 */

/** The IDs of Tempo mainnet and Tempo testnet, as `viem/tempo/chains` names them. */
export const ids = { mainnet: 4217, testnet: 42431 } as const

/**
 * Returns the `chain` parameter of Tempo ID's pages for `chainId`: `mainnet` or `testnet` for a
 * built-in chain, else the ID as digits, which the pages read by the name that the deployment
 * lists for it.
 */
export function parameter(options: parameter.Options) {
  const name = (Object.keys(ids) as (keyof typeof ids)[]).find(
    (key) => ids[key] === options.chainId,
  )
  return name ?? String(options.chainId)
}

export declare namespace parameter {
  type Options = {
    /** The chain's ID. */
    chainId: number
  }
}
