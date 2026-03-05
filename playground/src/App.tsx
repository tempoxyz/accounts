import { useEffect, useSyncExternalStore, useState } from 'react'
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
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="wallet_connect" result={result}>
      <button
        onClick={async () => setResult(await provider.request({ method: 'wallet_connect' }))}
      >
        Login
      </button>
      <button
        onClick={async () =>
          setResult(
            await provider.request({
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
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_requestAccounts" result={result}>
      <button
        onClick={async () =>
          setResult(await provider.request({ method: 'eth_requestAccounts' }))
        }
      >
        Request Accounts
      </button>
    </Method>
  )
}

function WalletDisconnect() {
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="wallet_disconnect" result={result}>
      <button
        onClick={async () => {
          await provider.request({ method: 'wallet_disconnect' })
          setResult('disconnected')
        }}
      >
        Disconnect
      </button>
    </Method>
  )
}

// -- Accounts & Chain --

function EthAccounts() {
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_accounts" result={result}>
      <button
        onClick={async () =>
          setResult(await provider.request({ method: 'eth_accounts' }))
        }
      >
        Get Accounts
      </button>
    </Method>
  )
}

function EthChainId() {
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_chainId" result={result}>
      <button
        onClick={async () =>
          setResult(await provider.request({ method: 'eth_chainId' }))
        }
      >
        Get Chain ID
      </button>
    </Method>
  )
}

function WalletSwitchChain() {
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="wallet_switchEthereumChain" result={result}>
      {provider.chains.map((c) => (
        <button
          key={c.id}
          onClick={async () => {
            await provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: Hex.fromNumber(c.id) }],
            })
            setResult(`switched to ${c.name} (${c.id})`)
          }}
        >
          {c.name}
        </button>
      ))}
    </Method>
  )
}

// -- Transactions --

function EthSendTransaction() {
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_sendTransaction" result={result}>
      <button
        onClick={async () =>
          setResult(
            await provider.request({
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
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_sendTransactionSync" result={result}>
      <button
        onClick={async () =>
          setResult(
            await provider.request({
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
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="wallet_sendCalls" result={result}>
      <button
        onClick={async () =>
          setResult(
            await provider.request({
              method: 'wallet_sendCalls',
              params: [{ calls: [{ to: account.address, data: '0x' }], version: '1.0' }],
            }),
          )
        }
      >
        Send Calls
      </button>
      <button
        onClick={async () =>
          setResult(
            await provider.request({
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
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_blockNumber" result={result}>
      <button
        onClick={async () =>
          setResult(await provider.request({ method: 'eth_blockNumber' }))
        }
      >
        Get Block Number
      </button>
    </Method>
  )
}

function EthGetBalance() {
  const [result, setResult] = useState<unknown>()
  return (
    <Method method="eth_getBalance" result={result}>
      <button
        onClick={async () =>
          setResult(
            await provider.request({
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

// -- Shared UI --

function Method({
  method,
  result,
  children,
}: {
  method: string
  result: unknown
  children: React.ReactNode
}) {
  return (
    <div>
      <h3>{method}</h3>
      {children}
      {result !== undefined && (
        <pre>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  )
}
