import { Expiry, type Rpc } from 'accounts'
import * as jose from 'jose'
import { Hex, Json } from 'ox'
import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import { parseUnits } from 'viem'
import { verifyMessage, verifyTypedData } from 'viem/actions'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { Actions } from 'viem/tempo'

import * as Oidc from './oidc.js'
import {
  type AdapterType,
  type DialogMode,
  dialogMode,
  provider,
  switchAdapter,
  switchDialogMode,
  switchTheme,
  theme,
  env,
  testnet,
  tokens,
} from './provider.js'

export function App() {
  const [adapterType, setAdapterType] = useState<AdapterType>('tempoWallet')
  const [, rerender] = useState(0)

  function onSwitch(type: AdapterType) {
    switchAdapter(type)
    setAdapterType(type)
    rerender((n) => n + 1)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>accounts playground</h1>

      <h2>Configuration</h2>
      <select value={adapterType} onChange={(e) => onSwitch(e.target.value as AdapterType)}>
        <option value="tempoWallet">tempoWallet</option>
        <option value="dialogRefImpl">dialogRefImpl</option>
        <option value="webAuthn">webAuthn</option>
        <option value="secp256k1">secp256k1</option>
      </select>
      {(adapterType === 'tempoWallet' || adapterType === 'dialogRefImpl') && (
        <>
          {' '}
          <select
            value={dialogMode}
            onChange={(e) => {
              switchDialogMode(e.target.value as DialogMode, adapterType)
              rerender((n) => n + 1)
            }}
          >
            <option value="iframe">iframe</option>
            <option value="popup">popup</option>
          </select>
          <h3>Theme</h3>
          <ThemeConfig adapterType={adapterType} rerender={() => rerender((n) => n + 1)} />
          <h3>Occlusion Test</h3>
          <OcclusionSimulator />
        </>
      )}
      <ProviderState />

      <h2>Events</h2>
      <Events />

      <h2>Connection</h2>
      <WalletConnect adapterType={adapterType} />
      <EthRequestAccounts />
      <WalletDisconnect />

      <h2>Accounts &amp; Chain</h2>
      <EthAccounts />
      <EthChainId />
      <WalletSwitchChain />

      <h2>Balances &amp; Funding</h2>
      <WalletGetBalances />
      <Faucet />
      <WalletDeposit />
      <WalletSend />

      <h2>Transactions</h2>
      <Transactions />

      <h2>Receipts &amp; Status</h2>
      <EthGetTransactionReceipt />
      <WalletGetCallsStatus />

      <h2>Access Keys</h2>
      <WalletAuthorizeAccessKey />
      <WalletRevokeAccessKey />

      <h2>Signing &amp; Verification</h2>
      <PersonalSign />
      <PersonalSignSiwe />
      <VerifyMessage />
      <EthSignTypedData />
      <VerifyTypedData />

      <h2>MPP</h2>
      <Fortune />
      <MppZeroDollarAuth />

      <h2>Email Verification</h2>
      <ManageEmail />

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

function WalletDeposit() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_deposit" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_deposit',
              params: [{}],
            }),
          )
        }
      >
        Deposit
      </button>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_deposit',
              params: [{ value: '50' }],
            }),
          )
        }
      >
        Deposit ($50)
      </button>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_deposit',
              params: [{ displayName: 'DoorDash' }],
            }),
          )
        }
      >
        Deposit (displayName: DoorDash)
      </button>
    </Method>
  )
}

function WalletSend() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_send" result={result} error={error}>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_send',
              params: [{}],
            }),
          )
        }
      >
        Send
      </button>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_send',
              params: [{ token: tokens.pathUSD }],
            }),
          )
        }
      >
        Send (PathUSD)
      </button>
      <button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_send',
              params: [{ to: '0x0000000000000000000000000000000000000001', token: tokens.pathUSD, value: '1' }],
            }),
          )
        }
      >
        Send ($1 PathUSD)
      </button>
    </Method>
  )
}

