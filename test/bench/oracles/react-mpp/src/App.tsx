/**
 * The oracle of `react` × `mpp`: the starter's page, with a dialog sign-in and a button that pays
 * the merchant's charge.
 * @module
 */
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { http } from 'viem'
import { tempoLocalnet } from 'viem/tempo/chains'

const accounts = Accounts.create({
  accessKey: () => ({ expiry: '1d', limits: [{ limit: '1', token: 'ousd' }] }),
  chain: tempoLocalnet.id,
  plugins: [
    viem({ chain: tempoLocalnet, transport: http('http://localhost:9545/1') }),
    mpp(),
    react(),
  ],
  url: 'http://localhost:8787',
})

export function App() {
  const { session } = accounts.useSession()
  const [body, setBody] = useState('')
  if (!session)
    return <button onClick={() => accounts.dialog.signIn()}>Sign in</button>
  return (
    <main>
      <p>{session.user.email}</p>
      <p>{session.accessKey?.account}</p>
      <button
        onClick={async () => {
          const response = await accounts.fetch('http://localhost:5393/charge')
          setBody(await response.text())
        }}
      >
        Buy a fortune
      </button>
      <pre>{body}</pre>
    </main>
  )
}
