/** The permissions form of the wagmi playground, as the web playground has it. @module */
import { Permissions } from 'accounts'
import { useQuery } from '@tanstack/react-query'
import { AbiFunction } from 'ox'
import { useState } from 'react'
import { isAddress, isAddressEqual, parseUnits, zeroAddress } from 'viem'
import { Addresses, Expiry, Scopes, Selectors } from 'viem/tempo'
import { tempo, tempoTestnet } from 'viem/tempo/chains'

/** The form's values. An empty field or list leaves it out of the request. */
export type Fields = {
  /** `undefined` for the playground's chain. */
  chainId?: string | undefined
  /** In the form's order. */
  limits: readonly Limit[]
  /** In the form's order. */
  scopes: readonly Scope[]
  /** The key's lifetime in seconds. `undefined` for the default. */
  seconds?: string | undefined
}

/** A token limit as the form holds it. */
export type Limit = {
  /** In whole units, such as `10.5`. */
  amount: string
  /** Converts `amount` to base units. */
  decimals: number
  /** In seconds, or empty for a one-time limit. */
  period: string
  /** An address, or empty before a selection. */
  token: string
}

/** A scope as the form holds it. */
export type Scope = {
  /** The call the key may make. */
  call: Call
  /** A token call's only recipient or spender, or empty for any. */
  recipient: string
  /** A custom call's selector or signature, or empty for any function. */
  selector?: string | undefined
  /** A token call's token, or a custom call's contract. Channel reserve calls ignore it. */
  token: string
}

/** A call that the form offers. The approval page warns about `custom`. */
type Call = keyof typeof calls

/** The calls and their labels. MPP charges use `transferWithMemo`, and sessions `open` and `topUp`. */
const calls = {
  approve: 'approve, of one spender',
  custom: 'Custom call, on any contract',
  open: 'open, an MPP session channel',
  topUp: 'topUp, of an MPP session channel',
  transfer: 'transfer',
  transferWithMemo: 'transferWithMemo',
} as const

/** A limit's periods, in seconds. */
const periods = [
  { label: 'One time', value: '' },
  { label: '1 minute', value: '60' },
  { label: '1 hour', value: '3600' },
  { label: '1 day', value: '86400' },
  { label: '1 week', value: '604800' },
  { label: '30 days', value: '2592000' },
] as const

/** The Tempo API by chain ID. */
const apiUrls = new Map<number, string>([
  [tempo.id, 'https://api.tempo.xyz'],
  [tempoTestnet.id, 'https://api.tempo.xyz'],
  ...((import.meta.env.TEMPO_API_URLS ?? []) as readonly (readonly [
    number,
    string,
  ])[]),
])

/** A verified token from the Tempo API's `GET /v1/verified-tokens`. */
type Token = {
  /** The token's address. */
  address: string
  /** The token's decimals. */
  decimals: number
  /** The token's symbol. */
  symbol: string
}

/** A chain that Tempo ID lists in `GET /v1/chains`. */
type Chain = {
  /** The chain's ID. */
  chainId: number
  /** The name in Tempo ID's `chain` parameter, such as `testnet`. */
  name: string
}

/** Leaves every field to Tempo ID. */
export const empty = { limits: [], scopes: [] }

