/**
 * The oracle of `expo` × `transfer`: the starter's app, with a redirect sign-in and a transfer
 * with the access key.
 * @module
 */
import { Accounts } from 'accounts'
import { expo } from 'accounts/expo'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { Button, Text, View } from 'react-native'
import { http, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: tempoLocalnet.id,
  clientId: 'bench-expo',
  plugins: [
    expo({ redirectUri: 'bench.expo:/callback' }),
    react(),
    viem({ chain: tempoLocalnet, transport: http('http://localhost:9545/1') }),
  ],
  url: 'http://localhost:8787',
})

export function App() {
  const { session } = accounts.useSession()
  const [status, setStatus] = useState('')
  if (!session?.accessKey)
    return <Button onPress={() => accounts.redirect.signIn()} title="Sign in" />
  return (
    <View>
      <Text>{session.user.email}</Text>
      <Text>{session.accessKey.account}</Text>
      <Button
        onPress={async () => {
          const { receipt } = await accounts.token.transferSync({
            amount: parseUnits('1', 6),
            to: '0x000000000000000000000000000000000000dEaD',
            token: Addresses.ousd,
          })
          setStatus(receipt.transactionHash)
        }}
        title="Send 1 OUSD"
      />
      <Text>{status}</Text>
    </View>
  )
}
