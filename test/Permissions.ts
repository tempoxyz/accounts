/**
 * The permissions that the end-to-end suite runs each playground with: none, each field alone, and
 * all of them. Each playground fills the rest with its own permissions, its expiry too.
 * @module
 */
import { Permissions } from 'accounts'
import { Json } from 'ox'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import { Chain } from './TempoId.js'

/** OUSD, which has its mainnet address on every Tempo chain. */
const ousd = Tokens.ousd(tempo.id).address

/** Every permission: the suite's chain, a day, and up to 10 OUSD in transfers. */
const every = Permissions.from({
  chainId: Chain.chain.id,
  expiry: Expiry.days(1),
  limits: [{ limit: 10_000_000n, token: ousd }],
  scopes: [Scopes.tip20(ousd).transfer()],
})

/** Each case's name, its permissions, and the spending limit that the approval page shows. */
export const matrix = [
  { limit: 'Spend $1,000', name: 'no permissions', permissions: undefined },
  {
    limit: 'Spend $1,000',
    name: 'a chain ID',
    permissions: Permissions.from({ chainId: every.chainId }),
  },
  {
    limit: 'Spend $1,000',
    name: 'an expiry',
    permissions: Permissions.from({ expiry: every.expiry }),
  },
  {
    limit: 'Spend $10',
    name: 'limits',
    permissions: Permissions.from({ limits: every.limits }),
  },
  {
    limit: 'Spend $1,000',
    name: 'scopes',
    permissions: Permissions.from({ scopes: every.scopes }),
  },
  { limit: 'Spend $10', name: 'every permission', permissions: every },
] as const

/**
 * Returns the environment that passes `permissions` to a playground. Without permissions, it unsets
 * `PERMISSIONS`.
 */
export function env(
  permissions: Permissions.Permissions | undefined,
): Record<string, string | undefined> {
  if (!permissions) return { PERMISSIONS: undefined }
  return { PERMISSIONS: Json.stringify(permissions) }
}

/**
 * Returns a key request's expiry, limits, and scopes on the wire: just under a year, $1,000 of OUSD,
 * and its transfers. The approval page shows them as `Spend $1,000`.
 */
export function request() {
  return {
    expiry: Expiry.days(364),
    limits: [{ limit: '0x3b9aca00', token: ousd }],
    scopes: [
      { address: ousd, selector: '0xa9059cbb' },
      { address: ousd, selector: '0x95777d59' },
    ],
  }
}