function ProviderState() {
  const p = provider as {
    store: {
      subscribe: (cb: () => void) => () => void
      getState: () => unknown
    }
  }
  const state = useSyncExternalStore(
    (cb) => p.store.subscribe(cb),
    () => p.store.getState(),
  )
  return (
    <details>
      <summary>View</summary>
      <pre>{Json.stringify(state, null, 2)}</pre>
    </details>
  )
}

type WalletConnectResult = Rpc.wallet_connect.Encoded['returns']
type WalletConnectOidcRequest = NonNullable<
  NonNullable<NonNullable<Rpc.wallet_connect.Decoded['params']>[0]['capabilities']>['oidc']
>
type WalletConnectRequestedOidc = {
  nonce: string
  provider: WalletConnectOidcProvider
  scope: 'openid' | 'openid email'
}
type WalletConnectOidcProvider = keyof WalletConnectOidcRequest

function WalletConnect(props: { adapterType: AdapterType }) {
  const { adapterType } = props
  const [result, error, execute] = useRequest()
  const supportsWalletOidc = adapterType === 'tempoWallet'
  const [requestedOidc, setRequestedOidc] = useState<WalletConnectRequestedOidc | undefined>()
  const walletConnect = result as WalletConnectResult | undefined
  const returnedOidc = (() => {
    if (requestedOidc?.provider === 'mock') return walletConnect?.accounts[0]?.capabilities.oidc?.mock
    if (requestedOidc?.provider === 'tempo') return walletConnect?.accounts[0]?.capabilities.oidc?.tempo

    return (
      walletConnect?.accounts[0]?.capabilities.oidc?.tempo ??
      walletConnect?.accounts[0]?.capabilities.oidc?.mock
    )
  })()
  const returnedOidcProvider = (() => {
    if (walletConnect?.accounts[0]?.capabilities.oidc?.tempo) return 'tempo' as const
    if (walletConnect?.accounts[0]?.capabilities.oidc?.mock) return 'mock' as const
    return undefined
  })()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = form.get('name') as string
    const digest = form.get('digest') as Hex.Hex
    const accessKey = form.get('accessKey') as string | null
    const oidcProvider = supportsWalletOidc
      ? ((form.get('oidcProvider') as '' | WalletConnectOidcProvider) ?? '')
      : ''
    const oidcScope = supportsWalletOidc
      ? ((form.get('oidcScope') as '' | 'openid' | 'openid email') ?? '')
      : ''
    const method = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')

    const limitToken = env === 'mainnet' && 'USDC.e' in tokens ? tokens['USDC.e'] : tokens.pathUSD
    const authorizeAccessKey = (() => {
      if (accessKey === '100-forever')
        return {
          expiry: Expiry.days(1),
          limits: [{ token: limitToken, limit: Hex.fromNumber(parseUnits('100', 6)) }],
        }
      if (accessKey === '10-monthly')
        return {
          expiry: Expiry.days(30),
          limits: [
            {
              token: limitToken,
              limit: Hex.fromNumber(parseUnits('10', 6)),
              period: 60 * 60 * 24 * 30,
            },
          ],
          scopes: [{ address: limitToken, selector: 'transfer(address,uint256)' }],
        }
      return undefined
    })()
    const oidc = (() => {
      if (!oidcProvider || !oidcScope) return undefined

      const request = { nonce: crypto.randomUUID(), scope: oidcScope } as const
      if (oidcProvider === 'mock') return { mock: request } satisfies WalletConnectOidcRequest
      return { tempo: request } satisfies WalletConnectOidcRequest
    })()

    setRequestedOidc(
      oidcProvider && oidcScope && oidc
        ? {
            nonce: oidc[oidcProvider]!.nonce,
            provider: oidcProvider,
            scope: oidcScope,
          }
        : undefined,
    )

    const capabilities =
      method === 'register'
        ? ({
            method: 'register',
            ...(name ? { name } : {}),
            ...(digest ? { digest } : {}),
            ...(oidc ? { oidc } : {}),
            ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
          } as const)
        : {
            ...(digest ? { digest } : {}),
            ...(oidc ? { oidc } : {}),
            ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
          }

    execute(() =>
      provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities,
            chainId: Hex.fromNumber(
              env === 'devnet' ? tempoDevnet.id : testnet ? tempoModerato.id : tempo.id,
            ),
          },
        ],
      }),
    )
  }

  return (
    <Method
      error={error}
      footer={
        supportsWalletOidc ? (
          <OidcInspector
            audience={currentOrigin()}
            prefill={
              returnedOidc && returnedOidcProvider
                ? {
                    issuer: returnedOidc.issuer,
                    nonce:
                      requestedOidc?.provider === returnedOidcProvider ? requestedOidc.nonce : '',
                    provider: returnedOidcProvider,
                    token: returnedOidc.idToken,
                  }
                : undefined
            }
          />
        ) : undefined
      }
      method="wallet_connect"
      result={result}
    >
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
        <fieldset style={{ marginBottom: 8 }}>
          <legend>Access Key</legend>
          <label>
            <input type="radio" name="accessKey" value="none" defaultChecked /> None
          </label>
          <label style={{ marginLeft: 8 }}>
            <input type="radio" name="accessKey" value="100-forever" /> $100 forever
          </label>
          <label style={{ marginLeft: 8 }}>
            <input type="radio" name="accessKey" value="10-monthly" /> $10 per month (transfer
            scope)
          </label>
        </fieldset>
        {supportsWalletOidc ? (
          <fieldset style={{ marginBottom: 8 }}>
            <legend>OIDC</legend>
            <label>
              <input type="radio" name="oidcScope" value="" defaultChecked /> None
            </label>
            <div style={{ marginTop: 8 }}>
              <label>
                <input type="radio" name="oidcProvider" value="tempo" defaultChecked /> Tempo
              </label>
              <label style={{ marginLeft: 8 }}>
                <input type="radio" name="oidcProvider" value="mock" /> Mock
              </label>
            </div>
            <label style={{ marginLeft: 8 }}>
              <input type="radio" name="oidcScope" value="openid" /> Request `openid`
            </label>
            <label style={{ marginLeft: 8 }}>
              <input type="radio" name="oidcScope" value="openid email" /> Request `openid email`
            </label>
          </fieldset>
        ) : (
          <p style={{ marginBottom: 8 }}>
            Wallet OIDC is currently available only with the <code>tempoWallet</code> adapter.
          </p>
        )}
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
      {provider.chains.map((c: { id: number; name?: string | undefined }) => (
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

type CallType = 'transfer' | 'approve'
type CallRow = { type: CallType; to: `0x${string}`; token: `0x${string}`; amount: string }

function defaultRow(i: number): CallRow {
  return {
    type: 'transfer',
    to: `0x${(i + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
    token: tokens.pathUSD,
    amount: '1',
  }
}

function buildCalls(rows: CallRow[]) {
  return rows.map((r) => {
    const amount = parseUnits(r.amount || '0', 6)
    if (r.type === 'approve') {
      return Actions.token.approve.call({
        spender: r.to,
        token: r.token,
        amount,
      })
    }
    return Actions.token.transfer.call({
      to: r.to,
      token: r.token,
      amount,
    })
  })
}

function Transactions() {
  const [rows, setRows] = useState<CallRow[]>([defaultRow(0)])
  const [feePayerMode, setFeePayerMode] = useState<'wallet' | 'playground' | 'disabled'>('wallet')
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
  const feePayerParam = (() => {
    if (feePayerMode === 'disabled') return { feePayer: false as const }
    if (feePayerMode === 'playground') return { feePayer: '/relay' }
    return {}
  })()

  return (
    <div>
      <h3>Calls</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '15%' }} />
          <col style={{ width: '40%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Type</th>
            <th style={{ textAlign: 'left' }}>To / Spender</th>
            <th style={{ textAlign: 'left' }}>Token</th>
            <th style={{ textAlign: 'left' }}>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <select
                  value={row.type}
                  onChange={(e) => updateRow(i, 'type', e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="transfer">transfer</option>
                  <option value="approve">approve</option>
                </select>
              </td>
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
      <fieldset style={{ marginBottom: 8, border: 'none', padding: 0 }}>
        <legend>Fee Payer</legend>
        {(['wallet', 'playground', 'disabled'] as const).map((mode) => (
          <label key={mode} style={{ marginRight: 12 }}>
            <input
              type="radio"
              name="feePayerMode"
              value={mode}
              checked={feePayerMode === mode}
              onChange={() => setFeePayerMode(mode)}
            />{' '}
            {mode[0]!.toUpperCase() + mode.slice(1)}
          </label>
        ))}
      </fieldset>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() =>
            send('eth_sendTransaction', () =>
              provider.request({
                method: 'eth_sendTransaction',
                params: [{ calls, ...feePayerParam }],
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
                params: [{ calls, ...feePayerParam }],
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

        <button
          onClick={() =>
            send('eth_signTransaction', () =>
              provider.request({
                method: 'eth_signTransaction',
                params: [{ calls, ...feePayerParam }],
              }),
            )
          }
        >
          eth_signTransaction
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

function PersonalSignSiwe() {
  const [result, setResult] = useState<{ message: string; signature: string }>()
  const [error, setError] = useState<Error>()
  return (
    <div>
      <h3>personal_sign (SIWE)</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const domain =
            (new FormData(e.currentTarget).get('domain') as string) || window.location.host
          ;(async () => {
            try {
              setError(undefined)
              const accounts = await provider.request({ method: 'eth_accounts' })
              if (accounts.length === 0) throw new Error('No accounts connected')
              const siweMessage = createSiweMessage({
                address: accounts[0],
                chainId: 42069,
                domain,
                nonce: generateSiweNonce(),
                statement: 'Sign in to the playground app.',
                uri: `https://${domain}`,
                version: '1',
              })
              const signature = await provider.request({
                method: 'personal_sign',
                params: [Hex.fromString(siweMessage), accounts[0]],
              })
              setResult({ message: siweMessage, signature })
            } catch (e) {
              setResult(undefined)
              setError(e instanceof Error ? e : new Error(String(e)))
            }
          })()
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="domain"
          defaultValue={window.location.host}
          placeholder="Domain…"
          style={{ flex: 1 }}
        />
        <button type="submit">Sign (SIWE)</button>
      </form>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {result && <pre>{`message:\n${result.message}\n\nsignature:\n${result.signature}`}</pre>}
    </div>
  )
}

