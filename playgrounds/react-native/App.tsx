import { Provider } from 'accounts'
import { mobileWebAuth, tempoWallet } from 'accounts/mobileWebAuth'
import { secureStorage } from 'accounts/react-native/expo-secure-store'
import { openAuthSession } from 'accounts/react-native/expo-web-browser'
import { StatusBar } from 'expo-status-bar'
import { Hex, Json } from 'ox'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  Button,
  ColorSchemeName,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useColorScheme,
  View,
} from 'react-native'
import { formatUnits, parseUnits, type Address } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoModerato } from 'viem/tempo/chains'

import ConnectForm from './ConnectForm'

const chain = tempoModerato

const tokens = {
  pathUSD: '0x20c0000000000000000000000000000000000000' as Address,
  'USDC.e': '0x20c0000000000000000000009e8d7eb59b783726' as Address,
}

const redirectUri = 'xyz.tempo.accounts.playground:/auth'
const walletDefaultUrl = 'https://wallet.tempo.xyz'
const walletConsumerUrl = process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL
const walletHost = process.env.EXPO_PUBLIC_WALLET_HOST

const provider = Provider.create({
  adapter:
    walletConsumerUrl || walletHost
      ? mobileWebAuth({
          baseUrl: walletConsumerUrl ?? walletDefaultUrl,
          host: walletHost ?? walletDefaultUrl,
          name: 'Tempo Wallet',
          openAuthSession,
          rdns: 'xyz.tempo',
          redirectUri,
        })
      : tempoWallet({ baseUrl: walletDefaultUrl, openAuthSession, redirectUri }),
  authorizeAccessKey: () => ({
    expiry: Math.floor(Date.now() / 1000) + 60 * 5,
    limits: [
      {
        token: tokens.pathUSD,
        limit: parseUnits('5', 6),
      },
    ],
    scopes: [
      { address: tokens.pathUSD, selector: 'transfer(address,uint256)' },
      {
        address: tokens.pathUSD,
        selector: 'transferWithMemo(address,uint256,bytes32)',
      },
    ],
  }),
  storage: secureStorage(),
})

const text = (scheme: ColorSchemeName) => (scheme === 'dark' ? 'white' : 'black')
const muted = (scheme: ColorSchemeName) => (scheme === 'dark' ? '#aaa' : '#666')
const border = (scheme: ColorSchemeName) => (scheme === 'dark' ? '#444' : '#ccc')
const background = (scheme: ColorSchemeName) => (scheme === 'dark' ? 'black' : 'white')

const ThemedText = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) => {
  const scheme = useColorScheme()
  return <Text style={[{ color: text(scheme) }, style]}>{children}</Text>
}

const ThemedTextInput = (props: TextInputProps) => {
  const scheme = useColorScheme()
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={muted(scheme)}
      {...props}
      style={[
        {
          borderColor: border(scheme),
          borderRadius: 6,
          borderWidth: 1,
          color: text(scheme),
          padding: 8,
        },
        props.style,
      ]}
    />
  )
}

/** Runs an async request and tracks its result/error/pending state. */
function useRequest() {
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setPending(true)
    setError(undefined)
    try {
      setResult(await fn())
    } catch (e) {
      setResult(undefined)
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    } finally {
      setPending(false)
    }
  }, [])
  return { error, pending, result, run }
}

/** Card showing a JSON-RPC method, its controls, and the latest result/error. */
function Method(props: {
  children: ReactNode
  error?: string | undefined
  result?: unknown
  title: string
}) {
  const scheme = useColorScheme()
  return (
    <View
      style={{
        borderColor: border(scheme),
        borderRadius: 8,
        borderWidth: 1,
        gap: 8,
        marginTop: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: text(scheme), fontFamily: 'Courier', fontWeight: '600' }}>
        {props.title}
      </Text>
      {props.children}
      {props.error && (
        <Text style={{ color: '#dc2626', fontFamily: 'Courier', fontSize: 11 }} selectable>
          {props.error}
        </Text>
      )}
      {props.result !== undefined && (
        <Text style={{ color: text(scheme), fontFamily: 'Courier', fontSize: 11 }} selectable>
          {stringify(props.result)}
        </Text>
      )}
    </View>
  )
}

function Section(props: { children: ReactNode; title: string }) {
  const scheme = useColorScheme()
  return (
    <View style={{ marginTop: 28 }}>
      <Text
        style={{
          color: muted(scheme),
          fontSize: 13,
          fontWeight: '700',
          textTransform: 'uppercase',
        }}
      >
        {props.title}
      </Text>
      {props.children}
    </View>
  )
}

