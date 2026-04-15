export const knownCurrencies = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'KRW',
  'CHF',
  'CAD',
  'AUD',
  'BRL',
  'SGD',
]

export type Token = { formatted: string; symbol: string }

/** Format a token amount as fiat currency if the symbol contains a known currency, otherwise as crypto. */
export function fiat(token: Token): string {
  const currency = inferCurrency(token.symbol)
  if (currency)
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
      Number.parseFloat(token.formatted),
    )
  return crypto(token)
}

/** Format a token amount with its symbol (e.g. "1.00 WETH"). */
export function crypto(token: Token): string {
  return `${token.formatted} ${token.symbol}`
}

/** Infer an ISO 4217 currency code from a token symbol (e.g. "PathUSD" → "USD"). */
function inferCurrency(symbol: string): string | undefined {
  const upper = symbol.toUpperCase()
  return knownCurrencies.find((c) => upper.includes(c))
}
