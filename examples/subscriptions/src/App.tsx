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
      <h1>Subscriptions Example</h1>
      <p>
        Demonstrates an MPP <code>subscription</code> intent: the server gates a route behind a
        recurring pathUSD subscription, and the SDK auto-fulfills the{' '}
        <code>402 Payment Required</code> challenge by signing a recurring access key authorization
        with the connected account. Subsequent requests within the billing period reuse the active
        subscription, and the server renews it automatically when the period elapses.
      </p>

      <h2>Connection</h2>
      <pre>{stringify({ address: address ?? null, status }, null, 2)}</pre>

      <h2>Connect</h2>
      <Connect />

      {status === 'connected' && address && (
        <>
          <h2>Balance</h2>
          <Balance />

          <h2>Faucet</h2>
          <Faucet />

          <h2>Subscribe</h2>
          <Subscribe address={address} />
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
      <p>
        Mints testnet pathUSD to your account so the subscription can charge each billing period.
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

function Subscribe({ address }: { address: `0x${string}` }) {
  const [data, setData] = useState<unknown>()
  const [error, setError] = useState<Error | undefined>()
  const [isPending, setPending] = useState(false)
  return (
    <div>
      <p>
        $0.01 / day for unlimited articles. The first call prompts you to authorize a recurring
        access key; later calls within the period skip the on-chain transfer and the wallet prompt.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={async () => {
          setPending(true)
          setError(undefined)
          setData(undefined)
          try {
            const res = await fetch('/api/articles', {
              headers: { 'X-Subscriber': address },
            })
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
        {isPending ? 'Subscribing...' : 'GET /api/articles'}
      </button>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{stringify(data, null, 2)}</pre>}
    </div>
  )
}