export default function App() {
  const scheme = useColorScheme()
  const [address, setAddress] = useState<Address | null>(null)
  const [status, setStatus] = useState('disconnected')
  const [balance, setBalance] = useState<string | null>(null)
  const [network, setNetwork] = useState('mainnet')
  const connectReq = useRequest()

  const connect = useCallback(
    async (capabilities: Record<string, unknown>) => {
      setStatus('connecting')
      const result = (await connectReq.run(() =>
        provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: capabilities as never, chainId: Hex.fromNumber(chain.id) }],
        }),
      )) as unknown
      void result
    },
    [connectReq],
  )

  // Reflect the connect result into top-level connection state.
  useEffect(() => {
    const result = connectReq.result as
      | {
          accounts?: {
            address: Address
            capabilities: { keyAuthorization?: { chainId?: string } }
          }[]
        }
      | undefined
    const account = result?.accounts?.[0]
    if (!account) return
    setAddress(account.address)
    setStatus('connected')
    const chainId = account.capabilities.keyAuthorization?.chainId
    setNetwork(chainId === Hex.fromNumber(tempoModerato.id) || !chainId ? 'moderato' : 'mainnet')
  }, [connectReq.result])

  const disconnect = useCallback(async () => {
    try {
      await provider.request({ method: 'wallet_disconnect', params: [] })
    } catch {}
    setAddress(null)
    setStatus('disconnected')
    setBalance(null)
  }, [])

  const fetchBalance = useCallback(async () => {
    if (!address) return
    try {
      const bal = await Actions.token.getBalance(provider.getClient({ chainId: chain.id }), {
        account: address,
        token: tokens.pathUSD,
      })
      setBalance(formatUnits(bal, 6))
    } catch {
      setBalance('error')
    }
  }, [address])

  useEffect(() => {
    if (!address) return
    fetchBalance()
    const interval = setInterval(fetchBalance, 5_000)
    return () => clearInterval(interval)
  }, [address, fetchBalance])

  return (
    <ScrollView
      style={{ flex: 1, padding: 20, paddingTop: 60, backgroundColor: background(scheme) }}
    >
      <StatusBar style="auto" />
      <ThemedText style={{ fontSize: 24, fontWeight: 'bold' }}>Accounts RN Playground</ThemedText>

      <ThemedText style={{ marginTop: 16, fontWeight: 'bold' }}>Status: {status}</ThemedText>
      {address && (
        <ThemedText style={{ fontFamily: 'Courier', fontSize: 12 }}>{address}</ThemedText>
      )}
      <ThemedText style={{ marginTop: 8, fontWeight: 'bold' }}>Network: {network}</ThemedText>
      <ThemedText>Wallet host: {walletHost ?? walletDefaultUrl}</ThemedText>
      <ThemedText>Consumer: {walletConsumerUrl ?? walletDefaultUrl}</ThemedText>
      {balance !== null && (
        <ThemedText style={{ marginTop: 8 }}>Balance: {balance} pathUSD</ThemedText>
      )}

      {!address ? (
        <Section title="Connect">
          <ConnectForm chainId={chain.id} fallbackTokens={tokens} onConnect={connect} />
          {(connectReq.error || connectReq.result !== undefined) && (
            <Method error={connectReq.error} result={connectReq.result} title="wallet_connect">
              {connectReq.pending && <ThemedText>Connecting…</ThemedText>}
            </Method>
          )}
        </Section>
      ) : (
        <>
          <Section title="Connection">
            <EthRequestAccounts />
            <Disconnect onDisconnect={disconnect} />
          </Section>

          <Section title="Accounts & Chain">
            <EthAccounts />
            <EthChainId />
            <SwitchChain onSwitch={setNetwork} />
          </Section>

          <Section title="Balances & Funding">
            <GetBalances />
            <Faucet onDone={fetchBalance} />
            <Deposit />
          </Section>

          <Section title="Transactions">
            <SendTransaction address={address} />
            <Transfer />
            <Swap />
          </Section>

          <Section title="Signing">
            <PersonalSign address={address} />
            <SignTypedData address={address} />
          </Section>

          <Section title="Access Keys">
            <AuthorizeAccessKey />
            <RevokeAccessKey address={address} />
          </Section>
        </>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  )
}

function Disconnect(props: { onDisconnect: () => Promise<void> }) {
  return (
    <Method title="wallet_disconnect">
      <Button title="Disconnect" onPress={props.onDisconnect} />
    </Method>
  )
}

function EthRequestAccounts() {
  const { error, pending, result, run } = useRequest()
  return (
    <Method error={error} result={result} title="eth_requestAccounts">
      <Button
        disabled={pending}
        title="Request Accounts"
        onPress={() => run(() => provider.request({ method: 'eth_requestAccounts' }))}
      />
    </Method>
  )
}

function EthAccounts() {
  const { error, pending, result, run } = useRequest()
  return (
    <Method error={error} result={result} title="eth_accounts">
      <Button
        disabled={pending}
        title="Get Accounts"
        onPress={() => run(() => provider.request({ method: 'eth_accounts' }))}
      />
    </Method>
  )
}

function EthChainId() {
  const { error, pending, result, run } = useRequest()
  return (
    <Method error={error} result={result} title="eth_chainId">
      <Button
        disabled={pending}
        title="Get Chain ID"
        onPress={() => run(() => provider.request({ method: 'eth_chainId' }))}
      />
    </Method>
  )
}

function SwitchChain(props: { onSwitch: (network: string) => void }) {
  const { error, pending, result, run } = useRequest()
  return (
    <Method error={error} result={result} title="wallet_switchEthereumChain">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {provider.chains.map((c) => (
          <View key={c.id} style={{ flexGrow: 1 }}>
            <Button
              disabled={pending}
              title={c.name ?? String(c.id)}
              onPress={() =>
                run(async () => {
                  await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: Hex.fromNumber(c.id) }],
                  })
                  props.onSwitch(c.id === tempoModerato.id ? 'moderato' : 'mainnet')
                  return `switched to ${c.name} (${c.id})`
                })
              }
            />
          </View>
        ))}
      </View>
    </Method>
  )
}

