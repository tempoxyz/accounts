/**
 * The shared part of the backend test app's pages: the options of each page's instance, and the
 * page's controls. Each control runs one action, and shows its outcome as JSON, so a spec starts an
 * action with a click and reads what it returned or threw. With `send`, the page shows the
 * "Send OUSD" form. With `fields`, the page shows one input for each label.
 *
 * The build reads Tempo ID's URL from `VITE_TEMPO_ID_URL`, which `test/Apps.ts` sets.
 * @module
 */
import type { Accounts } from 'accounts'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { tempoLocalnet } from 'viem/tempo/chains'

/**
 * One action of a page: the name of its control, and the call, whose result the page shows. The call
 * receives the values of the page's fields, by label.
 */
export type Actions = Readonly<
  Record<string, (fields: Fields) => Promise<unknown>>
>

/** The values of a page's fields, by label. */
export type Fields = Readonly<Record<string, string>>

/** The outcome of an action: `pending` while it runs, then what it returned or threw. */
type Outcome = {
  /** Whether the action runs, returned, or threw. */
  state: 'fulfilled' | 'pending' | 'rejected'
  /** The result, or the error's fields, as JSON. Empty while the action runs. */
  text: string
}

/** A transfer of the "Send OUSD" form. */
export type Transfer = {
  /** The OUSD to send, as a decimal string. */
  amount: string
  /** The recipient. */
  to: `0x${string}`
}

/** The page's query, which sets the options that a spec varies. */
export const query = new URLSearchParams(window.location.search)

/** The options that each page's instance shares: the suite's node, and Tempo ID. */
export const options = {
  chain: tempoLocalnet.id,
  url: import.meta.env.VITE_TEMPO_ID_URL as string,
} satisfies Partial<Accounts.create.Options>

/**
 * Sends a request to the app's backend with the browser's cookies, and returns the response's
 * status and JSON body.
 */
export async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'same-origin' })
  const text = await response.text()
  return { body: text ? JSON.parse(text) : null, status: response.status }
}

/** Sends a JSON body to the app's backend, as {@link call} does. */
export function post(path: string, body: unknown = {}) {
  return call(path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

/**
 * Returns the cookies that the page's scripts read, and whether any value that they read holds a
 * token: a cookie, a value of the web storage, or a record of an IndexedDB database of the origin.
 * A token of Tempo ID is a JWT, whose text starts with `eyJ`.
 */
export async function storage() {
  const databases = await indexedDB.databases()
  const records = await Promise.all(
    databases.map((database) => read(database.name!)),
  )
  // A record holds amounts as `bigint` values, which JSON has no form for.
  const values = JSON.stringify(
    {
      cookie: document.cookie,
      local: { ...localStorage },
      records,
      session: { ...sessionStorage },
    },
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
  )
  return { cookie: document.cookie, holdsToken: values.includes('eyJ') }
}

/** Returns each key and each value of each object store of the IndexedDB database `name`. */
async function read(name: string) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const names = [...database.objectStoreNames]

  try {
    return await Promise.all(
      names.map(
        (name) =>
          new Promise<unknown>((resolve, reject) => {
            const transaction = database.transaction(name, 'readonly')
            const keys = transaction.objectStore(name).getAllKeys()
            const values = transaction.objectStore(name).getAll()
            transaction.oncomplete = () =>
              resolve({ keys: keys.result, name, values: values.result })
            transaction.onabort = () => reject(transaction.error)
          }),
      ),
    )
  } finally {
    database.close()
  }
}

/** Renders the page: its status, its controls, and the "Send OUSD" form. */
export function mount(options: mount.Options) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App {...options} />
    </React.StrictMode>,
  )
}