function EthSignTypedData() {
  const [result, setResult] = useState<{ data: object; signature: string }>()
  const [error, setError] = useState<Error>()

  function signTypedData(label: string, data: object) {
    return (
      <button
        key={label}
        onClick={async () => {
          try {
            setResult(undefined)
            setError(undefined)
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return
            const signature = await provider.request({
              method: 'eth_signTypedData_v4',
              params: [accounts[0], Json.stringify(data)],
            } as any)
            setResult({ data, signature: signature as string })
          } catch (e) {
            setResult(undefined)
            setError(e instanceof Error ? e : new Error(String(e)))
          }
        }}
      >
        {label}
      </button>
    )
  }

  const chain = env === 'devnet' ? tempoDevnet : testnet ? tempoModerato : tempo
  const tokenAddress = Object.values(tokens)[0]

  return (
    <Method method="eth_signTypedData_v4" result={result} error={error}>
      {signTypedData('Generic (Mail)', {
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
        domain: { name: 'Example', version: '1', chainId: String(chain.id) },
        message: {
          from: { name: 'Alice', wallet: '0x0000000000000000000000000000000000000001' },
          to: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000002' },
          contents: 'Hello, Bob!',
        },
      })}
      {signTypedData('ERC-2612 Permit', {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        domain: {
          name: 'pathUSD',
          version: '1',
          chainId: String(chain.id),
          verifyingContract: tokenAddress,
        },
        message: {
          owner: '0x0000000000000000000000000000000000000001',
          spender: '0x0000000000000000000000000000000000000002',
          value: String(parseUnits('100', 6)),
          nonce: '0',
          deadline: String(Math.floor(Date.now() / 1000) + 86400),
        },
      })}
      {signTypedData('Permit2 (PermitSingle)', {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          PermitSingle: [
            { name: 'details', type: 'PermitDetails' },
            { name: 'spender', type: 'address' },
            { name: 'sigDeadline', type: 'uint256' },
          ],
          PermitDetails: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' },
          ],
        },
        primaryType: 'PermitSingle',
        domain: {
          name: 'Permit2',
          chainId: String(chain.id),
          verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        },
        message: {
          details: {
            token: tokenAddress,
            amount: String(parseUnits('100', 6)),
            expiration: String(Math.floor(Date.now() / 1000) + 86400),
            nonce: '0',
          },
          spender: '0x0000000000000000000000000000000000000002',
          sigDeadline: String(Math.floor(Date.now() / 1000) + 3600),
        },
      })}
      {signTypedData('Unusual Data', {
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }],
          RawPayload: [
            { name: 'data', type: 'bytes' },
            { name: 'nonce', type: 'uint256' },
          ],
        },
        primaryType: 'RawPayload',
        domain: { name: 'Unknown Protocol' },
        message: {
          data: '0xdeadbeefcafebabe',
          nonce: '42',
        },
      })}
    </Method>
  )
}

