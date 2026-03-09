import { Hex, Json } from 'ox'
import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import { parseUnits } from 'viem'
import { Actions } from 'viem/tempo'

import { type AdapterType, provider, switchAdapter } from './provider.js'

export function App() {
  const [adapterType, setAdapterType] = useState<AdapterType>('secp256k1')
  const [, rerender] = useState(0)

  function onSwitch(type: AdapterType) {
    switchAdapter(type)
    setAdapterType(type)
    rerender((n) => n + 1)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>zyzz playground</h1>

      <h2>Adapter</h2>
      <select value={adapterType} onChange={(e) => onSwitch(e.target.value as AdapterType)}>
        <option value="secp256k1">secp256k1</option>
        <option value="webAuthn">webAuthn</option>
      </select>

      <h2>State</h2>
      <ProviderState />

      <h2>Events</h2>
      <Events />

      <h2>Connection</h2>
      <WalletConnect />
      <EthRequestAccounts />
      <WalletDisconnect />
      <Faucet />

      <h2>Accounts &amp; Chain</h2>
      <EthAccounts />
      <EthChainId />
      <WalletSwitchChain />

      <h2>Balances</h2>
      <WalletGetBalances />

      <h2>Transactions</h2>
      <Transactions />

      <h2>Receipts</h2>
      <EthGetTransactionReceipt />
      <WalletGetCallsStatus />

      <h2>MPP</h2>
      <Fortune />

      <h2>RPC Proxy (fallthrough)</h2>
      <EthBlockNumber />
    </div>
  )
}

// -- Faucet --

