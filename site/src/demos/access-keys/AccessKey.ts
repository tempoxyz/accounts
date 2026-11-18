/** Describes the access key of a session, for the demos of "Access keys". @module */
import type { Session } from 'accounts'
import { KeyAuthorization } from 'ox/tempo'
import { formatUnits } from 'viem'
import { Addresses } from 'viem/tempo'

/** Decimals of a TIP-20 token. */
const decimals = 6

/** The format of an expiry, in the reader's locale and time zone. */
const format = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * Returns what the access key may send and when it expires, as one sentence, from its signed key
 * authorization. A limit of OUSD shows the symbol, and each other limit shows the token's address.
 *
 * @example
 * ```ts
 * import * as AccessKey from './access-keys/AccessKey.ts'
 *
 * AccessKey.describe(session.accessKey)
 * // 'Access key 0x996d…7F39 sends up to 25 OUSD until Nov 12, 2026, 6:00 PM.'
 * ```
 */
export function describe(accessKey: describe.AccessKey): string {
  const authorization = KeyAuthorization.fromRpc(accessKey.keyAuthorization)

  const limits = (authorization.limits ?? [])
    .map((entry) => {
      const token =
        entry.token.toLowerCase() === Addresses.ousd.toLowerCase()
          ? 'OUSD'
          : short(entry.token)
      return `${formatUnits(entry.limit, decimals)} ${token}`
    })
    .join(' and ')
  const sends = limits ? `sends up to ${limits}` : 'has no limit'
  const expires = authorization.expiry
    ? `until ${format.format(authorization.expiry * 1000)}`
    : 'with no expiry'

  return `Access key ${short(authorization.address)} ${sends} ${expires}.`
}

export declare namespace describe {
  /** The access key of a session. */
  type AccessKey = Pick<
    NonNullable<Session.Session['accessKey']>,
    'keyAuthorization'
  >
}

/**
 * Returns the first and the last four digits of `address`.
 *
 * @example
 * ```ts
 * import * as AccessKey from './access-keys/AccessKey.ts'
 *
 * AccessKey.short('0x996d2D890899637FFE67fA31597EaeC6180E7F39')
 * // '0x996d…7F39'
 * ```
 */
export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
