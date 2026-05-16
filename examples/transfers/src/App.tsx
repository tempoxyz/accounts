import { useState } from 'react'
import { formatUnits, stringify } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

export default function App() {
  const { address, status } = useConnection()
  return (
    <div>
      <h1>Transfers Example</h1>
      <p>
        Demonstrates two ways to transfer from a connected Tempo account: a{' '}
        <strong>user-initiated transfer</strong> via a <code>wallet_send</code> RPC request from the
        browser, and a <strong>server-initiated transfer</strong> via an HTTP{' '}
        <code>402 Payment Required</code> response from the server.
      </p>

      <h2>Connection</h2>
      <pre>{stringify({ address: address ?? null, status }, null, 2)}</pre>

      <h2>Connect</h2>
      <Connect />

      {status === 'connected' && (
        <>
          <h2>Balance</h2>
          <Balance />

          <h2>Faucet</h2>
          <Faucet />

          <h2>User-initiated Transfers</h2>
          <p>
            The connected account signs and broadcasts a stablecoin transfer via a{' '}
            <code>wallet_send</code> RPC request from the browser.
          </p>
          <Transfer />

          <h2>Server-initiated Transfers</h2>
          <p>
            The server demands a transfer via an HTTP <code>402 Payment Required</code> response;
            the SDK auto-fulfills the challenge and retries the request.
          </p>
          <Charge />
        </>
      )}
    </div>
  )
}

function Connect() {
  const { mutate: connect, status, error } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { address } = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]

  if (!connector) return null

  return (
    <div>
      {address ? (
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      ) : (
        <button type="button" onClick={() => connect({ connector, chainId: tempoModerato.id })}>
          Sign in
        </button>
      )}
      <div>{status}</div>
      {error && <pre style={{ color: 'red' }}>{error.message}</pre>}
    </div>
  )
}

function Balance() {
  const { address } = useConnection()
  const balance = Hooks.token.useGetBalance({
    account: address,
    token: pathUsd,
    query: { refetchInterval: 1_000 },
  })
  return (
    <div>
      {balance.isLoading
        ? 'Loading...'
        : balance.data !== undefined
          ? formatUnits(balance.data, 6)
          : '—'}{' '}
      pathUSD
    </div>
  )
}

function Faucet() {
  const { address } = useConnection()
  const fund = Hooks.faucet.useFundSync()
  return (
    <div>
      <p>Mints testnet pathUSD to your account so the buttons below have something to spend.</p>
      <button
        type="button"
        disabled={fund.isPending || !address}
        onClick={() => fund.mutate({ account: address! })}
      >
        {fund.isPending ? 'Funding...' : 'Fund Account'}
      </button>
      {fund.data && <p>✅ Funded.</p>}
      {fund.error && <pre style={{ color: 'red' }}>{fund.error.message}</pre>}
    </div>
  )
}

function Transfer() {
  const transfer = Hooks.wallet.useTransfer()
  return (
    <div>
      <p>
        Sends $1 of pathUSD directly from the connected account. Signed headlessly with the access
        key authorized in <code>config.ts</code>.
      </p>
      <button
        type="button"
        disabled={transfer.isPending}
        onClick={() =>
          transfer.mutate({
            amount: '1',
            to: '0x0000000000000000000000000000000000000001',
            token: 'pathusd',
          })
        }
      >
        {transfer.isPending ? 'Sending...' : 'Pay $1'}
      </button>
      {transfer.error && (
        <pre style={{ color: 'red' }}>{`${transfer.error.name}: ${transfer.error.message}`}</pre>
      )}
      {transfer.isSuccess && (
        <p>
          ✅ Sent.{' '}
          <a
            href={`${tempoModerato.blockExplorers.default.url}/tx/${transfer.data.receipt.transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            See receipt
          </a>
        </p>
      )}
    </div>
  )
}

function Charge() {
  const [data, setData] = useState<unknown>()
  const [error, setError] = useState<Error | undefined>()
  const [isPending, setPending] = useState(false)
  return (
    <div>
      <p>
        $0.01 per call. The server responds with <code>402 Payment Required</code>; the SDK signs
        and broadcasts a pathUSD transfer with the connected account, and only then does the server
        return the protected payload.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={async () => {
          setPending(true)
          setError(undefined)
          setData(undefined)
          try {
            const res = await fetch('/api/transfer')
            const body = await res.json()
            if (!res.ok) throw new Error(`${res.status}: ${stringify(body)}`)
            setData(body)
          } catch (e) {
            setError(e as Error)
          } finally {
            setPending(false)
          }
        }}
      >
        {isPending ? 'Transferring...' : 'GET /api/transfer'}
      </button>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{stringify(data, null, 2)}</pre>}
    </div>
  )
}
