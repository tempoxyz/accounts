import { Hex } from 'ox'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Button,
  ColorSchemeName,
  Pressable,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'
import { parseUnits } from 'viem'

const periodOptions = [
  { label: '10 seconds', value: '10' },
  { label: '1 minute', value: '300' },
  { label: '1 hour', value: '3600' },
  { label: '1 day', value: '86400' },
  { label: '1 month', value: '2592000' },
  { label: '1 year', value: '31536000' },
] as const

const scopePresets = [
  { label: 'None', value: '' },
  { label: 'transfer(address,uint256)', value: 'transfer(address,uint256)' },
  { label: 'approve(address,uint256)', value: 'approve(address,uint256)' },
  {
    label: 'transferFrom(address,address,uint256)',
    value: 'transferFrom(address,address,uint256)',
  },
] as const

type TokenlistEntry = {
  address: string
  chainId: number
  decimals: number
  logoURI?: string
  name: string
  symbol: string
}

type LimitInput = {
  token: string
  amount: string
  /** Empty string = no period (lifetime budget). */
  period: string
}

const textColor = (scheme: ColorSchemeName) => (scheme === 'dark' ? 'white' : 'black')
const mutedColor = (scheme: ColorSchemeName) => (scheme === 'dark' ? '#aaa' : '#666')
const borderColor = (scheme: ColorSchemeName) => (scheme === 'dark' ? '#444' : '#ccc')

export default function ConnectForm(props: {
  chainId: number
  fallbackTokens: Record<string, string>
  onConnect: (capabilities: Record<string, unknown>) => Promise<void>
}) {
  const { chainId, fallbackTokens, onConnect } = props
  const scheme = useColorScheme()
  const tokenlist = useTokenlist(chainId, fallbackTokens)
  const [name, setName] = useState('')
  const [digest, setDigest] = useState('')
  const [accessKeyEnabled, setAccessKeyEnabled] = useState(false)
  const [expiry, setExpiry] = useState('86400')
  const [limits, setLimits] = useState<LimitInput[]>([{ token: '', amount: '100', period: '' }])
  const [scopeSelector, setScopeSelector] = useState('transfer(address,uint256)')
  const [authEnabled, setAuthEnabled] = useState(false)
  const [identityEmailEnabled, setIdentityEmailEnabled] = useState(false)
  const [showDepositEnabled, setShowDepositEnabled] = useState(false)
  const [showDepositAmount, setShowDepositAmount] = useState('')
  const [showDepositToken, setShowDepositToken] = useState('')
  const [pending, setPending] = useState<'login' | 'register' | null>(null)

  // Once the tokenlist resolves, hydrate any unselected limit row with the first token.
  useEffect(() => {
    const first = tokenlist[0]?.address
    if (!first) return
    setLimits((prev) => prev.map((l) => (l.token ? l : { ...l, token: first })))
  }, [tokenlist])

  function updateLimit(index: number, patch: Partial<LimitInput>) {
    setLimits((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function addLimit() {
    setLimits((prev) => [...prev, { token: '', amount: '100', period: '' }])
  }
  function removeLimit(index: number) {
    setLimits((prev) => prev.filter((_, i) => i !== index))
  }
  function tokenInfo(address: string) {
    return tokenlist.find((t) => t.address.toLowerCase() === address.toLowerCase())
  }

  function buildCapabilities(method: 'login' | 'register') {
    const authorizeAccessKey = accessKeyEnabled
      ? (() => {
          const filledLimits = limits.filter((l) => l.token && l.amount)
          return {
            expiry: Math.floor(Date.now() / 1000) + Number(expiry || '86400'),
            ...(filledLimits.length > 0 && {
              limits: filledLimits.map((l) => ({
                token: l.token,
                limit: Hex.fromNumber(parseUnits(l.amount, tokenInfo(l.token)?.decimals ?? 6)),
                ...(l.period ? { period: Number(l.period) } : {}),
              })),
            }),
            ...(scopeSelector && filledLimits[0]
              ? { scopes: [{ address: filledLimits[0].token, selector: scopeSelector }] }
              : {}),
          }
        })()
      : undefined

    // Server Authentication: native apps have no origin to absolutize a
    // relative path against, so the App passes an absolute `/auth` URL.
    const auth = authEnabled ? '/auth' : undefined
    const identity = identityEmailEnabled ? { email: true } : undefined
    const showDeposit = showDepositEnabled
      ? (() => {
          const amount = showDepositAmount.trim()
          const token = showDepositToken.trim()
          const value = { ...(amount ? { amount } : {}), ...(token ? { token } : {}) }
          if (Object.keys(value).length === 0) return true
          return value
        })()
      : undefined

    return {
      ...(method === 'register' ? { method: 'register' as const, ...(name ? { name } : {}) } : {}),
      ...(digest ? { digest } : {}),
      ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
      ...(auth ? { auth } : {}),
      ...(identity ? { identity } : {}),
      ...(showDeposit ? { showDeposit } : {}),
    }
  }

  async function submit(method: 'login' | 'register') {
    setPending(method)
    try {
      await onConnect(buildCapabilities(method))
    } finally {
      setPending(null)
    }
  }

  const tokenItems = useMemo(
    () => tokenlist.map((t) => ({ label: t.symbol, value: t.address })),
    [tokenlist],
  )

  return (
    <View style={{ gap: 12 }}>
      <Field label="Name">
        <TextField onChangeText={setName} placeholder="Account name (optional)" value={name} />
      </Field>
      <Field label="Digest">
        <TextField mono onChangeText={setDigest} placeholder="0x... (optional)" value={digest} />
      </Field>

      <Fieldset
        checked={accessKeyEnabled}
        label="Authorize Access Key"
        onChange={setAccessKeyEnabled}
      >
        <Field label="Expiry (seconds)">
          <TextField
            keyboardType="numeric"
            onChangeText={setExpiry}
            placeholder="86400"
            value={expiry}
          />
        </Field>
        <Text style={{ color: textColor(scheme), fontWeight: '600' }}>Limits</Text>
        {limits.map((limit, i) => (
          <View
            key={i}
            style={{
              borderColor: borderColor(scheme),
              borderRadius: 6,
              borderWidth: 1,
              gap: 8,
              padding: 8,
            }}
          >
            <Chips
              items={tokenItems}
              onChange={(token) => updateLimit(i, { token })}
              value={limit.token}
            />
            <TextField
              keyboardType="numeric"
              onChangeText={(amount) => updateLimit(i, { amount })}
              placeholder="100"
              value={limit.amount}
            />
            <Toggle
              label="Period"
              onChange={(checked) => updateLimit(i, { period: checked ? '2592000' : '' })}
              value={limit.period !== ''}
            />
            {limit.period !== '' && (
              <Chips
                items={periodOptions.map((o) => ({ label: o.label, value: o.value }))}
                onChange={(period) => updateLimit(i, { period })}
                value={limit.period}
              />
            )}
            <Button
              disabled={limits.length === 1}
              onPress={() => removeLimit(i)}
              title="Remove limit"
            />
          </View>
        ))}
        <Button onPress={addLimit} title="+ Add limit" />
        <Field label="Scope">
          <Chips
            items={scopePresets.map((o) => ({ label: o.label, value: o.value }))}
            onChange={setScopeSelector}
            value={scopeSelector}
          />
        </Field>
      </Fieldset>

      <Fieldset checked={authEnabled} label="Authenticate with Server" onChange={setAuthEnabled} />
      <Fieldset
        checked={identityEmailEnabled}
        label="Request Verified Email"
        onChange={setIdentityEmailEnabled}
      />

      <Fieldset checked={showDepositEnabled} label="Show Deposit" onChange={setShowDepositEnabled}>
        <Field label="Amount">
          <TextField
            keyboardType="numeric"
            onChangeText={setShowDepositAmount}
            placeholder="50"
            value={showDepositAmount}
          />
        </Field>
        <Field label="Token">
          <Chips
            items={[{ label: 'None', value: '' }, ...tokenItems]}
            onChange={setShowDepositToken}
            value={showDepositToken}
          />
        </Field>
      </Fieldset>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            disabled={pending !== null}
            onPress={() => submit('login')}
            title={pending === 'login' ? 'Connecting…' : 'Login'}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            disabled={pending !== null}
            onPress={() => submit('register')}
            title={pending === 'register' ? 'Connecting…' : 'Register'}
          />
        </View>
      </View>
    </View>
  )
}

function Field(props: { children: ReactNode; label: string }) {
  const scheme = useColorScheme()
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: mutedColor(scheme), fontSize: 13 }}>{props.label}</Text>
      {props.children}
    </View>
  )
}

