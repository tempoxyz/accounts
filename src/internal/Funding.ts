/**
 * A funding hint of a redirect authorization, which the authorization request carries as
 * `funding_hint`, `funding_currency`, and `funding_token`.
 * @module
 */
/**
 * A [funding hint](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md): the amount that
 * an app needs in the user's Tempo Account, which the `funding` of `redirect.signIn`,
 * `dialog.signIn`, `device.signIn`, and `backend.start` sends. `funding.open` takes its fields as
 * `amount`, `currency`, and `token`, and sends them to the deposit page, whose methods they select.
 * A sign-in refuses a malformed hint before any request, with `Accounts.RequestError`, the reason
 * `invalid_field`, status 0, and the `field`, such as `funding.amount`.
 */
export type Funding = {
  /**
   * The amount, as a decimal string above 0 with at most 18 digits and 18 decimals, such as `10`.
   * It is the request's `funding_hint`.
   */
  amount: string
  /**
   * The ISO 4217 currency of `amount`, in capital letters, such as `EUR`. Every listed token of the currency counts
   * toward the amount. Defaults to the currency of `token`, or `USD`.
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
