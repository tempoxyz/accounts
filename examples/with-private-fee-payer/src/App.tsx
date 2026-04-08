import * as React from 'react'
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
    <div>
      <h1>Private Fee Payer Example</h1>
      <p>
        This demo keeps the fee payer same-origin with WebAuthn, mints an HttpOnly session cookie on
        register or login, and only sponsors allowlisted contract calls.
      </p>

      <h2>Connection</h2>
      <CodeBlock>
        {stringify({ address: address ?? null, chainId: chainId ?? null, status }, null, 2)}
      </CodeBlock>

      <h2>Policy</h2>
      <ul>
        <li>The fee payer requires a valid same-origin session cookie.</li>
        <li>The transaction sender must match the session address.</li>
        <li>The demo only sponsors calls to the allowlisted pathUsd token contract.</li>
        <li>Direct value transfers are rejected.</li>
      </ul>

      <h2>Account</h2>
      <Connect />

      <h2>Auth Probe</h2>
      <AuthProbe />

      {status === 'connected' && (
        <>
          <h2>Switch Chain</h2>
          <SwitchChain />

          <h2>Faucet</h2>
          <Faucet />

          <h2>Balance</h2>
          <Balance />

          <h2>Send Transaction</h2>
          <p>
            This uses <InlineCode>Actions.token.transfer.call()</InlineCode>, so the transaction
            target is the allowlisted token contract instead of the recipient address below.
          </p>
          <SendTransaction />
        </>
      )}
    </div>
  )
}

function InlineCode(props: { children: React.ReactNode }) {
  return (
    <code
      style={{
        backgroundColor: '#eee',
        fontSize: '0.95em',
        padding: '0.2em 0.4em',
        borderRadius: '4px',
      }}
      {...props}
    />
  )
}

function CodeBlock(props: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        backgroundColor: '#eee',
        fontSize: '0.95em',
        padding: '1em',
        borderRadius: '4px',
        overflowX: 'auto',
      }}
      {...props}
    />
  )
}

function Connect() {
  const { mutate: connect, status, error } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { address } = useConnection()
  const [connector] = useConnectors()
  const nameRef = React.useRef<HTMLInputElement>(null)

  if (!connector) return null

  return (
    <div>
      {address ? (
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      ) : (
        <div>
          <input ref={nameRef} defaultValue="My Wallet" placeholder="Passkey name" required />{' '}
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
        </div>
      )}
      <div>{status}</div>
      {error && <CodeBlock>{error.message}</CodeBlock>}
    </div>
  )
}

function AuthProbe() {
  const [result, setResult] = React.useState<string>()
  const [status, setStatus] = React.useState<number>()
  const [pending, setPending] = React.useState(false)

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
      const text = await response.text()
      try {
        setResult(JSON.stringify(JSON.parse(text), null, 2))
      } catch {
        setResult(text)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <p>
        This sends a raw request to <InlineCode>/fee-payer</InlineCode> with{' '}
        <InlineCode>credentials: 'omit'</InlineCode>. It should return <InlineCode>401</InlineCode>{' '}
        even after you log in.
      </p>
      <p>
        <button type="button" disabled={pending} onClick={() => void probe()}>
          {pending ? 'Probing...' : 'Probe unauthenticated request'}
        </button>
      </p>
      {status !== undefined && <p>HTTP status: {status}</p>}
      {result && <CodeBlock>{result}</CodeBlock>}
    </div>
  )
}

function SwitchChain() {
  const { chainId } = useConnection()
  const chains = useChains()
  const { mutate: switchChain } = useSwitchChain()

  return (
    <div>
      {chains.map((chain) => (
        <button
          key={chain.id}
          type="button"
          disabled={chain.id === chainId}
          onClick={() => switchChain({ chainId: chain.id })}
        >
          {chain.name}
        </button>
      ))}
    </div>
  )
}

function Faucet() {
  const { address } = useConnection()
  const { mutate: fund, isPending, data, error } = Hooks.faucet.useFundSync()

  return (
    <div>
      <button
        type="button"
        disabled={isPending || !address}
        onClick={() => {
          if (!address) return
          fund({ account: address })
        }}
      >
        {isPending ? 'Funding...' : 'Fund Account'}
      </button>
      {data && <p>✅ Funded!</p>}
      {error && <CodeBlock>{error.message}</CodeBlock>}
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
    <div>{isLoading ? 'Loading...' : data !== undefined ? formatUnits(data, 6) : '—'} pathUsd</div>
  )
}

function SendTransaction() {
  const { mutate: sendTransactionSync, data, error, isPending } = useSendTransactionSync()
  const feePayer = (data as { feePayer?: string | undefined } | undefined)?.feePayer

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
        <input
          defaultValue="0x0000000000000000000000000000000000000001"
          name="to"
          placeholder="To (0x...)"
          size={42}
        />{' '}
        <input defaultValue="1" name="amount" placeholder="Amount" size={6} />{' '}
        <button type="submit" disabled={isPending}>
          Send
        </button>
      </form>

      {error && <CodeBlock>{`${error.name}: ${error.message}`}</CodeBlock>}
      {data !== undefined && (
        <>
          <p>
            ✅ Transaction success!
            {feePayer && (
              <>
                {' '}
                Fees paid by: <InlineCode>{feePayer}</InlineCode>
              </>
            )}
          </p>
          <details>
            <summary>Receipt</summary>
            <CodeBlock>{stringify(data, null, 2)}</CodeBlock>
          </details>
        </>
      )}
    </div>
  )
}
