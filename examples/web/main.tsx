/**
 * A page that signs in with Tempo ID in a dialog, and sends OUSD with the access key of the sign-in.
 * Its client ID is its origin, so it needs no registration.
 * @module
 */
import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

/**
 * The instance, on Tempo testnet. Each sign-in requests an access key that sends up to 100 OUSD for
 * a day.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react(), viem()],
})

function App() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [status, setStatus] = React.useState<string>()

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
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
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          run(async () => {
            const { transaction } = await accounts.pay({
              amount: String(form.get('amount')),
              to: String(form.get('to')) as `0x${string}`,
              token: 'ousd',
            })
            return `Sent in ${transaction}.`
          })
        }}
      >
        <input aria-label="Recipient" name="to" placeholder="0x…" required />
        <input aria-label="Amount" name="amount" placeholder="1.00" required />
        <button disabled={isReauthorizing} type="submit">
          Send OUSD
        </button>
      </form>
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