function GetBalances() {
  const { error, pending, result, run } = useRequest()
  return (
    <Method error={error} result={result} title="wallet_getBalances">
      <Button
        disabled={pending}
        title="Get Balances"
        onPress={() =>
          run(() =>
            provider.request({
              method: 'wallet_getBalances',
              params: [{ tokens: Object.values(tokens) }],
            }),
          )
        }
      />
    </Method>
  )
}

function Faucet(props: { onDone: () => Promise<void> }) {
  const { error, pending, result, run } = useRequest()
  return (
    <Method error={error} result={result} title="tempo_fundAddress">
      <Button
        disabled={pending}
        title={pending ? 'Funding…' : 'Fund Account'}
        onPress={() =>
          run(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            const result = await provider.request({
              method: 'tempo_fundAddress',
              params: [accounts[0]],
            } as never)
            await props.onDone()
            return result
          })
        }
      />
    </Method>
  )
}

function Deposit() {
  const { error, pending, result, run } = useRequest()
  const deposit = (params: Record<string, unknown>) =>
    run(() => provider.request({ method: 'wallet_deposit', params: [params] as never }))
  return (
    <Method error={error} result={result} title="wallet_deposit">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button disabled={pending} title="Deposit" onPress={() => deposit({})} />
        <Button disabled={pending} title="$25" onPress={() => deposit({ amount: '25' })} />
        <Button disabled={pending} title="$200" onPress={() => deposit({ amount: '200' })} />
      </View>
    </Method>
  )
}

function SendTransaction(props: { address: Address }) {
  const { error, pending, result, run } = useRequest()
  const [to, setTo] = useState('0x0000000000000000000000000000000000000001')
  const [amount, setAmount] = useState('1')
  return (
    <Method error={error} result={result} title="eth_sendTransaction">
      <ThemedTextInput
        onChangeText={setTo}
        placeholder="To (0x...)"
        style={{ fontFamily: 'Courier', fontSize: 12 }}
        value={to}
      />
      <ThemedTextInput
        keyboardType="numeric"
        onChangeText={setAmount}
        placeholder="Amount"
        value={amount}
      />
      <Button
        disabled={pending}
        title="Send"
        onPress={() =>
          run(() =>
            provider.request({
              method: 'eth_sendTransaction',
              params: [
                {
                  chainId: Hex.fromNumber(chain.id),
                  feeToken: tokens.pathUSD,
                  from: props.address,
                  calls: [
                    Actions.token.transfer.call({
                      to: to as Address,
                      token: tokens.pathUSD,
                      amount: parseUnits(amount || '0', 6),
                    }),
                  ],
                },
              ],
            }),
          )
        }
      />
    </Method>
  )
}

function Transfer() {
  const { error, pending, result, run } = useRequest()
  const transfer = (params: Record<string, unknown>) =>
    run(() => provider.request({ method: 'wallet_transfer', params: [params] as never }))
  return (
    <Method error={error} result={result} title="wallet_transfer">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          disabled={pending}
          title="Send $1 pathUSD"
          onPress={() =>
            transfer({
              amount: '1',
              to: '0x0000000000000000000000000000000000000001',
              token: tokens.pathUSD,
            })
          }
        />
        <Button
          disabled={pending}
          title="With memo"
          onPress={() =>
            transfer({
              amount: '1',
              memo: 'invoice #4821',
              to: '0x0000000000000000000000000000000000000001',
              token: 'pathUSD',
            })
          }
        />
        <Button disabled={pending} title="Editable" onPress={() => transfer({ editable: true })} />
      </View>
    </Method>
  )
}

