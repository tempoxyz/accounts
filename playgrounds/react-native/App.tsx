import { Provider, secureStorage } from '../../dist/react-native/index.js'
import * as Linking from 'expo-linking'
import { Hex } from 'ox'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { Button, ScrollView, Text, TextInput, View } from 'react-native'
import { formatUnits, parseUnits, type Address, type Hex as viem_Hex } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoModerato } from 'viem/chains'

const chain = tempoModerato

const tokens = {
  pathUSD: '0x20c0000000000000000000000000000000000000' as Address,
  'USDC.e': '0x20c0000000000000000000009e8d7eb59b783726' as Address,
}

const redirectUri = Linking.createURL('auth')

const provider = Provider.create({
  chains: [chain],
  host: 'https://wallet.tempo.xyz',
  redirectUri,
  secureStorage: secureStorage(),
  authorizeAccessKey: () => ({
    expiry: Math.floor(Date.now() / 1000) + 60 * 5,
    limits: [{
      token: tokens.pathUSD,
      limit: parseUnits('5', 6),
    }],
  }),
})

export default function App() {
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

  const connect = useCallback(async () => {
    try {
      setStatus('connecting')
      setError(null)
      let result = await provider.request({
        method: 'wallet_connect',
        params: [{
          capabilities: { method: 'login' },
          chainId: Hex.fromNumber(chain.id),
        }],
      })

      if (result.accounts.length === 0)
        result = await provider.request({
          method: 'wallet_connect',
          params: [{
            capabilities: {
              method: 'register',
              name: 'Accounts RN Playground',
            },
            chainId: Hex.fromNumber(chain.id),
          }],
        })

      const addr = result.accounts[0]?.address
      if (addr) {
        setAddress(addr)
        setStatus('connected')
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
    <ScrollView style={{ flex: 1, padding: 20, paddingTop: 60 }}>
      <StatusBar style="auto" />
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Accounts RN Playground</Text>

      <Text style={{ marginTop: 16, fontWeight: 'bold' }}>Status: {status}</Text>
      {address && <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{address}</Text>}

      <View style={{ marginTop: 16 }}>
        {address ? (
          <Button title="Disconnect" onPress={disconnect} />
        ) : (
          <Button title="Connect" onPress={connect} />
        )}
      </View>

      {error && <Text style={{ color: 'red', marginTop: 8 }}>{error}</Text>}

      {address && (
        <>
          <Text style={{ marginTop: 24, fontWeight: 'bold' }}>Balance</Text>
          <Text>{balance !== null ? `${balance} pathUSD` : 'Loading...'}</Text>
          <View style={{ marginTop: 8 }}>
            <Button title={isFunding ? 'Funding...' : 'Fund Account'} onPress={fund} />
          </View>
          {faucetStatus && <Text style={{ marginTop: 4 }}>{faucetStatus}</Text>}

          <Text style={{ marginTop: 24, fontWeight: 'bold' }}>Send Transaction</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="To (0x...)"
            style={{ borderWidth: 1, borderColor: '#ccc', padding: 8, marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            keyboardType="numeric"
            style={{ borderWidth: 1, borderColor: '#ccc', padding: 8, marginTop: 4 }}
          />
          <Button title="Send" onPress={send} />
          {txHash && <Text style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 4 }}>{txHash}</Text>}

          <Text style={{ marginTop: 24, fontWeight: 'bold' }}>Sign Message</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Message"
            style={{ borderWidth: 1, borderColor: '#ccc', padding: 8, marginTop: 4 }}
          />
          <Button title="Sign" onPress={sign} />
          {signature && <Text style={{ fontFamily: 'monospace', fontSize: 10, marginTop: 4 }}>{signature}</Text>}
        </>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  )
}
