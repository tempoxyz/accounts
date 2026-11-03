/**
 * The funding hint fields that the web and third-party playgrounds share. A redirect or dialog
 * sign-in sends them as `funding_hint`, `funding_currency`, and `funding_token`.
 * @module
 */
import { Funding } from 'accounts/internal'
import { useMemo, useState } from 'react'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import { tokens } from 'viem/tokens'

/** The fields of the funding hint, which a redirect or dialog sign-in sends. Empty fields send no hint. */
export function Form(props: Form.Props) {
  const listed = useMemo(() => listings(props), [props.chainId])
  const currencies = [...new Set(listed.map((token) => token.currency))].sort()
  // The token list shows only the tokens of the selected currency.
  const [currency, setCurrency] = useState('USD')

  return (
    <fieldset aria-label="Funding hint">
      <p className="muted">
        An account below the amount opens the funding page after the approval.
      </p>
      <div className="row">
        <label>
          Amount{' '}
          <input
            inputMode="decimal"
            name="funding_hint"
            pattern="\d+(\.\d+)?"
            placeholder="10"
          />
        </label>
        <label>
          Currency{' '}
          <select
            name="funding_currency"
            onChange={(event) => setCurrency(event.currentTarget.value)}
            value={currency}
          >
            {currencies.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label>
          Token{' '}
          <select defaultValue="" key={currency} name="funding_token">
            <option value="">Any {currency} token</option>
            {listed
              .filter((token) => token.currency === currency)
              .map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.symbol}
                </option>
              ))}
          </select>
        </label>
      </div>
    </fieldset>
  )
}

export declare namespace Form {
  type Props = {
    /** The chain of the sign-in, whose tokens the lists offer. */
    chainId: number
  }
}

/**
 * Returns the tokens of `chainId` in Viem's Tempo list, as Tempo ID lists them: a devnet or a local
 * node holds the testnet's tokens, and OUSD has its mainnet address on every Tempo chain. Only an
 * ISO 4217 currency counts.
 */
function listings(options: { chainId: number }) {
  return tokens.tempo.flatMap((token) => {
    const addresses = token.addresses as Record<number, string | undefined>
    const address =
      addresses[options.chainId] ??
      (options.chainId === tempoDevnet.id ||
      options.chainId === tempoLocalnet.id
        ? addresses[tempoTestnet.id]
        : undefined) ??
      (token.symbol === 'OUSD' ? addresses[tempo.id] : undefined)
    if (!address || !token.currency || !/^[A-Z]{3}$/.test(token.currency))
      return []
    return [{ currency: token.currency, symbol: token.symbol }]
  })
}

/** Returns the funding hint of the fields in `form`, or `undefined` without an amount. */
export function read(form: FormData): Funding.Funding | undefined {
  const value = (name: string) => {
    const entry = form.get(name)
    return typeof entry === 'string' && entry.trim() ? entry.trim() : undefined
  }
  const amount = value('funding_hint')
  if (!amount) return undefined
  return Funding.from({
    amount,
    currency: value('funding_currency'),
    token: value('funding_token'),
  })
}
