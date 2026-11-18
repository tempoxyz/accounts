/**
 * The oracle of `react` × `pay`: the starter's page, with a dialog sign-in whose access key names the
 * Tempo Account, and a payment that the user approves on Tempo ID's payment page. Without the `viem`
 * plugin, no access key sends the payment.
 * @module
 */
import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { tempoLocalnet } from 'viem/tempo/chains'

const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'ousd' }],
  }),
  chain: tempoLocalnet.id,
  plugins: [react()],
  url: 'http://localhost:8787',
})

export function App() {
  const { session } = accounts.useSession()
  const [status, setStatus] = useState('')
  if (!session)
    return <button onClick={() => accounts.dialog.signIn()}>Sign in</button>
  return (
    <main>
      <p>{session.user.email}</p>
      <p>{session.accessKey?.account}</p>
      <button
        onClick={async () => {
          const { transaction } = await accounts.pay({
            amount: '5',
            to: '0x000000000000000000000000000000000000dEaD',
            token: 'ousd',
          })
          setStatus(transaction)
        }}
      >
        Pay 5 OUSD
      </button>
      <p>{status}</p>
    </main>
  )
}
