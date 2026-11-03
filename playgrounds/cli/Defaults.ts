/**
 * The CLI's own access key for what a request leaves out: 364 days, and $1,000 of each token that the
 * scopes call or of OUSD. Without `scopes`, `Permissions.resolve` fills `transfer` and
 * `transferWithMemo` on each limited token, and `open` and `topUp` on the channel reserve, which MPP
 * charges and sessions call. Tempo ID fills only an absent expiry, with the app's refresh token
 * lifetime, so the CLI keeps 364 days of its own.
 * @module
 */
import { Permissions } from 'accounts'

/** Returns `permissions` with every field that they leave out filled with the CLI's own. */
export function fill(permissions: Permissions.Permissions) {
  // A TIP-20 call moves its token, so the access key limits each token that the scopes call.
  const named = Array.isArray(permissions.scopes) ? permissions.scopes : []
  const called = [
    ...new Set(
      named
        .map((scope) => scope.address.toLowerCase() as `0x${string}`)
        .filter((address) => address.startsWith('0x20c000000000000000000000')),
    ),
  ]
  return Permissions.from({
    ...permissions,
    // A day short of a year, within Tempo ID's one-year ceiling.
    expiry: permissions.expiry ?? '364d',
    // A called token's address names no decimals, so its limit is in base units of a 6-decimal TIP-20.
    limits:
      permissions.limits ??
      (called.length
        ? called.map((token) => ({ limit: 1_000_000_000n, token }))
        : [{ limit: '1000', token: 'ousd' }]),
  })
}
