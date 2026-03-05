import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import { Hex } from 'ox'
import { account, provider } from './provider.js'

export function App() {
  return (
    <div>
      <h1>zyzz playground</h1>
      <p>{account.address}</p>

      <h2>State</h2>
      <ProviderState />

      <h2>Events</h2>
      <Events />

      <h2>Connection</h2>
      <WalletConnect />
      <EthRequestAccounts />
      <WalletDisconnect />

      <h2>Accounts &amp; Chain</h2>
      <EthAccounts />
      <EthChainId />
      <WalletSwitchChain />

      <h2>Transactions</h2>
      <EthSendTransaction />
      <EthSendTransactionSync />
      <WalletSendCalls />

      <h2>RPC Proxy (fallthrough)</h2>
      <EthBlockNumber />
      <EthGetBalance />

    </div>
  )
}

// -- State --

function ProviderState() {
  const state = useSyncExternalStore(
    (cb) => provider.store.subscribe(cb),
    () => provider.store.getState(),
  )
  return (
    <pre>
      {JSON.stringify(
        {
          status: state.status,
          chainId: state.chainId,
          activeAccount: state.activeAccount,
          accounts: state.accounts.map((a) => a.address),
        },
        null,
        2,
      )}
    </pre>
  )
}

// -- Connection --

function WalletConnect() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_connect" result={result} error={error}>
      <button
        onClick={() => execute(() => provider.request({ method: 'wallet_connect' }))}
      >
        Login
      </button>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_connect',
              params: [{ capabilities: { method: 'register' } }],
            }),
          )
        }
      >
        Register
      </button>
    </Method>
  )
}

function EthRequestAccounts() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_requestAccounts" result={result} error={error}>
      <button
        onClick={() => execute(() => provider.request({ method: 'eth_requestAccounts' }))}
      >
        Request Accounts
      </button>
    </Method>
  )
}

function WalletDisconnect() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_disconnect" result={result} error={error}>
      <button
        onClick={() =>
          execute(async () => {
            await provider.request({ method: 'wallet_disconnect' })
            return 'disconnected'
          })
        }
      >
        Disconnect
      </button>
    </Method>
  )
}

// -- Accounts & Chain --

function EthAccounts() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_accounts" result={result} error={error}>
      <button
        onClick={() => execute(() => provider.request({ method: 'eth_accounts' }))}
      >
        Get Accounts
      </button>
    </Method>
  )
}

function EthChainId() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_chainId" result={result} error={error}>
      <button
        onClick={() => execute(() => provider.request({ method: 'eth_chainId' }))}
      >
        Get Chain ID
      </button>
    </Method>
  )
}

function WalletSwitchChain() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_switchEthereumChain" result={result} error={error}>
      {provider.chains.map((c) => (
        <button
          key={c.id}
          onClick={() =>
            execute(async () => {
              await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: Hex.fromNumber(c.id) }],
              })
              return `switched to ${c.name} (${c.id})`
            })
          }
        >
          {c.name}
        </button>
      ))}
    </Method>
  )
}

// -- Transactions --

function EthSendTransaction() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_sendTransaction" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'eth_sendTransaction',
              params: [{ to: account.address, value: '0x0', data: '0x' }],
            }),
          )
        }
      >
        Send Transaction
      </button>
    </Method>
  )
}

function EthSendTransactionSync() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_sendTransactionSync" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'eth_sendTransactionSync',
              params: [{ to: account.address, value: '0x0', data: '0x' }],
            }),
          )
        }
      >
        Send Transaction (Sync)
      </button>
    </Method>
  )
}

function WalletSendCalls() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_sendCalls" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_sendCalls',
              params: [{ calls: [{ to: account.address, data: '0x' }], version: '1.0' }],
            }),
          )
        }
      >
        Send Calls
      </button>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_sendCalls',
              params: [
                {
                  calls: [{ to: account.address, data: '0x' }],
                  capabilities: { sync: true },
                  version: '1.0',
                },
              ],
            }),
          )
        }
      >
        Send Calls (Sync)
      </button>
    </Method>
  )
}

// -- RPC Proxy --

function EthBlockNumber() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_blockNumber" result={result} error={error}>
      <button
        onClick={() => execute(() => provider.request({ method: 'eth_blockNumber' }))}
      >
        Get Block Number
      </button>
    </Method>
  )
}

function EthGetBalance() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_getBalance" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'eth_getBalance',
              params: [account.address, 'latest'],
            }),
          )
        }
      >
        Get Balance
      </button>
    </Method>
  )
}

// -- Events --

type Event = { name: string; data: unknown; time: string }

function Events() {
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    function push(name: string, data: unknown) {
      setEvents((prev) => [...prev, { name, data, time: new Date().toLocaleTimeString() }])
    }
    const onAccountsChanged = (accounts: unknown) => push('accountsChanged', accounts)
    const onChainChanged = (chainId: unknown) => push('chainChanged', chainId)
    const onConnect = (info: unknown) => push('connect', info)
    const onDisconnect = (error: unknown) => push('disconnect', error)

    provider.on('accountsChanged', onAccountsChanged)
    provider.on('chainChanged', onChainChanged)
    provider.on('connect', onConnect)
    provider.on('disconnect', onDisconnect)
    return () => {
      provider.removeListener('accountsChanged', onAccountsChanged)
      provider.removeListener('chainChanged', onChainChanged)
      provider.removeListener('connect', onConnect)
      provider.removeListener('disconnect', onDisconnect)
    }
  }, [])

  return (
    <div>
      <button onClick={() => setEvents([])}>Clear</button>
    <table style={{ tableLayout: 'fixed', width: '100%' }}>
      <colgroup>
        <col style={{ width: 100 }} />
        <col style={{ width: 150 }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Timestamp</th>
          <th style={{ textAlign: 'left' }}>Event</th>
          <th style={{ textAlign: 'left' }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={i}>
            <td>{e.time}</td>
            <td>{e.name}</td>
            <td><pre style={{ margin: 0, whiteSpace: 'nowrap' }}>{JSON.stringify(e.data)}</pre></td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

// -- Hooks --

function useRequest() {
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<Error>()
  const execute = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      setError(undefined)
      setResult(await fn())
    } catch (e) {
      setResult(undefined)
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }, [])
  return [result, error, execute] as const
}

// -- Shared UI --

function Method({
  method,
  result,
  error,
  children,
}: {
  method: string
  result: unknown
  error?: Error | undefined
  children: React.ReactNode
}) {
  return (
    <div>
      <h3>{method}</h3>
      {children}
      {error && (
        <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>
      )}
      {result !== undefined && (
        <pre>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  )
}
