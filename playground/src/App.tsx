import { Hex, Json } from 'ox'
import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import { Expiry } from 'tempox'
import { parseUnits } from 'viem'
import { verifyMessage, verifyTypedData } from 'viem/actions'
import { Actions } from 'viem/tempo'

import {
  type AdapterType,
  type DialogMode,
  dialogMode,
  provider,
  switchAdapter,
  switchDialogMode,
} from './provider.js'

export function App() {
  const [adapterType, setAdapterType] = useState<AdapterType>('auth')
  const [, rerender] = useState(0)

  function onSwitch(type: AdapterType) {
    switchAdapter(type)
    setAdapterType(type)
    rerender((n) => n + 1)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>accounts playground</h1>

      <h2>Adapter</h2>
      <select value={adapterType} onChange={(e) => onSwitch(e.target.value as AdapterType)}>
        <option value="auth">auth</option>
        <option value="webAuthn">webAuthn</option>
        <option value="secp256k1">secp256k1</option>
      </select>
      {adapterType === 'auth' && (
        <>
          {' '}
          <select
            value={dialogMode}
            onChange={(e) => {
              switchDialogMode(e.target.value as DialogMode)
              rerender((n) => n + 1)
            }}
          >
            <option value="iframe">iframe</option>
            <option value="popup">popup</option>
          </select>
        </>
      )}

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

      <h2>Access Keys</h2>
      <WalletAuthorizeAccessKey />
      <WalletRevokeAccessKey />

      <h2>Balances</h2>
      <WalletGetBalances />

      <h2>Transactions</h2>
      <Transactions />

      <h2>Signing</h2>
      <PersonalSign />
      <VerifyMessage />
      <EthSignTypedData />
      <VerifyTypedData />

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

function ProviderState() {
  const state = useSyncExternalStore(
    (cb) => provider.store.subscribe(cb),
    () => provider.store.getState(),
  )
  return (
    <details>
      <summary>View</summary>
      <pre>{Json.stringify(state, null, 2)}</pre>
    </details>
  )
}

function WalletConnect() {
  const [result, error, execute] = useRequest()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = form.get('name') as string
    const digest = form.get('digest') as Hex.Hex
    const accessKey = form.get('accessKey') === 'on'
    const method = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')

    const authorizeAccessKey = accessKey ? { expiry: Expiry.days(1) } : undefined

    const capabilities =
      method === 'register'
        ? ({
            method: 'register',
            ...(name ? { name } : {}),
            ...(digest ? { digest } : {}),
            ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
          } as const)
        : {
            ...(digest ? { digest } : {}),
            ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
          }

    execute(() =>
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities }],
      }),
    )
  }

  return (
    <Method method="wallet_connect" result={result} error={error}>
      <form onSubmit={submit}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Name</label>
          <input name="name" placeholder="Account name (optional)" style={{ flex: 1 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Digest</label>
          <input
            name="digest"
            placeholder="0x... (optional)"
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>
            <input type="checkbox" name="accessKey" /> Authorize Access Key
          </label>
        </div>
        <button type="submit" value="login">
          Login
        </button>
        <button type="submit" value="register">
          Register
        </button>
      </form>
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
  const [useFeePayer, setUseFeePayer] = useState(false)
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
      <div style={{ marginBottom: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={useFeePayer}
            onChange={(e) => setUseFeePayer(e.target.checked)}
          />{' '}
          Fee Payer
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() =>
            send('eth_sendTransaction', () =>
              provider.request({
                method: 'eth_sendTransaction',
                params: [{ calls, ...(useFeePayer ? { feePayer: true } : {}) }],
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
                params: [{ calls, ...(useFeePayer ? { feePayer: true } : {}) }],
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

function PersonalSign() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="personal_sign" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const message = new FormData(e.currentTarget).get('message') as string
          if (!message) return
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            return provider.request({
              method: 'personal_sign',
              params: [Hex.fromString(message), accounts[0]],
            })
          })
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="message"
          defaultValue="hello world"
          placeholder="Message"
          style={{ flex: 1 }}
        />
        <button type="submit">Sign</button>
      </form>
    </Method>
  )
}

function EthSignTypedData() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_signTypedData_v4" result={result} error={error}>
      <button
        onClick={() =>
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            return provider.request({
              method: 'eth_signTypedData_v4',
              params: [
                accounts[0],
                Json.stringify({
                  types: {
                    EIP712Domain: [
                      { name: 'name', type: 'string' },
                      { name: 'version', type: 'string' },
                      { name: 'chainId', type: 'uint256' },
                    ],
                    Person: [
                      { name: 'name', type: 'string' },
                      { name: 'wallet', type: 'address' },
                    ],
                    Mail: [
                      { name: 'from', type: 'Person' },
                      { name: 'to', type: 'Person' },
                      { name: 'contents', type: 'string' },
                    ],
                  },
                  primaryType: 'Mail',
                  domain: { name: 'Example', version: '1', chainId: '1' },
                  message: {
                    from: { name: 'Alice', wallet: '0x0000000000000000000000000000000000000001' },
                    to: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000002' },
                    contents: 'Hello, Bob!',
                  },
                }),
              ],
            } as any)
          })
        }
      >
        Sign
      </button>
    </Method>
  )
}

