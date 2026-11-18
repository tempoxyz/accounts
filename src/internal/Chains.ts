/**
 * The built-in Tempo chains, by the name that the `chain` parameter of Tempo ID's pages takes. Each
 * chain definition of `viem/tempo/chains` imports Viem's Tempo actions and their ABIs, so the
 * package names chain IDs as constants.
 * @module
 */

/**
 * The IDs of Tempo devnet and a local Tempo node, as `viem/tempo/chains` names them. Both predeploy
 * the testnet's tokens. The `chain` parameter names them by their IDs.
 */
export const devIds = { devnet: 31318, localnet: 1337 } as const

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
