/**
 * A page that subscribes to the merchant in `api.ts` with MPP, and lists the merchant's charges. The
 * Worker holds the user's session, and the page holds only its `HttpOnly` cookie, so the page has no
 * session of its own. It pays the subscription for the Tempo Account that the Worker names. The user
 * approves the merchant's access key once, and the merchant charges each period without the page.
 * The page's client ID is its origin, so it needs no registration.
 * @module
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { Receipt } from 'mppx'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

/** A charge of the subscription, as the merchant lists it. */
type Charge = {
  /** The transaction hash of the charge. */
  reference: string
  /** When the charge settled. */
  timestamp: string
}

/** The charges of the user, as the merchant lists them. */
type Charges = {
  /** Whether the user's paid subscription has not expired. */
  active: boolean
  /** The charges of every subscription of the user, oldest first. */
  charges: Charge[]
}

/** The user of the Worker's session. */
type Me = {
  /** The Tempo Account on the session's chain, which pays the subscription. */
  account: `0x${string}`
}

/**
 * The instance, on Tempo testnet, which only opens Tempo ID's dialog for the subscription. It holds
 * no session. Each period may charge at most 1 pathUSD.
 */
const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [mpp({ maxAmount: '1' })],
})

/**
 * Sends a request to the merchant at `path`, with the session's cookie, and returns `undefined` once
 * the session ended.
 */
async function call(path: string) {
  const response = await fetch(path)
  if (response.status === 401) return undefined
  if (!response.ok)
    throw new Error(`The merchant failed with ${response.status}.`)
  return response
}

function App() {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<string>()

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  const me = useQuery({
    queryFn: async () => {
      const response = await call('/v1/me')
      return response ? ((await response.json()) as Me) : null
    },
    queryKey: ['me'],
  })
  // The merchant charges without the page, so the page reads the charges each minute.
  const charges = useQuery({
    enabled: Boolean(me.data),
    queryFn: async () => {
      const response = await call('/v1/charges')
      if (!response) return { active: false, charges: [] }
      return (await response.json()) as Charges
    },
    queryKey: ['charges'],
    refetchInterval: 60_000,
  })
  const list = charges.data?.charges ?? []

  if (me.isPending) return <p>Checking your session…</p>

  if (!me.data)
    return (
      <main>
        <a href="/login">Sign in with Tempo</a>
      </main>
    )

  const { account } = me.data
  return (
    <main>
      <p>Tempo Account {account}</p>
      <button
        // An expired subscription lets the user subscribe again.
        disabled={charges.data?.active ?? true}
        onClick={() =>
          run(async () => {
            // A 402 opens Tempo ID's dialog, and the retry carries the credential and the cookie.
            const response = await accounts
              .mpp({ account })
              .fetch(new URL('/v1/subscription', location.origin))
            if (!response.ok)
              throw new Error(`The merchant failed with ${response.status}.`)
            const receipt = Receipt.fromResponse(response)
            queryClient.setQueryData(
              ['charges'],
              (await response.json()) as Charges,
            )
            return `Subscribed: ${receipt.reference}`
          })
        }
        type="button"
      >
        Subscribe for 1 pathUSD every 30 days
      </button>
      <h2>Charges</h2>
      <ul>
        {list.map((charge) => (
          <li key={charge.reference}>
            {new Date(charge.timestamp).toLocaleString()}: {charge.reference}
          </li>
        ))}
      </ul>
      <form action="/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
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
