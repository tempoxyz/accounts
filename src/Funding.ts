/**
 * A funding hint of a redirect authorization, which the authorization request carries as
 * `funding_hint`, `funding_currency`, and `funding_token`.
 * @module
 */
/** The amount that an app needs in the user's Tempo Account. */
export type Funding = {
  /** The amount, as a decimal string, such as `10`. */
  amount: string
  /**
   * The ISO 4217 currency of `amount`, such as `EUR`. Every listed token of the currency counts.
   * Defaults to the currency of `token`, or `USD`.
   */
  currency?: string | undefined
  /**
   * The symbol or address of the only token that counts, such as `USDC.e`. Its currency must equal
   * `currency`. Absent, every token of the currency counts.
   */
  token?: string | undefined
}

/**
 * Instantiates a {@link Funding}.
 *
 * @example
 * ```ts
 * const funding = Funding.from({ amount: '10', currency: 'USD' })
 * ```
 */
export function from(value: Funding): Funding {
  return value
}
