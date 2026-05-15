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
      <h1>MPP Example</h1>
      <p>
        Demonstrates the Accounts SDK auto-paying HTTP <code>402 Payment Required</code> responses
        served by a Hono server using <code>mppx/hono</code> middleware.
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

          <h2>Zero-Charge</h2>
          <ZeroCharge />

          <h2>Charge</h2>
          <Charge />
        </>
      )}
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
      <p>
        Mints testnet pathUSD to your account. Required before invoking the <code>charge</code>{' '}
        intent below.
      </p>
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

function ZeroCharge() {
  const [data, setData] = useState<unknown>()
  const [error, setError] = useState<Error | undefined>()
  const [isPending, setPending] = useState(false)
  return (
    <div>
      <p>
        Free $0 challenge. Proves the caller controls a Tempo account without any on-chain
        transaction.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={async () => {
          setPending(true)
          setError(undefined)
          setData(undefined)
          try {
            const res = await fetch('/api/auth')
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
        GET /api/auth
      </button>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{stringify(data, null, 2)}</pre>}
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
        $0.01 per call. The SDK signs and broadcasts a pathUSD transfer; the server only releases
        the response after the transfer settles on-chain.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={async () => {
          setPending(true)
          setError(undefined)
          setData(undefined)
          try {
            const res = await fetch('/api/fortune')
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
        GET /api/fortune
      </button>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{stringify(data, null, 2)}</pre>}
    </div>
  )
}
