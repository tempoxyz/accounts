/**
 * A page that signs in with Tempo ID in a dialog, and pays its own metered API in an MPP session,
 * over HTTP, SSE, or a WebSocket. The first payment opens a channel with a deposit, each later
 * payment is an off-chain voucher of the access key, and the close settles the channel on chain.
 * The API, `api.ts`, runs at the page's origin. Its client ID is its origin, so it needs no
 * registration.
 * @module
 */
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { formatUnits } from 'viem'

/**
 * The instance, on Tempo testnet. Each sign-in requests an access key that spends up to 1 OUSD for a
 * day. Without `scopes`, it may open and top up a channel, which a session needs. Each channel
 * holds at most 0.05 OUSD.
 */
const accounts = Accounts.create({
  accessKey: () => ({ expiry: '1d', limits: [{ limit: '1', token: 'ousd' }] }),
  chain: 'testnet',
  plugins: [react(), viem(), mpp({ maxDeposit: '0.05' })],
})

/** The transport of a session. */
type Transport = 'http' | 'sse' | 'ws'

/**
 * Pays for content over `transport` in one session, and closes the session. `onData` receives each
 * fortune or word, with the total that the vouchers authorize, in OUSD. Returns the close's receipt.
 * If a payment fails, the session closes before the error rejects, so the deposit returns.
 */
async function pay(
  transport: Transport,
  onData: (data: string, total: string) => void,
) {
  const session = accounts.mpp.session()
  const emit = (data: string) =>
    onData(data, formatUnits(session.cumulative, 6))

  try {
    if (transport === 'http')
      for (let index = 0; index < 5; index++) {
        const response = await session.fetch(
          new URL('/v1/fortune', location.origin),
        )
        if (!response.ok)
          throw new Error(`The API failed with ${response.status}.`)
        emit(((await response.json()) as { fortune: string }).fortune)
      }

    if (transport === 'sse')
      for await (const word of await session.sse(
        new URL('/v1/stream', location.origin),
      ))
        emit(word)

    if (transport === 'ws') {
      const socket = await session.ws(
        new URL('/v1/socket', location.origin.replace(/^http/, 'ws')),
      )
      // The socket closes with 1000 after the stream's final receipt, and with another code for a
      // failure, such as a refused voucher.
      await new Promise<void>((resolve, reject) => {
        socket.on('message', (event) => emit(event.data))
        socket.on('close', (event) => {
          if (event.code === 1000) return resolve()
          reject(
            new Error(event.reason || `The socket closed with ${event.code}.`),
          )
        })
      })
    }
  } catch (error) {
    // The payment's error stays the one shown, also if the close fails.
    await session.close().catch(() => undefined)
    throw error
  }

  return session.close()
}

function App() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [log, setLog] = React.useState<readonly string[]>([])
  // One payment runs at a time, so a second click opens no second channel.
  const [paying, setPaying] = React.useState(false)
  const [status, setStatus] = React.useState<string>()
  const [total, setTotal] = React.useState('0')

  /** Runs `fn`, and shows its result or its error. */
  function run(fn: () => Promise<string>) {
    setStatus('…')
    // The status shows the failure, so the promise never rejects.
    void fn().then(setStatus, (error: Error) => setStatus(error.message))
  }

  /** Pays over `transport`, and shows each fortune or word and the running total. */
  function start(transport: Transport) {
    setLog([])
    setPaying(true)
    setTotal('0')
    run(async () => {
      const receipt = await pay(transport, (data, total) => {
        setLog((log) => [...log, data])
        setTotal(total)
      }).finally(() => setPaying(false))
      return `Closed the channel in ${receipt?.txHash}. It settled ${formatUnits(BigInt(receipt?.spent ?? 0), 6)} OUSD.`
    })
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
      <p>
        <button
          disabled={isReauthorizing || paying}
          onClick={() => start('http')}
          type="button"
        >
          5 calls (HTTP)
        </button>
        <button
          disabled={isReauthorizing || paying}
          onClick={() => start('sse')}
          type="button"
        >
          Stream (SSE)
        </button>
        <button
          disabled={isReauthorizing || paying}
          onClick={() => start('ws')}
          type="button"
        >
          Stream (WebSocket)
        </button>
      </p>
      <p aria-live="polite">Authorized {total} OUSD</p>
      <p>{log.join(' ')}</p>
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