function TextField(props: {
  keyboardType?: 'numeric'
  mono?: boolean
  onChangeText: (value: string) => void
  placeholder?: string
  value: string
}) {
  const scheme = useColorScheme()
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={props.keyboardType}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={mutedColor(scheme)}
      style={{
        borderColor: borderColor(scheme),
        borderRadius: 6,
        borderWidth: 1,
        color: textColor(scheme),
        fontFamily: props.mono ? 'Courier' : undefined,
        padding: 8,
      }}
      value={props.value}
    />
  )
}

function Toggle(props: { label: string; onChange: (value: boolean) => void; value: boolean }) {
  const scheme = useColorScheme()
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: textColor(scheme) }}>{props.label}</Text>
      <Switch onValueChange={props.onChange} value={props.value} />
    </View>
  )
}

function Chips(props: {
  items: { label: string; value: string }[]
  onChange: (value: string) => void
  value: string
}) {
  const scheme = useColorScheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {props.items.map((item) => {
        const selected = item.value === props.value
        return (
          <Pressable
            key={item.value || 'none'}
            onPress={() => props.onChange(item.value)}
            style={{
              borderColor: selected ? '#2563eb' : borderColor(scheme),
              borderRadius: 6,
              borderWidth: 1,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: selected ? '#2563eb' : textColor(scheme) }}>{item.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Fieldset(props: {
  checked: boolean
  children?: ReactNode
  label: string
  onChange: (checked: boolean) => void
}) {
  const scheme = useColorScheme()
  return (
    <View
      style={{
        borderColor: borderColor(scheme),
        borderRadius: 8,
        borderWidth: 1,
        gap: 12,
        padding: 12,
      }}
    >
      <Toggle label={props.label} onChange={props.onChange} value={props.checked} />
      {props.checked && props.children}
    </View>
  )
}

/** Fetch the live token list for the current chain, with a static fallback. */
function useTokenlist(chainId: number, fallbackTokens: Record<string, string>): TokenlistEntry[] {
  const [list, setList] = useState<TokenlistEntry[]>(() =>
    Object.entries(fallbackTokens).map(([symbol, address]) => ({
      address,
      chainId,
      decimals: 6,
      name: symbol,
      symbol,
    })),
  )
  useEffect(() => {
    fetch(`https://tokenlist.tempo.xyz/list/${chainId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = (data as { tokens?: TokenlistEntry[] } | null)?.tokens
        if (list?.length) setList(list)
      })
      .catch(() => {})
  }, [chainId])
  return list
}