function VerifyMessage() {
  const [result, error, execute] = useRequest()
  const clear = useCallback(() => {
    execute(async () => undefined)
  }, [execute])
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
          <textarea
            name="message"
            defaultValue="hello world"
            onFocus={clear}
            placeholder="Message"
            rows={1}
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Signature</label>
          <input
            name="signature"
            onFocus={clear}
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
  const clear = useCallback(() => {
    execute(async () => undefined)
  }, [execute])
  return (
    <Method method="eth_signTypedData_v4 (verify)" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          const data = form.get('data') as string
          const signature = form.get('signature') as `0x${string}`
          if (!data || !signature) return
          execute(async () => {
            const accounts = await provider.request({ method: 'eth_accounts' })
            if (accounts.length === 0) return 'No accounts connected'
            const parsed = JSON.parse(data) as {
              domain: Record<string, unknown>
              message: Record<string, unknown>
              primaryType: string
              types: Record<string, unknown>
            }
            const domain = {
              ...parsed.domain,
              ...(typeof parsed.domain.chainId === 'string'
                ? { chainId: BigInt(parsed.domain.chainId) }
                : {}),
            }
            const client = provider.getClient()
            return verifyTypedData(client, {
              address: accounts[0],
              domain,
              types: parsed.types,
              primaryType: parsed.primaryType,
              message: parsed.message,
              signature,
            } as never)
          })
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Data</label>
          <textarea
            name="data"
            onFocus={clear}
            placeholder='{"types":...,"primaryType":...,"domain":...,"message":...}'
            rows={3}
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Signature</label>
          <input
            name="signature"
            onFocus={clear}
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
                  tokens: Object.values(tokens),
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

const periodOptions = [
  { label: 'None', value: '' },
  { label: '10 seconds', value: '10' },
  { label: '1 minute', value: '300' },
  { label: '1 hour', value: '3600' },
  { label: '1 day', value: '86400' },
  { label: '1 month', value: '2592000' },
  { label: '1 year', value: '31536000' },
] as const

const scopePresets = [
  { label: 'None', value: '' },
  { label: 'transfer(address,uint256)', value: 'transfer(address,uint256)' },
  { label: 'approve(address,uint256)', value: 'approve(address,uint256)' },
  {
    label: 'transferFrom(address,address,uint256)',
    value: 'transferFrom(address,address,uint256)',
  },
] as const

function WalletAuthorizeAccessKey() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_authorizeAccessKey" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          const expiry = (form.get('expiry') as string) || '3600'
          const limitToken = form.get('limitToken') as string
          const limitAmount = (form.get('limitAmount') as string) || '100'
          const period = form.get('period') as string
          const scopeSelector = form.get('scopeSelector') as string

          const params: Record<string, unknown> = {}
          if (expiry) params.expiry = Math.floor(Date.now() / 1000) + Number(expiry)
          if (limitToken && limitAmount)
            params.limits = [
              {
                token: limitToken,
                limit: Hex.fromNumber(parseUnits(limitAmount, 6)),
                ...(period ? { period: Number(period) } : {}),
              },
            ]
          if (scopeSelector && limitToken)
            params.scopes = [{ address: limitToken, selector: scopeSelector }]

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
          <select name="limitToken" defaultValue={Object.values(tokens)[0]} style={{ flex: 1 }}>
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Period</label>
          <select name="period" style={{ flex: 1 }}>
            {periodOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Scope</label>
          <select name="scopeSelector" style={{ flex: 1 }}>
            {scopePresets.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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

function MppZeroDollarAuth() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="fetch /zero-dollar-auth" result={result} error={error}>
      <button onClick={() => execute(() => fetch('/zero-dollar-auth').then((r) => r.json()))}>
        Zero-Dollar Auth
      </button>
    </Method>
  )
}

function ManageEmail() {
  const walletHost = import.meta.env.VITE_WALLET_HOST ?? ''
  return (
    <div>
      <h3>Manage Email</h3>
      <a href={`${walletHost}/email`} target="_blank" rel="noopener noreferrer">
        Open email settings →
      </a>
    </div>
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

type OidcVerification = Awaited<ReturnType<typeof verifyOidcIdToken>>
type Jwk = JsonWebKey & {
  alg?: string | undefined
  kid?: string | undefined
  use?: string | undefined
}

function OidcInspector(props: {
  audience: string
  prefill?: { issuer: string; nonce: string; provider: WalletConnectOidcProvider; token: string } | undefined
}) {
  const { audience: defaultAudience, prefill } = props
  const [audience, setAudience] = useState(defaultAudience)
  const [provider, setProvider] = useState<WalletConnectOidcProvider>(prefill?.provider ?? 'tempo')
  const [issuer, setIssuer] = useState(prefill?.issuer ?? '')
  const [nonce, setNonce] = useState(prefill?.nonce ?? '')
  const [token, setToken] = useState(prefill?.token ?? '')
  const [error, setError] = useState<Error>()
  const [result, setResult] = useState<OidcVerification>()

  useEffect(() => {
    if (!prefill?.token) return

    setProvider(prefill.provider)
    setIssuer(prefill.issuer)
    setNonce(prefill.nonce)
    setToken(prefill.token)
    setError(undefined)
    setResult(undefined)
  }, [prefill?.issuer, prefill?.nonce, prefill?.provider, prefill?.token])

  const issuerPlaceholder =
    provider === 'mock' ? 'https://wallet.tempo.local/mock-oidc' : 'https://wallet.tempo.local'
  const tokenPlaceholder =
    provider === 'mock' ? 'Paste a Mock OIDC ID token' : 'Paste a Tempo OIDC ID token'

  return (
    <details style={{ marginTop: 12 }}>
      <summary>Verify OIDC ID token</summary>
      <p style={{ marginBottom: 8 }}>
        Fetch discovery and JWKS first, then verify the signature and standard claims before
        reading payload fields. Works for Tempo and Mock issuers.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void (async () => {
            try {
              setError(undefined)
              setResult(undefined)
              setResult(
                await verifyOidcIdToken({
                  audience,
                  issuer,
                  nonce,
                  token,
                }),
              )
            } catch (e) {
              setError(e instanceof Error ? e : new Error(String(e)))
            }
          })()
        }}
      >
        <fieldset style={{ marginBottom: 8 }}>
          <legend>Provider</legend>
          <label>
            <input
              checked={provider === 'tempo'}
              name="oidcInspectorProvider"
              onChange={() => setProvider('tempo')}
              type="radio"
              value="tempo"
            />{' '}
            Tempo
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              checked={provider === 'mock'}
              name="oidcInspectorProvider"
              onChange={() => setProvider('mock')}
              type="radio"
              value="mock"
            />{' '}
            Mock
          </label>
        </fieldset>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Issuer</label>
          <input
            onChange={(e) => setIssuer(e.target.value)}
            placeholder={issuerPlaceholder}
            style={{ flex: 1 }}
            value={issuer}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Audience</label>
          <input onChange={(e) => setAudience(e.target.value)} style={{ flex: 1 }} value={audience} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Nonce</label>
          <input
            onChange={(e) => setNonce(e.target.value)}
            placeholder="Optional"
            style={{ flex: 1 }}
            value={nonce}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
          <label>ID Token</label>
          <textarea
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenPlaceholder}
            rows={4}
            style={{ flex: 1, fontFamily: 'monospace' }}
            value={token}
          />
        </div>
        <button type="submit">Verify token</button>
      </form>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {result && (
        <>
          <h4>Verified Claims</h4>
          <pre>{Json.stringify(result.claims, null, 2)}</pre>
          <details>
            <summary>Verification details</summary>
            <pre>
              {Json.stringify(
                {
                  discovery: result.discovery,
                  header: result.header,
                  jwk: result.jwk,
                  payload: result.payload,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </details>
  )
}

async function verifyOidcIdToken(options: {
  audience: string
  issuer: string
  nonce: string
  token: string
}) {
  const { audience, issuer, nonce, token } = options
  if (!issuer.trim()) throw new Error('Issuer is required.')
  if (!audience.trim()) throw new Error('Audience is required.')
  if (!token.trim()) throw new Error('ID token is required.')

  const discovery = await fetchJson<{
    issuer: string
    jwks_uri: string
  }>(Oidc.get(issuer))
  const jwks = await fetchJson<{ keys: Jwk[] }>(discovery.jwks_uri)
  const header = jose.decodeProtectedHeader(token)
  if (!header.alg) throw new Error('The ID token is missing an `alg` header.')

  const jwk = jwks.keys.find(
    (key) =>
      (header.kid ? key.kid === header.kid : true) &&
      (key.use === undefined || key.use === 'sig') &&
      (key.alg === undefined || key.alg === header.alg),
  )
  if (!jwk)
    throw new Error(
      header.kid
        ? `No JWKS signing key matched kid \`${header.kid}\`.`
        : 'No JWKS signing key matched the ID token header.',
    )

  const key = await jose.importJWK(jwk, header.alg)
  if (key instanceof Uint8Array) throw new Error('Expected a CryptoKey for the OIDC signing key.')

  const verified = await jose.jwtVerify(token, key, {
    audience,
    issuer: discovery.issuer,
  })
  if (nonce && verified.payload.nonce !== nonce)
    throw new Error(
      `Nonce mismatch. Expected \`${nonce}\`, received \`${String(verified.payload.nonce ?? '')}\`.`,
    )

  const email = verified.payload.email
  const emailVerified = verified.payload['email_verified']
  return {
    claims: {
      aud: verified.payload.aud,
      email: typeof email === 'string' ? email : undefined,
      email_verified: typeof emailVerified === 'boolean' ? emailVerified : undefined,
      exp: verified.payload.exp,
      expIso: verified.payload.exp ? new Date(verified.payload.exp * 1_000).toISOString() : undefined,
      iss: verified.payload.iss,
      nonce: verified.payload.nonce,
      sub: verified.payload.sub,
    },
    discovery,
    header: verified.protectedHeader,
    jwk: {
      alg: jwk.alg,
      kid: jwk.kid,
      use: jwk.use,
    },
    payload: verified.payload,
  }
}

async function fetchJson<value>(url: string): Promise<value> {
  const response = await fetch(`/oidc-proxy?url=${encodeURIComponent(url)}`)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  return (await response.json()) as value
}

function currentOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function OcclusionSimulator() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!active) return

    let overlay: HTMLDivElement | null = null

    function inject(dialog: Element) {
      if (overlay?.parentNode === dialog) return
      overlay?.remove()
      overlay = document.createElement('div')
      overlay.dataset.testid = 'occlusion-overlay'
      Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100px',
        height: '100px',
        background: 'red',
        border: '2px dashed red',
        zIndex: '999999',
      })
      dialog.appendChild(overlay)
    }

    function sync() {
      const dialog = document.querySelector('dialog[data-tempo-wallet][open]')
      if (!dialog) {
        overlay?.remove()
        overlay = null
        return
      }
      inject(dialog)
    }

    const bodyObserver = new MutationObserver(sync)
    bodyObserver.observe(document.body, { childList: true, subtree: true, attributes: true })
    sync()

    return () => {
      bodyObserver.disconnect()
      overlay?.remove()
    }
  }, [active])

  return (
    <div>
      <button onClick={() => setActive((v) => !v)}>
        {active ? 'Remove Overlay' : 'Simulate Occlusion'}
      </button>
      <p style={{ fontSize: 12, color: '#666' }}>
        Injects an overlay inside the {'<dialog>'} to trigger IO v2 occlusion detection.
      </p>
    </div>
  )
}