/** Renders the permission fields. */
export function Form(props: Form.Props) {
  const [fields, setFields] = useState<Fields>(props.defaultValue)

  const chains = useQuery({
    async queryFn() {
      const response = await fetch(new URL('/v1/chains', props.tempoIdUrl))
      if (!response.ok) throw new Error('Tempo ID did not list its chains.')
      return ((await response.json()) as { chains: readonly Chain[] }).chains
    },
    queryKey: ['chains'],
    staleTime: Number.POSITIVE_INFINITY,
  })

  // A chain ID that Tempo ID does not list shows as a custom one, as does a remembered one before
  // the list loads, so the select never shows an option that the fields do not hold.
  const [custom, setCustom] = useState(false)
  const listed =
    chains.data?.some((entry) => String(entry.chainId) === fields.chainId) ??
    false
  const choice = (() => {
    if (custom || (fields.chainId && !listed)) return 'custom'
    return fields.chainId ?? ''
  })()

  const chainId = Number(fields.chainId || props.chainId)
  const apiUrl = apiUrls.get(chainId)
  const tokens = useQuery({
    enabled: Boolean(apiUrl) && !props.disabled,
    async queryFn() {
      const url = new URL('/v1/verified-tokens', apiUrl)
      url.searchParams.set('chainId', String(chainId))
      const response = await fetch(url)
      if (!response.ok) throw new Error('The Tempo API did not list tokens.')
      return ((await response.json()) as { data: readonly Token[] }).data
    },
    queryKey: ['tokens', chainId],
    staleTime: Number.POSITIVE_INFINITY,
  })

  const update = (patch: Partial<Fields>) =>
    setFields((current) => ({ ...current, ...patch }))
  const limit = (index: number, patch: Partial<Limit>) =>
    update({
      limits: fields.limits.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    })
  const scope = (index: number, patch: Partial<Scope>) =>
    update({
      scopes: fields.scopes.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    })

  const status = (() => {
    if (chains.isError)
      return `${chains.error.message} Enter a custom chain ID, or reload the page.`
    if (!apiUrl)
      return `No Tempo API for chain ${chainId}. Enter token addresses, or add the chain to TEMPO_API_URLS.`
    if (tokens.isError) return tokens.error.message
    return undefined
  })()

  return (
    <>
      <input name="permissions" type="hidden" value={JSON.stringify(fields)} />
      <label>
        Chain
        <select
          onChange={(event) => {
            const value = event.currentTarget.value
            setCustom(value === 'custom')
            update({
              chainId: value === 'custom' || !value ? undefined : value,
            })
          }}
          value={choice}
        >
          <option value="">This playground's ({props.chainId})</option>
          {chains.data?.map((entry) => (
            <option key={entry.name} value={String(entry.chainId)}>
              {`${entry.name} (${entry.chainId})`}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {choice === 'custom' ? (
        <label>
          Chain ID
          <input
            inputMode="numeric"
            onChange={(event) =>
              update({ chainId: event.currentTarget.value.trim() || undefined })
            }
            placeholder="Chain ID"
            value={fields.chainId ?? ''}
          />
        </label>
      ) : null}
      <label>
        Expiry in seconds
        <input
          inputMode="numeric"
          onChange={(event) =>
            update({ seconds: event.currentTarget.value.trim() || undefined })
          }
          value={fields.seconds ?? ''}
        />
      </label>
      {status ? <p aria-live="polite">{status}</p> : null}

      <fieldset style={styles.list}>
        <legend>Limits</legend>
        {fields.limits.map((entry, index) => (
          <div key={index} style={styles.row}>
            <TokenField
              onChange={(token, decimals) => limit(index, { decimals, token })}
              tokens={tokens.data}
              value={entry.token}
            />
            <label>
              Amount
              <input
                inputMode="decimal"
                onChange={(event) =>
                  limit(index, { amount: event.currentTarget.value.trim() })
                }
                size={10}
                value={entry.amount}
              />
            </label>
            <label>
              Period
              <select
                onChange={(event) =>
                  limit(index, { period: event.currentTarget.value })
                }
                value={entry.period}
              >
                {periods.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                update({
                  limits: fields.limits.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
              type="button"
            >
              Remove limit
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            update({
              limits: [
                ...fields.limits,
                { amount: '', decimals: 6, period: '', token: '' },
              ],
            })
          }
          style={styles.add}
          type="button"
        >
          Add a limit
        </button>
      </fieldset>

      <fieldset style={styles.list}>
        <legend>Scopes</legend>
        {fields.scopes.map((entry, index) => {
          const reserve = entry.call === 'open' || entry.call === 'topUp'
          return (
            <div key={index} style={styles.row}>
              <label>
                Call
                <select
                  onChange={(event) =>
                    scope(index, {
                      call: event.currentTarget.value as Call,
                    })
                  }
                  value={entry.call}
                >
                  {Object.entries(calls).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {(() => {
                if (reserve) return <span>On the channel reserve</span>
                if (entry.call === 'custom')
                  return (
                    <>
                      <label>
                        Contract
                        <input
                          onChange={(event) =>
                            scope(index, {
                              token: event.currentTarget.value.trim(),
                            })
                          }
                          placeholder="0x…"
                          value={entry.token}
                        />
                      </label>
                      <label>
                        Function
                        <input
                          onChange={(event) =>
                            scope(index, {
                              selector: event.currentTarget.value.trim(),
                            })
                          }
                          placeholder="Any function"
                          value={entry.selector ?? ''}
                        />
                      </label>
                    </>
                  )
                return (
                  <>
                    <TokenField
                      onChange={(token) => scope(index, { token })}
                      tokens={tokens.data}
                      value={entry.token}
                    />
                    <label>
                      {entry.call === 'approve' ? 'Spender' : 'Recipient'}
                      <input
                        onChange={(event) =>
                          scope(index, {
                            recipient: event.currentTarget.value.trim(),
                          })
                        }
                        placeholder={
                          entry.call === 'approve' ? '0x…' : 'Any address'
                        }
                        value={entry.recipient}
                      />
                    </label>
                  </>
                )
              })()}
              <button
                onClick={() =>
                  update({
                    scopes: fields.scopes.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
                type="button"
              >
                Remove scope
              </button>
            </div>
          )
        })}
        <button
          onClick={() =>
            update({
              scopes: [
                ...fields.scopes,
                { call: 'transfer', recipient: '', token: '' },
              ],
            })
          }
          style={styles.add}
          type="button"
        >
          Add a scope
        </button>
      </fieldset>
    </>
  )
}

export declare namespace Form {
  type Props = {
    /** The playground's chain ID, which applies when the form names none. */
    chainId: number
    /** The starting values. */
    defaultValue: Fields
    /** Whether the form is disabled, which stops the token fetch. */
    disabled?: boolean | undefined
    /** Tempo ID's URL, whose `GET /v1/chains` lists the chains. */
    tempoIdUrl: string
  }
}

/** Selects a verified token, or takes a custom address with 6 decimals. */
function TokenField(props: TokenField.Props) {
  const known = props.tokens?.find(
    (token) => token.address.toLowerCase() === props.value.toLowerCase(),
  )
  const [custom, setCustom] = useState(false)
  const choice = (() => {
    if (custom || (props.value && !known)) return 'custom'
    return known?.address ?? ''
  })()

  return (
    <>
      <label>
        Token
        <select
          onChange={(event) => {
            const value = event.currentTarget.value
            setCustom(value === 'custom')
            if (value === 'custom') return
            const token = props.tokens?.find((entry) => entry.address === value)
            props.onChange(value, token?.decimals ?? 6)
          }}
          value={choice}
        >
          <option value="">Select a token</option>
          {props.tokens?.map((token) => (
            <option key={token.address} value={token.address}>
              {token.symbol}
            </option>
          ))}
          <option value="custom">Custom address</option>
        </select>
      </label>
      {choice === 'custom' ? (
        <label>
          Address
          <input
            onChange={(event) =>
              // ponytail: TIP-20 tokens have 6 decimals. Read `decimals()` if a custom token differs.
              props.onChange(event.currentTarget.value.trim(), 6)
            }
            placeholder="0x…"
            value={props.value}
          />
        </label>
      ) : null}
    </>
  )
}

declare namespace TokenField {
  type Props = {
    /** Receives the token's address and decimals. */
    onChange: (token: string, decimals: number) => void
    /** `undefined` before the tokens load, or without a Tempo API. */
    tokens: readonly Token[] | undefined
    /** The token's address, or empty. */
    value: string
  }
}

/** Returns the fields of a `Form`, or a sentence that names the fix. */
export function read(data: FormData): Fields | string {
  // A disabled form sends no input, so its fields read as empty.
  const fields: Fields = {
    ...empty,
    ...JSON.parse(String(data.get('permissions') ?? '{}')),
  }
  const whole = (value: string) =>
    /^\d+$/.test(value) &&
    Number(value) > 0 &&
    Number.isSafeInteger(Number(value))

  if (fields.chainId && !whole(fields.chainId))
    return 'Enter the chain ID as a whole number above 0.'
  if (fields.seconds && !whole(fields.seconds))
    return 'Enter the expiry as a whole number of seconds above 0, or leave it empty.'
  for (const [index, entry] of fields.limits.entries()) {
    if (!isAddress(entry.token)) return `Select a token for limit ${index + 1}.`
    if (
      !new RegExp(`^\\d+(\\.\\d{1,${entry.decimals}})?$`).test(entry.amount) ||
      parseUnits(entry.amount, entry.decimals) === 0n
    )
      return `Enter the amount of limit ${index + 1} above 0, with at most ${entry.decimals} decimals.`
  }
  for (const [index, entry] of fields.scopes.entries()) {
    if (entry.call === 'open' || entry.call === 'topUp') continue
    if (entry.call === 'custom') {
      if (!isAddress(entry.token))
        return `Enter the contract of scope ${index + 1} as an address.`
      if (entry.selector && !selector(entry.selector))
        return `Enter the function of scope ${index + 1} as a 4-byte selector or a signature, such as transfer(address,uint256), or leave it empty.`
      // Any function on a TIP-20 token includes `approve` without spenders, which Tempo ID refuses.
      if (!entry.selector && tip20(entry.token))
        return `Enter the function of scope ${index + 1}, since a scope on a TIP-20 token names its function.`
      continue
    }
    if (!isAddress(entry.token)) return `Select a token for scope ${index + 1}.`
    // Tempo ID accepts a spender or recipient only on a TIP-20 token.
    if ((entry.call === 'approve' || entry.recipient) && !tip20(entry.token))
      return `Select a TIP-20 token for scope ${index + 1}, since only a TIP-20 token takes a ${entry.call === 'approve' ? 'spender' : 'recipient'}.`
    // Tempo ID refuses the zero address as a recipient or spender.
    if (
      entry.call === 'approve' &&
      (!isAddress(entry.recipient) ||
        isAddressEqual(entry.recipient, zeroAddress))
    )
      return `Enter the spender of scope ${index + 1} as an address other than the zero address.`
    if (
      entry.recipient &&
      (!isAddress(entry.recipient) ||
        isAddressEqual(entry.recipient, zeroAddress))
    )
      return `Enter the recipient of scope ${index + 1} as an address other than the zero address, or leave it empty.`
  }
  return fields
}

/** Whether `address` has the TIP-20 prefix that Tempo ID checks. */
function tip20(address: string) {
  return address.toLowerCase().startsWith('0x20c000000000000000000000')
}

/** Whether `value` is a 4-byte selector or a function signature. */
function selector(value: string) {
  if (/^0x[0-9a-fA-F]{8}$/.test(value)) return true
  try {
    AbiFunction.getSelector(value)
    return true
  } catch {
    return false
  }
}

/** The permissions that `fields` request. The expiry counts from the call. */
export function toPermissions(fields: Fields) {
  return Permissions.from({
    ...(fields.chainId ? { chainId: Number(fields.chainId) } : {}),
    ...(fields.seconds
      ? { expiry: Expiry.seconds(Number(fields.seconds)) }
      : {}),
    ...(fields.limits.length
      ? {
          limits: fields.limits.map((entry) => ({
            limit: parseUnits(entry.amount, entry.decimals),
            ...(entry.period ? { period: Number(entry.period) } : {}),
            token: entry.token as `0x${string}`,
          })),
        }
      : {}),
    ...(fields.scopes.length
      ? {
          scopes: fields.scopes.map((entry) => {
            if (entry.call === 'open' || entry.call === 'topUp')
              return Scopes.contract(
                Addresses.tip20ChannelReserve,
                Selectors.tip20ChannelReserve,
              )[entry.call]()
            if (entry.call === 'custom') {
              const target = Scopes.target(entry.token as `0x${string}`)
              return entry.selector
                ? target.selector(entry.selector)
                : target.any()
            }
            return Scopes.tip20(entry.token as `0x${string}`)[entry.call](
              entry.recipient
                ? { recipients: [entry.recipient as `0x${string}`] }
                : {},
            )
          }),
        }
      : {}),
  })
}

/** The layout of the lists and their rows. */
const styles = {
  add: { alignSelf: 'flex-start' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: 8 },
} as const