function VerifyMessage() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="personal_sign (verify)" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          const message = form.get('message') as string
          const signature = form.get('signature') as `0x${string}`
          if (!message || !signature) return
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            const client = provider.getClient()
            return verifyMessage(client, {
              address: accounts[0],
              message,
              signature,
            })
          })
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Message</label>
          <input
            name="message"
            defaultValue="hello world"
            placeholder="Message"
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Signature</label>
          <input
            name="signature"
            placeholder="0x..."
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
        </div>
        <button type="submit">Verify</button>
      </form>
    </Method>
  )
}

function VerifyTypedData() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_signTypedData_v4 (verify)" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const signature = new FormData(e.currentTarget).get('signature') as `0x${string}`
          if (!signature) return
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            const client = provider.getClient()
            return verifyTypedData(client, {
              address: accounts[0],
              types: {
                Person: [
                  { name: 'name', type: 'string' },
                  { name: 'wallet', type: 'address' },
                ],
                Mail: [
                  { name: 'from', type: 'Person' },
                  { name: 'to', type: 'Person' },
                  { name: 'contents', type: 'string' },
                ],
              },
              primaryType: 'Mail',
              domain: { name: 'Example', version: '1', chainId: 1n },
              message: {
                from: { name: 'Alice', wallet: '0x0000000000000000000000000000000000000001' },
                to: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000002' },
                contents: 'Hello, Bob!',
              },
              signature,
            })
          })
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Signature</label>
          <input
            name="signature"
            placeholder="0x..."
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
        </div>
        <button type="submit">Verify</button>
      </form>
    </Method>
  )
}

function EthGetTransactionReceipt() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_getTransactionReceipt" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const hash = new FormData(e.currentTarget).get('hash') as string
          if (!hash) return
          execute(() =>
            provider.request({
              method: 'eth_getTransactionReceipt',
              params: [hash as `0x${string}`],
            }),
          )
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="hash"
          placeholder="Enter tx hash (0x...)"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <button type="submit">Get Receipt</button>
      </form>
    </Method>
  )
}

function WalletGetCallsStatus() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_getCallsStatus" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const id = new FormData(e.currentTarget).get('id') as string
          if (!id) return
          execute(() =>
            provider.request({
              method: 'wallet_getCallsStatus',
              params: [id],
            }),
          )
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="id"
          placeholder="Enter calls ID (0x...)"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <button type="submit">Get Status</button>
      </form>
    </Method>
  )
}

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

function WalletAuthorizeAccessKey() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_authorizeAccessKey" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          const expiry = form.get('expiry') as string
          const limitToken = form.get('limitToken') as string
          const limitAmount = form.get('limitAmount') as string

          const params: Record<string, unknown> = {}
          if (expiry) params.expiry = Math.floor(Date.now() / 1000) + Number(expiry)
          if (limitToken && limitAmount)
            params.limits = [
              { token: limitToken, limit: Hex.fromNumber(parseUnits(limitAmount, 6)) },
            ]

          execute(() =>
            provider.request({
              method: 'wallet_authorizeAccessKey',
              ...(Object.keys(params).length > 0 ? { params: [params] } : {}),
            } as never),
          )
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Expiry (seconds)</label>
          <input name="expiry" placeholder="3600" style={{ flex: 1 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Limit Token</label>
          <select name="limitToken" style={{ flex: 1 }}>
            <option value="">None</option>
            {Object.entries(tokens).map(([name, addr]) => (
              <option key={addr} value={addr}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Limit Amount</label>
          <input name="limitAmount" placeholder="100" style={{ flex: 1 }} />
        </div>
        <button type="submit">Authorize</button>
      </form>
    </Method>
  )
}

function WalletRevokeAccessKey() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_revokeAccessKey" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          const accessKeyAddress = form.get('accessKeyAddress') as `0x${string}`
          if (!accessKeyAddress) return
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            await provider.request({
              method: 'wallet_revokeAccessKey',
              params: [{ address: accounts[0], accessKeyAddress }],
            })
            return 'revoked'
          })
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Access Key Address</label>
          <input
            name="accessKeyAddress"
            placeholder="0x..."
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
        </div>
        <button type="submit">Revoke</button>
      </form>
    </Method>
  )
}

function Fortune() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="fetch /fortune" result={result} error={error}>
      <button onClick={() => execute(() => fetch('/fortune').then((r) => r.json()))}>
        Get Fortune (0.01 pathUSD)
      </button>
    </Method>
  )
}

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
