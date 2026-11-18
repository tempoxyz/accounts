/**
 * The oracle of `react` × `transfer`: the starter's page, with a dialog sign-in and a transfer
 * with the access key.
 * @module
 */
import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { http, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: tempoLocalnet.id,
  plugins: [
    react(),
    viem({ chain: tempoLocalnet, transport: http('http://localhost:9545/1') }),
  ],
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
          const { receipt } = await accounts.token.transferSync({
            amount: parseUnits('1', 6),
            to: '0x000000000000000000000000000000000000dEaD',
            token: Addresses.ousd,
          })
          setStatus(receipt.transactionHash)
        }}
      >
        Send 1 OUSD
      </button>
      <p>{status}</p>
    </main>
  )
}
