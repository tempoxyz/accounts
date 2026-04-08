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
    <main>
      <h1>Private Fee Payer Example</h1>
      <p>
        This demo keeps the fee payer <code>same-origin</code> with WebAuthn,
        <br />
        mints an <code>HttpOnly</code> session cookie on register or login, and only sponsors
        allowlisted contract calls.
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
          <li>
            The fee payer requires a valid <code>same-origin</code> session cookie.
          </li>
          <li>The transaction sender must match the session address.</li>
          <li>
            The demo only sponsors calls to the allowlisted <code>pathUSD</code> token contract.
          </li>
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
            <h2>Send Transaction</h2>
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
      {error && <pre>{error.message}</pre>}
    </div>
  )
}

function AuthProbe() {
  const { address, chainId } = useConnection()
  const [result, setResult] = useState<string>()
  const [status, setStatus] = useState<number>()
  const [pending, setPending] = useState(false)

  async function probe(form: FormData) {
    if (!address) return

    setPending(true)

    try {
      const call = getTransferCall(form)
      const response = await fetch('/fee-payer', {
        body: Json.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_fillTransaction',
          params: [
            {
              ...(chainId ? { chainId } : {}),
              calls: [call],
              feePayer: true,
              from: address,
            },
          ],
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
        This posts the same sponsor-first <code>eth_fillTransaction</code> request to{' '}
        <code>/fee-payer</code> with <code>credentials: 'omit'</code>.
      </p>
      <p>
        It should report <code>401</code> even after you log in.
      </p>
      <TransferForm
        disabled={pending || !address}
        onSubmit={(form) => void probe(form)}
        submitLabel={pending ? 'Probing...' : 'Probe unauthenticated request'}
      />
      {status !== undefined && <p>Probe status: {status}</p>}
      {result && <pre>{result}</pre>}
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
    <code>
      {isLoading ? 'Loading...' : data !== undefined ? formatUnits(data, 6) : '—'} pathUSD
    </code>
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

      {error && <pre>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && (
        <>
          <p>
            ✅ Transaction success!
            {feePayer && (
              <>
                {' '}
                Fees paid by: <code>{feePayer}</code>
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
