import { useState } from 'react'
import { formatUnits, parseUnits, stringify, type Hex } from 'viem'
import { fillTransaction } from 'viem/actions'
import { Actions } from 'viem/tempo'
import {
  useChains,
  useConnect,
  useConnectorClient,
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
      <h1>Fee Estimate Example</h1>

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

          <h2>Send Transaction (with fee estimate)</h2>
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
  const { data: client } = useConnectorClient()
  const {
    mutate: sendTransactionSync,
    data: receipt,
    error: sendError,
    isPending: isSending,
  } = useSendTransactionSync()

  const [prepared, setPrepared] = useState<{
    calls: readonly { to?: Hex | undefined; data?: Hex | undefined; value?: bigint | undefined }[]
    fee: { amount: string; decimals: number; formatted: string; symbol: string } | null
    sponsored: boolean
  } | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)
  const [prepareError, setPrepareError] = useState<Error | null>(null)

  async function prepare(form: FormData) {
    if (!client) return
    setPrepared(null)
    setPrepareError(null)
    setIsPreparing(true)

    const calls = [
      Actions.token.transfer.call({
        to: form.get('to') as string as Hex,
        token: pathUsd,
        amount: parseUnits((form.get('amount') as string) || '0', 6),
      }),
    ]

    try {
      const result = await fillTransaction(client, {
        account: client.account!.address,
        calls,
      })
      setPrepared({
        calls,
        fee: result.capabilities?.fee ?? null,
        sponsored: result.capabilities?.sponsored ?? false,
      })
    } catch (e) {
      setPrepareError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsPreparing(false)
    }
  }

  function confirm() {
    if (!prepared) return
    sendTransactionSync({ calls: prepared.calls } as never)
    setPrepared(null)
  }

  function cancel() {
    setPrepared(null)
    setPrepareError(null)
  }

  const hasPrepared = !!prepared
  const error = prepareError ?? sendError

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          prepare(new FormData(e.currentTarget))
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="to"
          defaultValue="0x0000000000000000000000000000000000000001"
          placeholder="To (0x...)"
          disabled={hasPrepared}
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <input
          name="amount"
          defaultValue="1"
          placeholder="Amount"
          disabled={hasPrepared}
          style={{ width: 80 }}
        />
        <button type="submit" disabled={isPreparing || hasPrepared}>
          {isPreparing ? 'Estimating...' : 'Estimate Fee'}
        </button>
      </form>

      {prepared && (
        <div style={{ marginTop: 8 }}>
          {prepared.fee ? (
            <p>
              Estimated fee: <strong>{prepared.fee.formatted} {prepared.fee.symbol}</strong>
            </p>
          ) : prepared.sponsored ? (
            <p>Transaction is sponsored (no fee)</p>
          ) : (
            <p>Fee estimate unavailable</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={confirm} disabled={isSending}>
              {isSending ? 'Sending...' : 'Confirm & Send'}
            </button>
            <button type="button" onClick={cancel} disabled={isSending}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {receipt !== undefined && <pre>{stringify(receipt, null, 2)}</pre>}
    </div>
  )
}