export declare namespace mount {
  type Options = {
    /** The actions of the page's controls, by label. */
    actions: Actions
    /** The labels of the page's fields, whose values each action receives. Defaults to none. */
    fields?: readonly string[] | undefined
    /** Sends a transfer of the "Send OUSD" form. Absent, the page shows no form. */
    send?: ((transfer: Transfer) => Promise<unknown>) | undefined
    /** Returns what the page shows of a session that the page holds. Absent, it shows none. */
    useStatus?: (() => Status) | undefined
  }
}

/** What a page shows of a session that it holds. */
export type Status = {
  /** The account of the session's access key. */
  account?: string | undefined
  /** The user's email address. */
  email?: string | undefined
  /** The session's status. */
  status: string
}

/** Returns the status of a page that holds no session. */
function useNone(): Status {
  return { status: 'none' }
}

function App(props: mount.Options) {
  const { actions, fields = [], send, useStatus = useNone } = props
  const form = React.useRef<HTMLFormElement>(null)
  const { account, email, status } = useStatus()
  const [outcomes, setOutcomes] = React.useState<
    Readonly<Record<string, Outcome>>
  >({})

  /** Runs `fn`, and shows what it returns or throws under `name`. */
  function run(name: string, fn: () => Promise<unknown>) {
    const settle = (outcome: Outcome) =>
      setOutcomes((outcomes) => ({ ...outcomes, [name]: outcome }))
    settle({ state: 'pending', text: '' })
    // The outcome shows the failure, so the promise never rejects.
    void Promise.resolve()
      .then(fn)
      .then(
        (value) =>
          settle({ state: 'fulfilled', text: JSON.stringify(value ?? null) }),
        (error: unknown) =>
          settle({ state: 'rejected', text: JSON.stringify(failure(error)) }),
      )
  }

  return (
    <main>
      <p>
        Status <span id="status">{status}</span>
      </p>
      {email && (
        <p>
          Signed in as <span id="email">{email}</span>
        </p>
      )}
      {account && (
        <p>
          Tempo Account <span id="account">{account}</span>
        </p>
      )}
      {send && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            run('Send OUSD', () =>
              send({
                amount: String(form.get('amount')),
                to: String(form.get('to')) as `0x${string}`,
              }),
            )
          }}
        >
          <input aria-label="Recipient" name="to" required />
          <input aria-label="Amount" name="amount" required />
          <button type="submit">Send OUSD</button>
          <Result name="Send OUSD" outcome={outcomes['Send OUSD']} />
        </form>
      )}
      <form ref={form}>
        {fields.map((label) => (
          <input aria-label={label} key={label} name={label} />
        ))}
      </form>
      <ul>
        {Object.entries(actions).map(([name, fn]) => (
          <li key={name}>
            <button
              onClick={() =>
                run(name, () =>
                  fn(
                    Object.fromEntries(
                      [...new FormData(form.current!)].map(([label, value]) => [
                        label,
                        String(value),
                      ]),
                    ),
                  ),
                )
              }
              type="button"
            >
              {name}
            </button>
            <Result name={name} outcome={outcomes[name]} />
          </li>
        ))}
      </ul>
    </main>
  )
}

function Result(props: Result.Props) {
  const { name, outcome } = props
  return (
    <output data-action={name} data-state={outcome?.state ?? 'idle'}>
      {outcome?.text}
    </output>
  )
}

declare namespace Result {
  type Props = {
    /** The action's name. */
    name: string
    /** The action's outcome, or `undefined` before its first run. */
    outcome: Outcome | undefined
  }
}

/** Returns the fields of `error` that a spec asserts: its name and message, and a refusal's fields. */
function failure(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error), name: null }
  const refusal = error as Error & {
    code?: string | undefined
    reason?: string | undefined
    signedIn?: boolean | undefined
    status?: number | undefined
  }
  return {
    code: refusal.code ?? null,
    message: error.message,
    name: error.name,
    reason: refusal.reason ?? null,
    // Only a refusal after the sign-in has `signedIn`, so other refusals keep their shape.
    ...(refusal.signedIn ? { signedIn: true } : {}),
    status: refusal.status ?? null,
  }
}