function Faucet() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="tempo_fundAddress" result={result} error={error}>
      <button
        onClick={() =>
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            return provider.request({
              method: 'tempo_fundAddress',
              params: [accounts[0]],
            } as any)
          })
        }
      >
        Fund Account
      </button>
    </Method>
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
      {Json.stringify(
        {
          connected: state.accounts.length > 0,
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
      <button onClick={() => execute(() => provider.request({ method: 'wallet_connect' }))}>
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
      <button onClick={() => execute(() => provider.request({ method: 'eth_requestAccounts' }))}>
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
      <button onClick={() => execute(() => provider.request({ method: 'eth_accounts' }))}>
        Get Accounts
      </button>
    </Method>
  )
}

function EthChainId() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_chainId" result={result} error={error}>
      <button onClick={() => execute(() => provider.request({ method: 'eth_chainId' }))}>
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

const tokens = {
  pathUSD: '0x20c0000000000000000000000000000000000000',
  alphaUSD: '0x20c0000000000000000000000000000000000001',
  betaUSD: '0x20c0000000000000000000000000000000000002',
  thetaUSD: '0x20c0000000000000000000000000000000000003',
} as const satisfies Record<string, `0x${string}`>

type CallRow = { to: `0x${string}`; token: `0x${string}`; amount: string }

function defaultRow(i: number): CallRow {
  return {
    to: `0x${(i + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
    token: tokens.pathUSD,
    amount: '1',
  }
}

function buildCalls(rows: CallRow[]) {
  return rows.map((r) =>
    Actions.token.transfer.call({
      to: r.to,
      token: r.token,
      amount: parseUnits(r.amount || '0', 6),
    }),
  )
}

function Transactions() {
  const [rows, setRows] = useState<CallRow[]>([defaultRow(0)])
  const [result, setResult] = useState<unknown>()
  const [error, setError] = useState<Error>()
  const [method, setMethod] = useState('')

  function updateRow(i: number, field: keyof CallRow, value: CallRow[keyof CallRow]) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)))
  }

  async function send(label: string, fn: () => Promise<unknown>) {
    setMethod(label)
    try {
      setError(undefined)
      setResult(await fn())
    } catch (e) {
      setResult(undefined)
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  const calls = buildCalls(rows)

  return (
    <div>
      <h3>Calls</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '55%' }} />
          <col style={{ width: '25%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>To</th>
            <th style={{ textAlign: 'left' }}>Token</th>
            <th style={{ textAlign: 'left' }}>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  value={row.to}
                  onChange={(e) => updateRow(i, 'to', e.target.value as `0x${string}`)}
                  style={{ width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </td>
              <td>
                <select
                  value={row.token}
                  onChange={(e) => updateRow(i, 'token', e.target.value as `0x${string}`)}
                  style={{ width: '100%' }}
                >
                  {Object.entries(tokens).map(([name, addr]) => (
                    <option key={addr} value={addr}>
                      {name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={row.amount}
                  onChange={(e) => updateRow(i, 'amount', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </td>
              <td>
                <button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setRows((prev) => [...prev, defaultRow(prev.length)])}>
        + Add Call
      </button>

      <h3>Send</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() =>
            send('eth_sendTransaction', () =>
              provider.request({
                method: 'eth_sendTransaction',
                params: [{ calls }],
              }),
            )
          }
        >
          eth_sendTransaction
        </button>

        <button
          onClick={() =>
            send('eth_sendTransactionSync', () =>
              provider.request({
                method: 'eth_sendTransactionSync',
                params: [{ calls }],
              }),
            )
          }
        >
          eth_sendTransactionSync
        </button>

        <button
          onClick={() =>
            send('wallet_sendCalls', () =>
              provider.request({
                method: 'wallet_sendCalls',
                params: [{ calls }],
              }),
            )
          }
        >
          wallet_sendCalls
        </button>

        <button
          onClick={() =>
            send('wallet_sendCalls (sync)', () =>
              provider.request({
                method: 'wallet_sendCalls',
                params: [{ calls, capabilities: { sync: true } }],
              }),
            )
          }
        >
          wallet_sendCalls (sync)
        </button>
      </div>

      {method && <h4>{method}</h4>}
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {result !== undefined && <pre>{Json.stringify(result, null, 2)}</pre>}
    </div>
  )
}

// -- Receipts --

function EthGetTransactionReceipt() {
  const [hash, setHash] = useState('')
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_getTransactionReceipt" result={result} error={error}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="Enter tx hash (0x...)"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <button
          disabled={!hash}
          onClick={() =>
            execute(() =>
              provider.request({
                method: 'eth_getTransactionReceipt',
                params: [hash as `0x${string}`],
              }),
            )
          }
        >
          Get Receipt
        </button>
      </div>
    </Method>
  )
}

function WalletGetCallsStatus() {
  const [id, setId] = useState('')
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_getCallsStatus" result={result} error={error}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Enter calls ID (0x...)"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <button
          disabled={!id}
          onClick={() =>
            execute(() =>
              provider.request({
                method: 'wallet_getCallsStatus',
                params: [id],
              }),
            )
          }
        >
          Get Status
        </button>
      </div>
    </Method>
  )
}

// -- Balances --

type TokenBalance = {
  address: string
  balance: string
  decimals: number
  display: string
  name: string
  symbol: string
}

function WalletGetBalances() {
  const [result, error, execute] = useRequest()
  const balances = result as TokenBalance[] | undefined
  return (
    <Method method="wallet_getBalances" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_getBalances',
              params: [
                {
                  tokens: [
                    '0x20c0000000000000000000000000000000000000',
                    '0x20c0000000000000000000000000000000000001',
                    '0x20c0000000000000000000000000000000000002',
                    '0x20c0000000000000000000000000000000000003',
                  ],
                },
              ],
            }),
          )
        }
      >
        Get Balances
      </button>
      {balances && balances.length > 0 && (
        <table style={{ marginTop: 8, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingRight: 16 }}>Token</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((t) => (
              <tr key={t.address}>
                <td style={{ paddingRight: 16 }}>
                  {t.name} ({t.symbol})
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {t.display}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Method>
  )
}

// -- Payments (mppx) --

function Fortune() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="fetch /fortune" result={result} error={error}>
      <button
        onClick={() => execute(() => fetch('/fortune').then((r) => r.json()))}
      >
        Get Fortune (0.01 pathUSD)
      </button>
    </Method>
  )
}

// -- RPC Proxy --

function EthBlockNumber() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_blockNumber" result={result} error={error}>
      <button onClick={() => execute(() => provider.request({ method: 'eth_blockNumber' }))}>
        Get Block Number
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
              <td>
                <pre style={{ margin: 0, whiteSpace: 'nowrap' }}>{Json.stringify(e.data)}</pre>
              </td>
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
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {result !== undefined && <pre>{Json.stringify(result, null, 2)}</pre>}
    </div>
  )
}
