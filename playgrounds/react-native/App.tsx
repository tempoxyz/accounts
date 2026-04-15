import { Provider } from '../../dist/react-native/index.js'
import * as Linking from 'expo-linking'
import { Hex } from 'ox'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, ColorSchemeName, ScrollView, StyleProp, Text, TextInput, TextInputProps, TextStyle, useColorScheme, View } from 'react-native'
import { formatUnits, parseUnits, type Address, type Hex as viem_Hex } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoModerato, tempo } from 'viem/chains'

const chain = tempoModerato

const tokens = {
  pathUSD: '0x20c0000000000000000000000000000000000000' as Address,
  'USDC.e': '0x20c0000000000000000000009e8d7eb59b783726' as Address,
}

const redirectUri = Linking.createURL('auth')

const provider = Provider.create({
  redirectUri,
  authorizeAccessKey: () => ({
    expiry: Math.floor(Date.now() / 1000) + 60 * 5,
    limits: [{
      token: tokens.pathUSD,
      limit: parseUnits('5', 6),
    }],
  }),
})

const getBackgroundColor = (colorScheme: ColorSchemeName) => {
  return colorScheme === 'dark' ? 'black' : 'white'
}

const getTextColor = (colorScheme: ColorSchemeName) => {
  return colorScheme === 'dark' ? 'white' : 'black'
}

const ThemedText = ({ children, style }: { children: React.ReactNode, style?: StyleProp<TextStyle> }) => {
  const colorScheme = useColorScheme()
  return <Text style={[{ color: getTextColor(colorScheme) }, style]}>{children}</Text>
}

const ThemedTextInput = (props: TextInputProps) => {
  const colorScheme = useColorScheme()
  const style = useMemo(() => ({ color: getTextColor(colorScheme), ...props.style }), [colorScheme, props.style])
  return <TextInput {...props} style={style} />
}

export default function App() {

  const colorScheme = useColorScheme()
  const [address, setAddress] = useState<Address | null>(null)
  const [status, setStatus] = useState('disconnected')
  const [balance, setBalance] = useState<string | null>(null)
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null)
  const [isFunding, setIsFunding] = useState(false)
  const [txHash, setTxHash] = useState<viem_Hex | null>(null)
  const [signature, setSignature] = useState<viem_Hex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [to, setTo] = useState('0x0000000000000000000000000000000000000001')
  const [amount, setAmount] = useState('1')
  const [message, setMessage] = useState('hello world')
  const [network, setNetwork] = useState('mainnet')

  const switchNetwork = useCallback(async (network: string) => {
    provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: Hex.fromNumber(chain.id) }],
    })
    setNetwork(network)
  }, [])
  console.log("error", error)

  const connect = useCallback(async () => {
    try {
      setStatus('connecting')
      setError(null)
      let result = await provider.request({
        method: 'wallet_connect',
      })

      const addr = result.accounts[0]?.address
      console.log("here", result.accounts[0])
      if (addr) {
        setAddress(addr)
        setStatus('connected')
        const chainId = result.accounts[0]?.capabilities.keyAuthorization?.chainId
        if (chainId) {
          setNetwork(chainId === Hex.fromNumber(tempoModerato.id) ? 'moderato' : 'mainnet')
        } else {
          setNetwork('mainnet')
        }
      } else {
        setError('No account returned from wallet_connect.')
        setStatus('disconnected')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('disconnected')
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await provider.request({ method: 'wallet_disconnect', params: [] })
    } catch {}
    setAddress(null)
    setStatus('disconnected')
    setBalance(null)
    setFaucetStatus(null)
    setTxHash(null)
    setSignature(null)
    setError(null)
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

  const fund = useCallback(async () => {
    if (!address) return
    try {
      setError(null)
      setFaucetStatus(null)
      setIsFunding(true)
      const receipts = await Actions.faucet.fundSync(provider.getClient({ chainId: chain.id }), {
        account: address,
        timeout: 30_000,
      })
      setFaucetStatus(`Funded ${receipts.length} transaction${receipts.length === 1 ? '' : 's'}.`)
      await fetchBalance()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsFunding(false)
    }
  }, [address, fetchBalance])

  const send = useCallback(async () => {
    if (!address) return
    try {
      setError(null)
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          chainId: Hex.fromNumber(chain.id),
          feeToken: tokens.pathUSD,
          from: address,
          calls: [
            Actions.token.transfer.call({
              to: to as Address,
              token: tokens.pathUSD,
              amount: parseUnits(amount || '0', 6),
            }),
          ],
        }],
      })
      setTxHash(hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [address, amount, to])

  const sign = useCallback(async () => {
    if (!address) return
    try {
      setError(null)
      const sig = await provider.request({
        method: 'personal_sign',
        params: [Hex.fromString(message), address],
      })
      setSignature(sig)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [address, message])

  return (
    <ScrollView style={{ flex: 1, padding: 20, paddingTop: 60, backgroundColor: getBackgroundColor(colorScheme) }}>
      <StatusBar style="auto" />
      <ThemedText style={{ fontSize: 24, fontWeight: 'bold',  color: getTextColor(colorScheme) }}>Accounts RN Playground</ThemedText>

      <ThemedText style={{ marginTop: 16, fontWeight: 'bold' }}>Status: {status}</ThemedText>
      {address && <ThemedText style={{ fontFamily: 'monospace', fontSize: 12 }}>{address}</ThemedText>}
      <ThemedText style={{ marginTop: 16, fontWeight: 'bold' }}>Network: {network}</ThemedText>
      <Button title="Switch Network" onPress={() => switchNetwork('moderato')} />

      <View style={{ marginTop: 16 }}>
        {address ? (
          <Button title="Disconnect" onPress={disconnect} />
        ) : (
          <Button title="Connect" onPress={connect} />
        )}
      </View>

      {error && <ThemedText style={{ color: 'red', marginTop: 8 }}>{error}</ThemedText>}

      {address && (
        <>
          <ThemedText style={{ marginTop: 24, fontWeight: 'bold' }}>Balance</ThemedText>
          <ThemedText>{balance !== null ? `${balance} pathUSD` : 'Loading...'}</ThemedText>
          <View style={{ marginTop: 8 }}>
            <Button title={isFunding ? 'Funding...' : 'Fund Account'} onPress={fund} />
          </View>
          {faucetStatus && <ThemedText style={{ marginTop: 4 }}>{faucetStatus}</ThemedText>}

          <ThemedText style={{ marginTop: 24, fontWeight: 'bold' }}>Send Transaction</ThemedText>
          <ThemedTextInput
            value={to}
            onChangeText={setTo}
            placeholder="To (0x...)"
            style={{ borderWidth: 1, borderColor: '#ccc', padding: 8, marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}
          />
          <ThemedTextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            keyboardType="numeric"
            placeholderTextColor={getTextColor(colorScheme)}
            style={{ borderWidth: 1, borderColor: '#ccc', padding: 8, marginTop: 4 }}
          />
          <Button title="Send" onPress={send} />
          {txHash && <ThemedText style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 4 }}>{txHash}</ThemedText>}

          <ThemedText style={{ marginTop: 24, fontWeight: 'bold' }}>Sign Message</ThemedText>
          <ThemedTextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Message"
            style={{ borderWidth: 1, borderColor: '#ccc', padding: 8, marginTop: 4 }}
          />
          <Button title="Sign" onPress={sign} />
          {signature && <ThemedText style={{ fontFamily: 'monospace', fontSize: 10, marginTop: 4 }}>{signature}</ThemedText>}
        </>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  )
}
