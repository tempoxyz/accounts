/**
 * A native app that signs in with Tempo ID in the system browser, keeps the session in the device's
 * secure store, and sends OUSD with the access key of the sign-in.
 * @module
 */
import { Id } from 'accounts'
import { expo } from 'accounts/expo'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as React from 'react'
import { Button, SafeAreaView, Text } from 'react-native'
import { parseUnits } from 'viem'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

/** OUSD, at its mainnet address on every Tempo chain. */
const ousd = Tokens.ousd(tempo.id).address

/**
 * The instance, on Tempo testnet. `expo` keeps the session in the secure store, and signs in on
 * Tempo ID's pages in the system browser, which returns to the app's scheme from `app.json`. Each
 * sign-in requests a key that sends up to 100 OUSD for a day.
 */
const tempoId = Id.create({
  accessKey: () => ({
    expiry: Expiry.days(1),
    limits: [{ limit: parseUnits('100', 6), token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  }),
  clientId: 'tempo-example-mobile',
  dev: true,
  plugins: [
    expo({ redirectUri: 'xyz.tempo.example.mobile:/callback' }),
    react(),
    viem(),
  ],
  url: process.env.EXPO_PUBLIC_TEMPO_ID_URL ?? 'http://localhost:5173',
})

/** The root component. */
export function App() {
  const { session } = tempoId.useSession()
  const [status, setStatus] = React.useState<string>()

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  return (
    <SafeAreaView style={{ gap: 12, padding: 16 }}>
      {session?.key ? (
        <>
          <Text>Signed in as {session.user.email}</Text>
          <Text>Tempo Account {session.key.account}</Text>
          <Button
            onPress={() =>
              run(async () => {
                const { receipt } = await tempoId.token.transferSync({
                  amount: parseUnits('0.01', 6),
                  to: '0x000000000000000000000000000000000000dEaD',
                  token: ousd,
                })
                return `Sent in ${receipt.transactionHash}.`
              })
            }
            title="Send 0.01 OUSD"
          />
          <Button
            onPress={() => run(async () => (await tempoId.signOut(), ''))}
            title="Sign out"
          />
        </>
      ) : (
        <Button
          onPress={() => run(async () => (await tempoId.redirect.signIn(), ''))}
          title="Sign in with Tempo"
        />
      )}
      <Text>{status}</Text>
    </SafeAreaView>
  )
}