function Swap() {
  const { error, pending, result, run } = useRequest()
  const pairToken = Object.values(tokens).find((x) => x !== tokens.pathUSD) ?? tokens.pathUSD
  const swap = (params: Record<string, unknown>) =>
    run(() => provider.request({ method: 'wallet_swap', params: [params] as never }))
  return (
    <Method error={error} result={result} title="wallet_swap">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button disabled={pending} title="Swap" onPress={() => swap({})} />
        <Button
          disabled={pending}
          title="Pair"
          onPress={() => swap({ pairToken, token: tokens.pathUSD })}
        />
        <Button
          disabled={pending}
          title="Sell 1 pathUSD"
          onPress={() =>
            swap({ amount: '1', pairToken, slippage: 0.01, token: tokens.pathUSD, type: 'sell' })
          }
        />
      </View>
    </Method>
  )
}

function PersonalSign(props: { address: Address }) {
  const { error, pending, result, run } = useRequest()
  const [message, setMessage] = useState('hello world')
  return (
    <Method error={error} result={result} title="personal_sign">
      <ThemedTextInput onChangeText={setMessage} placeholder="Message" value={message} />
      <Button
        disabled={pending}
        title="Sign"
        onPress={() =>
          run(() =>
            provider.request({
              method: 'personal_sign',
              params: [Hex.fromString(message), props.address],
            }),
          )
        }
      />
    </Method>
  )
}

function SignTypedData(props: { address: Address }) {
  const { error, pending, result, run } = useRequest()
  const sign = (data: object) =>
    run(async () => {
      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [props.address, Json.stringify(data)],
      } as never)
      return { data, signature }
    })
  const mail = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
      ],
    },
    primaryType: 'Mail',
    domain: { name: 'Example', version: '1', chainId: String(chain.id) },
    message: {
      from: { name: 'Alice', wallet: '0x0000000000000000000000000000000000000001' },
      to: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000002' },
      contents: 'Hello, Bob!',
    },
  }
  return (
    <Method error={error} result={result} title="eth_signTypedData_v4">
      <Button disabled={pending} title="Sign (Mail)" onPress={() => sign(mail)} />
    </Method>
  )
}

function AuthorizeAccessKey() {
  const { error, pending, result, run } = useRequest()
  const [expiry, setExpiry] = useState('3600')
  const [amount, setAmount] = useState('100')
  return (
    <Method error={error} result={result} title="wallet_authorizeAccessKey">
      <ThemedTextInput
        keyboardType="numeric"
        onChangeText={setExpiry}
        placeholder="Expiry (seconds)"
        value={expiry}
      />
      <ThemedTextInput
        keyboardType="numeric"
        onChangeText={setAmount}
        placeholder="Limit (pathUSD)"
        value={amount}
      />
      <Button
        disabled={pending}
        title="Authorize"
        onPress={() =>
          run(() =>
            provider.request({
              method: 'wallet_authorizeAccessKey',
              params: [
                {
                  expiry: Math.floor(Date.now() / 1000) + Number(expiry || '3600'),
                  limits: [
                    { token: tokens.pathUSD, limit: Hex.fromNumber(parseUnits(amount || '0', 6)) },
                  ],
                  scopes: [{ address: tokens.pathUSD, selector: 'transfer(address,uint256)' }],
                },
              ],
            } as never),
          )
        }
      />
    </Method>
  )
}

function RevokeAccessKey(props: { address: Address }) {
  const { error, pending, result, run } = useRequest()
  const [accessKeyAddress, setAccessKeyAddress] = useState('')
  return (
    <Method error={error} result={result} title="wallet_revokeAccessKey">
      <ThemedTextInput
        onChangeText={setAccessKeyAddress}
        placeholder="Access key address 0x..."
        style={{ fontFamily: 'Courier', fontSize: 12 }}
        value={accessKeyAddress}
      />
      <Button
        disabled={pending || !accessKeyAddress}
        title="Revoke"
        onPress={() =>
          run(async () => {
            await provider.request({
              method: 'wallet_revokeAccessKey',
              params: [{ address: props.address, accessKeyAddress: accessKeyAddress as Address }],
            })
            return 'revoked'
          })
        }
      />
    </Method>
  )
}

function stringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return Json.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
