/**
 * A page that signs in with a SIWE message that its Worker, `api.ts`, issues, and calls the Worker's
 * API with a session cookie. The user's Tempo Account signs each message in Tempo ID's dialog: the
 * sign-in's, and the approval that a deletion of the notes needs. The page holds no token.
 * @module
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

/**
 * The instance. Its dialog signs the Worker's messages, and the Worker's `/api` routes keep the
 * session. Its chain is the Worker's, Tempo testnet, which verifies each signature.
 */
const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [dialog({ backend: true })],
})

/** The session that the page reads: the account that signed in. */
type Session = { account: `0x${string}`; method: 'siwe' }

/**
 * Calls the Worker at `path` with a JSON `body`, whose request carries the session cookie, and returns
 * its JSON body. A 401 means the session ended.
 */
async function call<data>(path: string, body?: unknown): Promise<data> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
  )
  if (response.status === 401)
    throw new Error('Your session ended. Sign in again.')
  const data = (await response.json()) as data & {
    error_description?: string
  }
  if (!response.ok) throw new Error(data.error_description ?? `${path} failed.`)
  return data
}

/** Deletes every note, after the account signs the Worker's approval of the deletion. */
async function clear() {
  // The dialog opens on the click, and requests the message after it opens, so a popup opens too.
  const { message, signature } = await accounts.dialog.signMessage({
    message: async () =>
      (await call<{ message: string }>('/v1/notes/clear/challenge', {}))
        .message,
  })
  return call<{ notes: string[] }>('/v1/notes/clear', { message, signature })
}

function App() {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<string>()

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string | undefined>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  // The cookie can hold a session from an earlier visit.
  const session = useQuery({
    queryFn: async () =>
      (await call<{ session: Session | null }>('/api/auth/session')).session,
    queryKey: ['session'],
  })
  const account = session.data?.account
  const notes = useQuery({
    enabled: Boolean(account),
    queryFn: async () => (await call<{ notes: string[] }>('/v1/notes')).notes,
    queryKey: ['notes', account],
  })

  /** Replaces the account's notes with the response of a write, after a read in flight ends. */
  async function setNotes(data: readonly string[]) {
    await queryClient.cancelQueries({ queryKey: ['notes', account] })
    queryClient.setQueryData(['notes', account], data)
  }

  if (session.isPending) return <p>Checking your session…</p>

  if (!session.data)
    return (
      <main>
        <button
          onClick={() =>
            run(async () => {
              // The dialog requests the Worker's message, the account signs it, and the Worker
              // verifies it and sets the session cookie.
              queryClient.setQueryData(
                ['session'],
                await accounts.dialog.signIn({ method: 'siwe' }),
              )
              return undefined
            })
          }
          type="button"
        >
          Sign in with Ethereum
        </button>
        <p role="status">{status}</p>
      </main>
    )

  return (
    <main>
      <p>Signed in as {session.data.account}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const text = String(new FormData(form).get('text'))
          run(async () => {
            const body = await call<{ notes: string[] }>('/v1/notes', { text })
            await setNotes(body.notes)
            form.reset()
            return undefined
          })
        }}
      >
        <input aria-label="Note" name="text" placeholder="A note" required />
        <button type="submit">Save note</button>
      </form>
      <ul>
        {(notes.data ?? []).map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
      <button
        onClick={() =>
          run(async () => {
            await setNotes((await clear()).notes)
            return 'Your account approved the deletion.'
          })
        }
        type="button"
      >
        Delete every note
      </button>
      <button
        onClick={() =>
          run(async () => {
            await fetch('/api/auth/logout', { method: 'POST' })
            queryClient.setQueryData(['session'], null)
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
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
