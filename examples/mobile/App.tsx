/**
 * A native app that signs in with Tempo ID in the system browser, keeps the session in the device's
 * secure store, and sends OUSD with the access key of the sign-in.
 * @module
 */
import { Accounts } from 'accounts'
import { expo } from 'accounts/expo'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as React from 'react'
import { Button, SafeAreaView, Text } from 'react-native'

/**
 * The instance, on Tempo testnet. `expo` keeps the session in the secure store, and signs in on
 * Tempo ID's pages in the system browser, which returns to the app's scheme from `app.json`. Each
 * sign-in requests an access key that sends up to 100 OUSD for a day.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  clientId: 'tempo-example-mobile',
  plugins: [
    expo({ redirectUri: 'xyz.tempo.example.mobile:/callback' }),
    react(),
    viem(),
  ],
})

/** The root component. */
export function App() {
  const { isPending, session } = accounts.useSession()
  const [status, setStatus] = React.useState<string>()

  // The first render reads the secure store, so a returning user sees no sign-in before the restore.
  if (isPending) return null

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  return (
    <SafeAreaView style={{ gap: 12, padding: 16 }}>
      {session?.accessKey ? (
        <>
          <Text>Signed in as {session.user.email}</Text>
          <Text>Tempo Account {session.accessKey.account}</Text>
          <Button
            onPress={() =>
              run(async () => {
                const { transaction } = await accounts.pay({
                  amount: '0.01',
                  to: '0x000000000000000000000000000000000000dEaD',
                  token: 'ousd',
                })
                return `Sent in ${transaction}.`
              })
            }
            title="Send 0.01 OUSD"
          />
          <Button
            onPress={() => run(async () => (await accounts.signOut(), ''))}
            title="Sign out"
          />
        </>
      ) : (
        <Button
          onPress={() =>
            run(async () => (await accounts.redirect.signIn(), ''))
          }
          title="Sign in with Tempo"
        />
      )}
      <Text>{status}</Text>
    </SafeAreaView>
  )
}
