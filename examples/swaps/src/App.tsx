import { formatUnits, stringify } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const alphaUsd = '0x20c0000000000000000000000000000000000001' as const

export default function App() {
  const { address, status } = useConnection()
  return (
    <div>
      <h1>Swaps Example</h1>
      <p>
        Demonstrates the <code>wallet_swap</code> RPC via the <code>Hooks.wallet.useSwap</code> hook
        from <code>wagmi/tempo</code>. Each button opens the wallet's swap dialog with different
        pre-filled fields; the user confirms in the wallet before the swap is broadcast.
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

          <h2>Swap</h2>
          <Swap />
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
        Mints testnet pathUSD to your account so the swap buttons below have something to spend.
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

function Swap() {
  const swap = Hooks.wallet.useSwap()
  return (
    <div>
      <p>
        Opens the wallet's swap dialog. Pre-fill any combination of <code>token</code>,{' '}
        <code>pairToken</code>, <code>amount</code>, <code>type</code>, and <code>slippage</code>;
        omit fields to let the user choose them in the wallet UI.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={swap.isPending} onClick={() => swap.mutate({})}>
          Open swap
        </button>
        <button
          type="button"
          disabled={swap.isPending}
          onClick={() => swap.mutate({ token: pathUsd, pairToken: alphaUsd })}
        >
          Pre-fill pair
        </button>
        <button
          type="button"
          disabled={swap.isPending}
          onClick={() =>
            swap.mutate({
              amount: '1',
              pairToken: alphaUsd,
              slippage: 0.01,
              token: pathUsd,
              type: 'sell',
            })
          }
        >
          Sell 1 pathUSD
        </button>
        <button
          type="button"
          disabled={swap.isPending}
          onClick={() =>
            swap.mutate({
              amount: '1',
              pairToken: alphaUsd,
              token: pathUsd,
              type: 'buy',
            })
          }
        >
          Buy 1 pathUSD
        </button>
      </div>
      {swap.error && (
        <pre style={{ color: 'red' }}>{`${swap.error.name}: ${swap.error.message}`}</pre>
      )}
      {swap.isSuccess && (
        <p>
          ✅ Swapped.{' '}
          <a
            href={`${tempoModerato.blockExplorers.default.url}/tx/${swap.data.receipt.transactionHash}`}
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