const accentOptions = ['', 'invert', 'blue', 'red', 'amber', 'green', 'purple'] as const
const radiusOptions = ['', 'none', 'small', 'medium', 'large', 'full'] as const
const fontOptions = [
  '',
  'System',
  'Pilat',
  'TT Norms',
  'Inter',
  'DM Sans',
  'Geist',
  'Outfit',
] as const
const schemeOptions = ['', 'light', 'dark'] as const

function ThemeConfig(props: { adapterType: AdapterType; rerender: () => void }) {
  const [accent, setAccent] = useState(theme?.accent ?? '')
  const [radius, setRadius] = useState(theme?.radius ?? '')
  const [font, setFont] = useState(theme?.font ?? '')
  const [scheme, setScheme] = useState(theme?.scheme ?? '')
  const [customAccent, setCustomAccent] = useState('#6366f1')

  function apply(next: { accent?: string; radius?: string; font?: string; scheme?: string }) {
    const a = next.accent ?? accent
    const r = next.radius ?? radius
    const f = next.font ?? font
    const s = next.scheme ?? scheme
    const t =
      a || r || f || s
        ? {
            accent: a || undefined,
            radius: (r || undefined) as never,
            font: f || undefined,
            scheme: (s || undefined) as never,
          }
        : undefined
    switchTheme(t, props.adapterType)
    props.rerender()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Accent</label>
        <select
          value={accent}
          onChange={(e) => {
            setAccent(e.target.value)
            apply({ accent: e.target.value })
          }}
        >
          {accentOptions.map((v) => (
            <option key={v} value={v}>
              {v || '(default)'}
            </option>
          ))}
        </select>
        <input
          type="color"
          value={customAccent}
          onChange={(e) => {
            setCustomAccent(e.target.value)
            setAccent(e.target.value)
            apply({ accent: e.target.value })
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Radius</label>
        <select
          value={radius}
          onChange={(e) => {
            setRadius(e.target.value)
            apply({ radius: e.target.value })
          }}
        >
          {radiusOptions.map((v) => (
            <option key={v} value={v}>
              {v || '(default)'}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Font</label>
        <select
          value={font}
          onChange={(e) => {
            setFont(e.target.value)
            apply({ font: e.target.value })
          }}
        >
          {fontOptions.map((v) => (
            <option key={v} value={v}>
              {v || '(default)'}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Scheme</label>
        <select
          value={scheme}
          onChange={(e) => {
            setScheme(e.target.value)
            apply({ scheme: e.target.value })
          }}
        >
          {schemeOptions.map((v) => (
            <option key={v} value={v}>
              {v || '(default)'}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function Method({
  children,
  error,
  footer,
  method,
  result,
}: {
  children: React.ReactNode
  error?: Error | undefined
  footer?: React.ReactNode | undefined
  method: string
  result: unknown
}) {
  return (
    <div>
      <h3>{method}</h3>
      {children}
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {result !== undefined && <pre>{Json.stringify(result, null, 2)}</pre>}
      {footer}
    </div>
  )
}
