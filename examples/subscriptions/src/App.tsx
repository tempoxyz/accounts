import { useMutation } from '@tanstack/react-query'
import { Receipt } from 'mppx'
import { useEffect, useState } from 'react'
import { formatUnits, stringify } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const subscriptionPeriodMs = 10_000

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
  const subscription = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/articles', {
        headers: { 'X-Subscriber': address },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(`${res.status}: ${stringify(body)}`)
      const paymentReceipt = res.headers.get('Payment-Receipt')
      return {
        data: body,
        receipt: paymentReceipt ? Receipt.deserialize(paymentReceipt) : undefined,
      }
    },
  })

  return (
    <div>
      <p>
        $0.01 / 10 seconds for unlimited articles. The first call prompts you to authorize a
        recurring access key; later calls within the period skip the on-chain transfer and the
        wallet prompt.
      </p>
      <button type="button" disabled={subscription.isPending} onClick={() => subscription.mutate()}>
        {subscription.isPending ? 'Subscribing...' : 'GET /api/articles'}
      </button>
      {subscription.error && <pre style={{ color: 'red' }}>{formatError(subscription.error)}</pre>}
      {subscription.data?.receipt && (
        <pre>{stringify({ receipt: subscription.data.receipt }, null, 2)}</pre>
      )}
      {subscription.data !== undefined && <pre>{stringify(subscription.data.data, null, 2)}</pre>}
      <CollectPayment
        key={subscription.data?.receipt?.timestamp ?? 'empty'}
        receipt={subscription.data?.receipt}
      />
    </div>
  )
}

function CollectPayment({ receipt }: { receipt: Receipt.Receipt | undefined }) {
  const collection = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const res = await fetch('/__subscriptions/collect', {
        body: JSON.stringify({ subscriptionId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(`${res.status}: ${stringify(body)}`)
      if (!isCollectResponse(body)) throw new Error('Invalid collection response.')
      return body
    },
  })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [])

  const currentReceipt = collection.data?.receipt ?? receipt
  const nextRenewalAt = currentReceipt ? getNextRenewalAt(currentReceipt) : undefined
  const secondsUntilRenewal =
    nextRenewalAt === undefined ? undefined : Math.max(0, Math.ceil((nextRenewalAt - now) / 1_000))
  const isDue = secondsUntilRenewal === 0

  return (
    <div>
      <h3>Collect renewal</h3>
      {currentReceipt?.subscriptionId ? (
        <p>
          {isDue
            ? 'Subscription is due. Click collect to charge the next period.'
            : `Subscription due in ${secondsUntilRenewal ?? 0}s. You can click early to see that no renewal is needed yet.`}
        </p>
      ) : (
        <p>Subscribe once, then collect the next period from the server.</p>
      )}
      <button
        type="button"
        disabled={!currentReceipt?.subscriptionId || collection.isPending}
        onClick={() => {
          if (!currentReceipt?.subscriptionId) return
          collection.mutate(currentReceipt.subscriptionId, {
            onSettled: () => setNow(Date.now()),
          })
        }}
      >
        {collection.isPending ? 'Collecting...' : 'Collect subscription'}
      </button>
      {collection.error && <pre style={{ color: 'red' }}>{formatError(collection.error)}</pre>}
      {collection.data !== undefined && (
        <pre>{stringify({ collection: collection.data }, null, 2)}</pre>
      )}
    </div>
  )
}

function getNextRenewalAt(receipt: Receipt.Receipt) {
  const timestamp = Date.parse(receipt.timestamp)
  if (!Number.isFinite(timestamp)) return undefined
  return timestamp + subscriptionPeriodMs
}

type CollectResponse = {
  receipt: Receipt.Receipt | null
  renewed: boolean
  subscriptionId: string
}

function formatError(error: Error) {
  return `${error.name}: ${error.message}`
}

function isCollectResponse(value: unknown): value is CollectResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'receipt' in value &&
    (value.receipt === null || typeof value.receipt === 'object') &&
    'renewed' in value &&
    typeof value.renewed === 'boolean' &&
    'subscriptionId' in value &&
    typeof value.subscriptionId === 'string'
  )
}
