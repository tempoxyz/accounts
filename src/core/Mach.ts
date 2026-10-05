import { Hex } from 'ox'

import type * as Provider from './Provider.js'
import type * as Rpc from './zod/rpc.js'

/** MACH on Tempo mainnet. Legacy offchain MPP Credits are a separate balance. */
export const token = {
  address: '0x20c000000000000000000000f37de3740adec032',
  chainId: 4217,
  decimals: 6,
  symbol: 'MACH',
} as const

/**
 * Opens MACH checkout through the provider's wallet transport. Works with
 * browser, mobile, and CLI device-code adapters. The user confirms the payment
 * in the wallet; opening or closing checkout does not prove funds arrived.
 */
export async function fund(
  provider: Pick<Provider.Provider, 'request'>,
  options: fund.Options = {},
): Promise<fund.ReturnType> {
  validate(options)
  return provider.request({
    method: 'wallet_deposit',
    params: [
      {
        ...options,
        chainId: Hex.fromNumber(token.chainId),
        intent: 'mach',
        token: token.address,
      },
    ],
  })
}

export declare namespace fund {
  /** Hints shown for the user to review in MACH checkout. */
  type Options = {
    /** Recipient. Defaults to the account connected to the provider. */
    address?: Hex.Hex | undefined
    /** USD amount to pre-fill, as a positive decimal with at most two places. */
    amount?: string | undefined
    /** MACH is currently supported on Tempo mainnet only. @default 4217 */
    chainId?: number | undefined
    /** App name displayed by the wallet. */
    displayName?: string | undefined
  }
  /** Wallet response. Checkout initiation is not payment confirmation. */
  type ReturnType = Rpc.wallet_deposit.Encoded['returns']
}

/**
 * Creates a wallet-bound MACH checkout link for terminals, agents, and devices
 * that cannot mount the wallet UI. This function never opens a browser or makes
 * a payment. The wallet must authenticate and verify the requested recipient.
 */
export function getFundingUrl(options: getFundingUrl.Options): string {
  validate(options)
  if (!options.address) throw new Error('A recipient address is required for a MACH funding link.')
  const url = new URL('https://wallet.tempo.xyz/agent')
  url.searchParams.set('action', 'fund')
  url.searchParams.set('intent', 'mach')
  url.searchParams.set('address', options.address)
  url.searchParams.set('chainId', String(token.chainId))
  if (options.amount !== undefined) url.searchParams.set('amount', options.amount)
  return url.toString()
}

export declare namespace getFundingUrl {
  /** The wallet and optional amount to pre-fill in MACH checkout. */
  type Options = Omit<fund.Options, 'address' | 'displayName'> & {
    /** Recipient account; never inferred from the browser's current session. */
    address: Hex.Hex
  }
}

function validate(options: fund.Options) {
  if (options.chainId !== undefined && options.chainId !== token.chainId)
    throw new Error('MACH funding is only available on Tempo mainnet (4217).')
  if (
    options.address !== undefined &&
    (!/^0x[0-9a-fA-F]{40}$/.test(options.address) || /^0x0{40}$/i.test(options.address))
  )
    throw new Error('MACH funding requires a nonzero recipient address.')
  if (options.amount !== undefined) {
    if (!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(options.amount))
      throw new Error('MACH funding amount must be a positive USD decimal with at most two places.')
    const [whole = '0', fraction = ''] = options.amount.split('.')
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
    if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('MACH funding amount is outside the supported range.')
  }
}
