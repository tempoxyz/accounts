import { Hex, Json } from 'ox'
import * as React from 'react'
import { useState } from 'react'
import { formatUnits, parseUnits, stringify } from 'viem'
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
    <div
      style={{
        fontFamily: 'SF-Pro, -apple-system, BlinkMacSystemFont, sans-serif',
        minHeight: '100vh',
        paddingTop: '5px',
        paddingBottom: '25px',
        paddingLeft: 'max(10vw, 1em)',
        paddingRight: 'max(10vw, 1em)',
        backgroundColor: '#fff',
      }}
    >
      <h1>Private Fee Payer Example</h1>
      <p>
        this demo keeps the fee payer <InlineCode>same-origin</InlineCode> with WebAuthn,
        <br />
        mints an
        <InlineCode>HttpOnly</InlineCode> session cookie on register or login, and only sponsors
        allowlisted contract calls.
      </p>

      <h3>Connection</h3>
      <CodeBlock>
        {stringify({ address: address ?? null, chainId: chainId ?? null, status }, null, 2)}
      </CodeBlock>

      <h3>Policy</h3>
      <ul>
        <li>
          The fee payer requires a valid <InlineCode>same-origin</InlineCode> session cookie.
        </li>
        <li>The transaction sender must match the session address.</li>
        <li>
          The demo only sponsors calls to the allowlisted <InlineCode>pathUSD</InlineCode> token
          contract.
        </li>
        <li>Direct value transfers are rejected.</li>
      </ul>

      <h3>Account</h3>
      <Connect />

      <h3>Auth Probe</h3>
      <AuthProbe />

      {status === 'connected' && (
        <>
          <h3>Switch Chain</h3>
          <SwitchChain />

          <h3>Faucet</h3>
          <Faucet />

          <h3>Balance</h3>
          <Balance />

          <h3>Send Transaction</h3>
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
        fontWeight: '500',
        backgroundColor: '#f9f9f9',
        padding: '0.2em 0.4em',
      }}
      {...props}
    />
  )
}

function CodeBlock(props: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        fontWeight: '500',
        backgroundColor: '#f9f9f9',
        padding: '0.5em',
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
          <input
            ref={nameRef}
            defaultValue="private-fee-payer-demo"
            placeholder="Passkey name"
            required
          />{' '}
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
                  name: nameRef.current?.value || 'private-fee-payer-demo',
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
  const { address, chainId } = useConnection()
  const [connector] = useConnectors()
  const [result, setResult] = useState<string>()
  const [status, setStatus] = useState<number>()
  const [pending, setPending] = useState(false)

  async function probe(form: FormData) {
    if (!address || !connector) return

    setPending(true)

    try {
      const call = getTransferCall(form)
      const provider = await connector.getProvider()
      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [
          {
            ...(chainId ? { chainId } : {}),
            calls: [call],
            from: address,
          },
        ],
      } as never)
      const response = await fetch('/fee-payer/probe', {
        body: Json.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_signRawTransaction',
          params: [signed],
        }),
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      const text = await response.text()
      try {
        const data = Json.parse(text) as { status?: number | undefined }
        setStatus(typeof data.status === 'number' ? data.status : response.status)
        setResult(Json.stringify(data, null, 2))
      } catch {
        setStatus(response.status)
        setResult(text)
      }
    } catch (error) {
      setStatus(undefined)
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <p>
        This first signs the same Tempo transaction shape, then posts the raw transaction to{' '}
        <InlineCode>/fee-payer/probe</InlineCode> with <InlineCode>credentials: 'omit'</InlineCode>.
      </p>
      <p>
        It should report <InlineCode>401</InlineCode> even after you log in.
      </p>
      <TransferForm
        disabled={pending || !address}
        onSubmit={(form) => void probe(form)}
        submitLabel={pending ? 'Probing...' : 'Probe unauthenticated request'}
      />
      {status !== undefined && <p>Probe status: {status}</p>}
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
    <InlineCode>
      {isLoading ? 'Loading...' : data !== undefined ? formatUnits(data, 6) : '—'} pathUSD
    </InlineCode>
  )
}

function SendTransaction() {
  const { mutate: sendTransactionSync, data, error, isPending } = useSendTransactionSync()
  const feePayer = (data as { feePayer?: string | undefined } | undefined)?.feePayer

  return (
    <div>
      <TransferForm
        disabled={isPending}
        onSubmit={(form) => {
          sendTransactionSync({
            calls: [getTransferCall(form)],
          })
        }}
        submitLabel="Send"
      />

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

function TransferForm(props: {
  disabled: boolean
  onSubmit: (form: FormData) => void
  submitLabel: string
}) {
  const { disabled, onSubmit, submitLabel } = props

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(new FormData(event.currentTarget))
      }}
    >
      <input
        defaultValue="0x0000000000000000000000000000000000000001"
        name="to"
        placeholder="To (0x...)"
        size={42}
      />{' '}
      <input defaultValue="1" name="amount" placeholder="Amount" size={6} />{' '}
      <button type="submit" disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  )
}

function getTransferCall(form: FormData) {
  const to = form.get('to')
  Hex.assert(to)

  const amount = form.get('amount')
  if (!amount || Number.isNaN(Number(amount))) throw new Error('Amount must be a number.')

  return Actions.token.transfer.call({
    to,
    token: pathUsd,
    amount: parseUnits(amount.toString(), 6),
  })
}
