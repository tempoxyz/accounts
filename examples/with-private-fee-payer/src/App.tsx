import { useRef, useState } from 'react'
import { formatUnits, parseUnits, stringify, type Hex } from 'viem'
import { Actions } from 'viem/tempo'
import {
  useChains,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSendTransactionSync,
  useSwitchChain,
} from 'wagmi'
import { Hooks } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

/** Demonstrates a session-gated private fee payer served from the same worker as WebAuthn. */
export default function App() {
  const { address, chainId, status } = useConnection()

  return (
    <main>
      <h1>Private Fee Payer Example</h1>
      <p>
        This demo keeps the fee payer same-origin with WebAuthn, mints an HttpOnly session cookie on
        register or login, and only sponsors allowlisted contract calls.
      </p>

      <section>
        <h2>Connection</h2>
        <pre>
          {stringify({ address: address ?? null, chainId: chainId ?? null, status }, null, 2)}
        </pre>
      </section>

      <section>
        <h2>Policy</h2>
        <ul>
          <li>The fee payer requires a valid same-origin session cookie.</li>
          <li>The transaction sender must match the session address.</li>
          <li>The demo only sponsors calls to the allowlisted pathUSD token contract.</li>
          <li>Direct value transfers are rejected.</li>
        </ul>
      </section>

      <section>
        <h2>Account</h2>
        <Connect />
      </section>

      <section>
        <h2>Auth Probe</h2>
        <AuthProbe />
      </section>

      {status === 'connected' && (
        <>
          <section>
            <h2>Switch Chain</h2>
            <SwitchChain />
          </section>

          <section>
            <h2>Faucet</h2>
            <Faucet />
          </section>

          <section>
            <h2>Balance</h2>
            <Balance />
          </section>

          <section>
            <h2>Send Sponsored Token Transfer</h2>
            <p>
              This uses <code>Actions.token.transfer.call()</code>, so the transaction target is the
              allowlisted token contract instead of the recipient address below.
            </p>
            <SendTransaction />
          </section>
        </>
      )}
    </main>
  )
}

function Connect() {
  const { mutate: connect, status, error } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { address } = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]
  const nameRef = useRef<HTMLInputElement>(null)

  if (!connector) return null

  return (
    <div>
      {address ? (
        <p>
          <button type="button" onClick={() => disconnect()}>
            Disconnect
          </button>
        </p>
      ) : (
        <>
          <p>
            <label>
              Passkey name{' '}
              <input ref={nameRef} defaultValue="My Wallet" placeholder="Passkey name" required />
            </label>
          </p>
          <p>
            <button type="button" onClick={() => connect({ connector })}>
              Login
            </button>{' '}
            <button
              type="button"
              onClick={() =>
                connect({
                  connector,
                  capabilities: {
                    method: 'register' as const,
                    name: nameRef.current?.value || 'My Wallet',
                  },
                })
              }
            >
              Register
            </button>
          </p>
        </>
      )}
      <p>Status: {status}</p>
      {error && <pre>{error.message}</pre>}
    </div>
  )
}

function AuthProbe() {
  const [result, setResult] = useState<string>()
  const [status, setStatus] = useState<number>()
  const [pending, setPending] = useState(false)

  async function probe() {
    setPending(true)

    try {
      const response = await fetch('/fee-payer', {
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_signRawTransaction',
          params: ['0x00'],
        }),
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      setStatus(response.status)
      setResult(await response.text())
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <p>
        This sends a raw request to <code>/fee-payer</code> with <code>credentials: 'omit'</code>.
        It should return <code>401</code> even after you log in.
      </p>
      <p>
        <button type="button" disabled={pending} onClick={() => void probe()}>
          {pending ? 'Probing...' : 'Probe unauthenticated request'}
        </button>
      </p>
      {status !== undefined && <p>HTTP status: {status}</p>}
      {result && (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            height: '200px',
            overflow: 'auto',
            backgroundColor: '#f0f0f0',
            padding: '1em',
          }}
        >
          {result}
        </pre>
      )}
    </div>
  )
}

function SwitchChain() {
  const { chainId } = useConnection()
  const chains = useChains()
  const { mutate: switchChain } = useSwitchChain()

  return (
    <ul>
      {chains.map((chain) => (
        <li key={chain.id}>
          <button
            type="button"
            disabled={chain.id === chainId}
            onClick={() => switchChain({ chainId: chain.id })}
          >
            {chain.name}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Faucet() {
  const { address } = useConnection()
  const { mutate: fund, isPending, data, error } = Hooks.faucet.useFundSync()

  return (
    <div>
      <p>
        <button
          type="button"
          disabled={isPending || !address}
          onClick={() => fund({ account: address! })}
        >
          {isPending ? 'Funding...' : 'Fund Account'}
        </button>
      </p>
      {data && <p>Funded.</p>}
      {error && <pre>{error.message}</pre>}
    </div>
  )
}

function Balance() {
  const { address } = useConnection()
  const { data, isLoading } = Hooks.token.useGetBalance({
    account: address,
    query: { refetchInterval: 1_000 },
    token: pathUsd,
  })

  return (
    <pre>{isLoading ? 'Loading...' : data !== undefined ? formatUnits(data, 6) : '—'} pathUSD</pre>
  )
}

function SendTransaction() {
  const { mutate: sendTransactionSync, data, error, isPending } = useSendTransactionSync()

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          sendTransactionSync({
            calls: [
              Actions.token.transfer.call({
                amount: parseUnits((form.get('amount') as string) || '0', 6),
                to: form.get('to') as Hex,
                token: pathUsd,
              }),
            ],
          } as never)
        }}
      >
        <p>
          <label>
            Recipient{' '}
            <input
              defaultValue="0x0000000000000000000000000000000000000001"
              name="to"
              placeholder="To (0x...)"
              style={{ width: '350px' }}
            />
          </label>
        </p>
        <p>
          <label>
            Amount <input defaultValue="1" name="amount" placeholder="Amount" />
          </label>
        </p>
        <p>
          <button type="submit" disabled={isPending}>
            {isPending ? 'Sending...' : 'Send'}
          </button>
        </p>
      </form>

      {error && <pre>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && (
        <>
          <p>
            Transaction success.{' '}
            {(data as { feePayer?: string | undefined }).feePayer && (
              <>
                Fees paid by <code>{(data as { feePayer?: string | undefined }).feePayer}</code>.
              </>
            )}
          </p>
          <details>
            <summary>Receipt</summary>
            <pre>{stringify(data, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  )
}
