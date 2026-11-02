import { Expiry } from 'viem/tempo'

/** Returns a unix timestamp (seconds) `n` days from now. */
export const days = Expiry.days

/** Returns a unix timestamp (seconds) `n` hours from now. */
export const hours = Expiry.hours

/** Returns a unix timestamp (seconds) `n` minutes from now. */
export const minutes = Expiry.minutes

/** Returns a unix timestamp (seconds) `n` months (30 days) from now. */
export const months = Expiry.months

/** Returns a unix timestamp (seconds) `n` seconds from now. */
export const seconds = Expiry.seconds

/** Returns a unix timestamp (seconds) `n` weeks from now. */
export const weeks = Expiry.weeks

/** Returns a unix timestamp (seconds) `n` years (365 days) from now. */
export const years = Expiry.years
