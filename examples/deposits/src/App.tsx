import { formatUnits, stringify } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { tempo } from 'wagmi/chains'
import { Hooks } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

export default function App() {
  const { address, status } = useConnection()
  return (
    <div>
      <h1>Deposits Example</h1>
      <p>
        Demonstrates the <code>wallet_deposit</code> RPC via the{' '}
        <code>Hooks.wallet.useDeposit</code> hook from <code>wagmi/tempo</code>. Each button opens
        the wallet's deposit dialog with different pre-filled fields.
      </p>

      <h2>Connection</h2>
      <pre>{stringify({ address: address ?? null, status }, null, 2)}</pre>

      <h2>Connect</h2>
      <Connect />

      {status === 'connected' && (
        <>
          <h2>Balance</h2>
          <Balance />

          <h2>Deposit</h2>
          <Deposit />
        </>
      )}
    </div>
  )
}

function Connect() {
  const connect = useConnect()
  const disconnect = useDisconnect()
  const { address } = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]

  if (!connector) return null

  return (
    <div>
      {address ? (
        <button type="button" onClick={() => disconnect.mutate()}>
          Disconnect
        </button>
      ) : (
        <button type="button" onClick={() => connect.mutate({ connector, chainId: tempo.id })}>
          Sign in
        </button>
      )}
      <div>{connect.status}</div>
      {connect.error && <pre style={{ color: 'red' }}>{connect.error.message}</pre>}
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
          : '-'}{' '}
      pathUSD
    </div>
  )
}

function Deposit() {
  const { address } = useConnection()
  const deposit = Hooks.wallet.useDeposit()
  return (
    <div>
      <p>
        Opens the wallet's deposit dialog. Pre-fill any combination of <code>address</code>,{' '}
        <code>amount</code>, <code>chainId</code>, <code>displayName</code>, and <code>token</code>;
        omit fields to let the user choose them in the wallet UI.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={deposit.isPending} onClick={() => deposit.mutate({})}>
          Open deposit
        </button>
        <button
          type="button"
          disabled={deposit.isPending}
          onClick={() =>
            deposit.mutate({
              displayName: 'Deposits Example',
              token: pathUsd,
            })
          }
        >
          Pre-fill pathUSD
        </button>
        <button
          type="button"
          disabled={deposit.isPending || !address}
          onClick={() =>
            deposit.mutate({
              address: address!,
              amount: '10',
              chainId: tempo.id,
              displayName: 'Deposits Example',
              token: pathUsd,
            })
          }
        >
          Deposit 10 pathUSD
        </button>
      </div>
      {deposit.error && (
        <pre style={{ color: 'red' }}>{`${deposit.error.name}: ${deposit.error.message}`}</pre>
      )}
      {deposit.isSuccess && (
        <div>
          <p>Deposit submitted.</p>
          {deposit.data?.receipts?.length ? (
            <ul>
              {deposit.data.receipts.map((receipt) => (
                <li key={receipt.transactionHash}>
                  <a
                    href={`${tempo.blockExplorers.default.url}/tx/${receipt.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    See receipt
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No onchain receipt was returned. Some deposit paths settle asynchronously.</p>
          )}
        </div>
      )}
    </div>
  )
}
