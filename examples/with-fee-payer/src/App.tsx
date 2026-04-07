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

export default function App() {
  const { address, chainId, status } = useConnection()
  return (
    <div>
      <h1>Fee Payer Example</h1>

      <h2>Connection</h2>
      <pre>
        {stringify({ address: address ?? null, chainId: chainId ?? null, status }, null, 2)}
      </pre>

      <h2>Connect</h2>
      <Connect />

      {status === 'connected' && (
        <>
          <h2>Switch Chain</h2>
          <SwitchChain />

          <h2>Balance</h2>
          <Balance />

          <h2>Send Transaction</h2>
          <SendTransaction />
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
        <button type="button" onClick={() => connect({ connector })}>
          Login
        </button>
      )}
      <div>{status}</div>
      {error && <pre style={{ color: 'red' }}>{error.message}</pre>}
    </div>
  )
}

function SwitchChain() {
  const { chainId } = useConnection()
  const chains = useChains()
  const { mutate: switchChain } = useSwitchChain()
  return (
    <div style={{ display: 'flex', gap: 8 }}>
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

function Balance() {
  const { address } = useConnection()
  const { data, isLoading } = Hooks.token.useGetBalance({
    account: address,
    token: pathUsd,
    query: { refetchInterval: 1_000 },
  })
  return (
    <div>{isLoading ? 'Loading...' : data !== undefined ? formatUnits(data, 6) : '—'} pathUsd</div>
  )
}

function SendTransaction() {
  const { mutate: sendTransactionSync, data, error, isPending } = useSendTransactionSync()
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          sendTransactionSync({
            calls: [
              Actions.token.transfer.call({
                to: form.get('to') as string as Hex,
                token: pathUsd,
                amount: parseUnits((form.get('amount') as string) || '0', 6),
              }),
            ],
          })
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="to"
          defaultValue="0x0000000000000000000000000000000000000001"
          placeholder="To (0x...)"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <input name="amount" defaultValue="1" placeholder="Amount" style={{ width: 80 }} />
        <button type="submit" disabled={isPending}>
          Send
        </button>
      </form>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && (
        <>
          <p>
            ✅ Transaction success!{' '}
            {(data as any).feePayer && (
              <>
                Fees paid by: <code>{(data as any).feePayer}</code>
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
