/**
 * A page that signs in with Tempo ID in a dialog, and calls its own API with a session cookie, such
 * as to pay 1 OUSD. The dialog runs the sign-in through the Worker's routes, `api.ts`, which keep
 * the tokens and set the cookie, so the page holds no token. Its client ID is its origin, so it
 * needs no registration.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

/** The instance. Its dialog calls the sign-in routes under `/api`, which `api.ts` serves. */
const accounts = Accounts.create({
  plugins: [dialog({ backend: true })],
})

/** The session that the page reads: the user and the Tempo Account, without tokens. */
type Session = Awaited<ReturnType<typeof accounts.dialog.signIn>>

/**
 * Calls the API at `path`, whose request carries the session cookie, and returns its JSON body. A
 * 401 means the session ended.
 */
async function call<data>(path: string, init?: RequestInit): Promise<data> {
  const response = await fetch(path, init)
  if (response.status === 401)
    throw new Error('Your session ended. Sign in again.')
  if (!response.ok) throw new Error(`The API failed with ${response.status}.`)
  return response.json() as Promise<data>
}

function App() {
  // `undefined` while the page reads the session, and `null` without one.
  const [session, setSession] = React.useState<Session | null>()
  const [notes, setNotes] = React.useState<readonly string[]>([])
  const [status, setStatus] = React.useState<string>()

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string | undefined>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  // The cookie can hold a session from an earlier visit.
  React.useEffect(() => {
    void call<{ session: Session | null }>('/api/auth/session').then(
      (body) => setSession(body.session),
      () => setSession(null),
    )
  }, [])

  // Each sign-in loads the user's notes from the API.
  const userId = session?.user.id
  React.useEffect(() => {
    if (!userId) return setNotes([])
    run(async () => {
      const body = await call<{ notes: string[] }>('/v1/notes')
      setNotes(body.notes)
      return undefined
    })
  }, [userId])

  if (session === undefined) return <p>Checking your session…</p>

  if (!session)
    return (
      <main>
        <button
          onClick={() =>
            run(async () => {
              setSession(await accounts.dialog.signIn())
              return undefined
            })
          }
          type="button"
        >
          Sign in with Tempo
        </button>
        <p role="status">{status}</p>
      </main>
    )

  return (
    <main>
      <p>Signed in as {session.user.email}</p>
      <button
        onClick={() =>
          run(async () => {
            const me = await call<{ userId: string }>('/v1/me')
            return `The API read the session of ${me.userId}.`
          })
        }
        type="button"
      >
        Ask the API who I am
      </button>
      <button
        onClick={() =>
          run(async () => {
            const body = await call<{ transaction: string }>('/v1/pay', {
              method: 'POST',
            })
            return `Sent in ${body.transaction}.`
          })
        }
        type="button"
      >
        Send 1 OUSD
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const text = String(new FormData(form).get('text'))
          run(async () => {
            const body = await call<{ notes: string[] }>('/v1/notes', {
              body: JSON.stringify({ text }),
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            })
            setNotes(body.notes)
            form.reset()
            return undefined
          })
        }}
      >
        <input aria-label="Note" name="text" placeholder="A note" required />
        <button type="submit">Save note</button>
      </form>
      <ul>
        {notes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
      <button
        onClick={() =>
          run(async () => {
            await fetch('/api/auth/logout', { method: 'POST' })
            setSession(null)
            return undefined
          })
        }
        type="button"
      >
        Sign out
      </button>
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
