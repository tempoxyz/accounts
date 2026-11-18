/**
 * A page that pays and signs in with one click. The `siwe` plugin names the Worker's routes in
 * `api.ts`: at the click, the dialog opens and the page requests the message while Tempo ID's page
 * loads. The Tempo Account pays and signs the message on one screen, and the page posts the
 * signature to the Worker, which returns a token for the page's later requests.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog, siwe } from 'accounts/plugins'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

/** The instance. Its chain is the Worker's, Tempo testnet, which verifies each signature. */
const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [dialog(), siwe({ auth: '/api/auth/siwe' })],
})

/** The account that receives each payment. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/** The key of the token in `sessionStorage`, so a reload keeps the sign-in. */
const tokenKey = 'example-siwe-pay:token'

/** Calls the Worker at `path` with the token, and returns its JSON body. */
async function call<data>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<data> {
  const response = await fetch(path, {
    ...init,
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status === 401)
    throw new Error('Your session ended. Sign in again.')
  if (response.status === 204) return undefined as data
  return (await response.json()) as data
}

function App() {
  const [token, setToken] = React.useState(
    () => sessionStorage.getItem(tokenKey) ?? undefined,
  )
  const [status, setStatus] = React.useState<string>()

  /** Keeps the Worker's token, or forgets it. The page never logs it. */
  function keep(value: string | undefined) {
    if (value) sessionStorage.setItem(tokenKey, value)
    else sessionStorage.removeItem(tokenKey)
    setToken(value)
  }

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string | undefined>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  return (
    <main>
      {token ? (
        <p>Signed in.</p>
      ) : (
        <button
          onClick={() =>
            run(async () => {
              // The dialog opens within the click, before any `await`.
              const { auth } = await accounts.dialog.signIn({
                accessKey: false,
              })
              keep(auth?.token)
              return undefined
            })
          }
          type="button"
        >
          Sign in
        </button>
      )}
      <button
        onClick={() =>
          run(async () => {
            // Without `account`, and without a session, the payment also signs the user in.
            const { auth, authError, transaction } = await accounts.pay({
              amount: '1',
              to: recipient,
              token: 'ousd',
            })
            if (auth?.token) keep(auth.token)
            // The transfer landed, so only the sign-in failed. The user signs in again.
            if (authError)
              return `Paid in ${transaction}, but the sign-in failed: ${(authError as Error).message}`
            return `Paid in ${transaction}.`
          })
        }
        type="button"
      >
        Pay 1 OUSD
      </button>
      {token && (
        <>
          <button
            onClick={() =>
              run(async () => {
                const { account } = await call<{ account: string }>(
                  '/v1/account',
                  token,
                )
                return `The Worker reads the session of ${account}.`
              })
            }
            type="button"
          >
            Read the account
          </button>
          <button
            onClick={() =>
              run(async () => {
                // The Worker ends the token's session, and the instance its Tempo ID session, so the
                // next payment signs the user in again.
                await call('/api/auth/logout', token, { method: 'POST' })
                await accounts.signOut()
                keep(undefined)
                return undefined
              })
            }
            type="button"
          >
            Sign out
          </button>
        </>
      )}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
