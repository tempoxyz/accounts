/**
 * A page that signs in with Tempo ID in a dialog, and pays the merchant's MPP charges once each with
 * the access key of the sign-in. The access key may spend 1 OUSD a day, so it pays the fortune of
 * 0.01 OUSD, and cannot pay the report of 5 OUSD. Its client ID is its origin, so it needs no
 * registration.
 * @module
 */
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

/** The instance, on Tempo testnet. Each sign-in requests an access key that spends up to 1 OUSD for a day. */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [mpp(), react(), viem()],
})

/**
 * The payer of the merchant's charges. `maxAmount` refuses a charge above 5 OUSD before the access
 * key signs. It covers the report, so the access key's limit of 1 OUSD, not `maxAmount`, refuses it.
 */
const payer = accounts.mpp({ maxAmount: '5' })

function App() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [status, setStatus] = React.useState<string>()

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  /** Pays the charge of `path` once, and returns the content or the endpoint's refusal. */
  async function buy(path: string) {
    const response = await payer.fetch(path)
    if (!response.ok)
      return `The merchant refused the payment (${response.status}).`
    return JSON.stringify(await response.json())
  }

  if (isPending) return <p>Checking your Tempo session…</p>

  if (!session)
    return (
      <main>
        <button
          onClick={() => run(async () => (await accounts.dialog.signIn(), ''))}
          type="button"
        >
          Sign in with Tempo
        </button>
        <p role="status">{status}</p>
      </main>
    )

  const account = session.accessKey?.account
  return (
    <main>
      <p>Signed in as {session.user.email}</p>
      {/* The expired access key signs nothing until the authorization renews it. */}
      {isReauthorizing ? (
        <p aria-live="polite">Renewing your access key…</p>
      ) : null}
      <p>Tempo Account {account}</p>
      <button
        disabled={isReauthorizing}
        onClick={() =>
          run(async () => {
            await accounts.faucet.fundSync({ account: account! })
            return 'Funded with testnet tokens.'
          })
        }
        type="button"
      >
        Get testnet funds
      </button>
      <button
        disabled={isReauthorizing}
        onClick={() => run(() => buy('/v1/fortune'))}
        type="button"
      >
        Buy a fortune (0.01 OUSD)
      </button>
      <button
        disabled={isReauthorizing}
        onClick={() => run(() => buy('/v1/report'))}
        type="button"
      >
        Buy the report (5 OUSD, above the limit)
      </button>
      <button
        onClick={() => run(async () => (await accounts.signOut(), ''))}
        type="button"
      >
        Sign out
      </button>
      <p role="status">{status}</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
