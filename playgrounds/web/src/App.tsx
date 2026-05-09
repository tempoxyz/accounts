import { Hex, Json } from 'ox'
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useSyncExternalStore,
  useState,
} from 'react'
import { Button as RegenButton } from 'regen-ui'
import { parseUnits } from 'viem'
import { verifyMessage, verifyTypedData } from 'viem/actions'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { Actions } from 'viem/tempo'

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
import { TurnkeyEmailOtp } from './TurnkeyEmailOtp.js'

const sectionLinks = [
  { id: 'provider', title: 'Provider' },
  { id: 'connection', title: 'Connection' },
  { id: 'accounts-chain', title: 'Accounts & Chain' },
  { id: 'balances-funding', title: 'Balances & Funding' },
  { id: 'transactions', title: 'Transactions' },
  { id: 'receipts-status', title: 'Receipts & Status' },
  { id: 'access-keys', title: 'Access Keys' },
  { id: 'signing-verification', title: 'Signing & Verification' },
  { id: 'auth', title: 'Server Authentication' },
  { id: 'mpp', title: 'MPP' },
  { id: 'email-verification', title: 'Email Verification' },
  { id: 'rpc-proxy', title: 'RPC Proxy' },
] as const

type SectionId = (typeof sectionLinks)[number]['id']

export function App() {
  const [adapterType, setAdapterType] = useState<AdapterType>('tempoWallet')
  const [, rerender] = useState(0)
  const activeSection = useActiveSection()
  const network = useActiveNetwork()

  function onSwitch(type: AdapterType) {
    switchAdapter(type)
    setAdapterType(type)
    rerender((n) => n + 1)
  }

  return (
    <div className="playground min-h-dvh bg-background text-foreground" data-regen-radius="small">
      <TurnkeyEmailOtp />
      <div className="playground-layout">
        <aside className="playground-rail">
          <div className="flex min-h-0 flex-col gap-[20px]">
            <header className="flex flex-col gap-[6px]">
              <h1 className="heading-32">accounts playground</h1>
              <div className="label-13 text-foreground-secondary">{network}</div>
            </header>

            <nav aria-label="Playground sections" className="section-nav">
              {sectionLinks.map((link) => (
                <a
                  data-active={activeSection === link.id ? '' : undefined}
                  href={`#${link.id}`}
                  key={link.id}
                >
                  {link.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <main className="playground-content">
          <PlaygroundSection id="provider" title="Provider">
            <Events />
            <ProviderState />
          </PlaygroundSection>

          <PlaygroundSection id="connection" title="Connection">
            <WalletConnect />
            <EthRequestAccounts />
            <WalletDisconnect />
          </PlaygroundSection>

          <PlaygroundSection id="accounts-chain" title="Accounts & Chain">
            <EthAccounts />
            <EthChainId />
            <WalletSwitchChain />
          </PlaygroundSection>

          <PlaygroundSection id="balances-funding" title="Balances & Funding">
            <WalletGetBalances />
            <Faucet />
            <WalletDeposit />
          </PlaygroundSection>

          <PlaygroundSection id="transactions" title="Transactions">
            <Transactions />
            <WalletSend />
            <WalletSwap />
            <WalletDepositZone />
            <WalletWithdrawZone />
          </PlaygroundSection>

          <PlaygroundSection id="receipts-status" title="Receipts & Status">
            <EthGetTransactionReceipt />
            <WalletGetCallsStatus />
          </PlaygroundSection>

          <PlaygroundSection id="access-keys" title="Access Keys">
            <WalletAuthorizeAccessKey />
            <WalletRevokeAccessKey />
          </PlaygroundSection>

          <PlaygroundSection id="signing-verification" title="Signing & Verification">
            <PersonalSign />
            <PersonalSignSiwe />
            <VerifyMessage />
            <EthSignTypedData />
            <VerifyTypedData />
          </PlaygroundSection>

          <PlaygroundSection id="mpp" title="MPP">
            <Fortune />
            <MppZeroDollarAuth />
          </PlaygroundSection>

          <PlaygroundSection id="auth" title="Server Authentication">
            <Authenticate />
            <Me />
          </PlaygroundSection>

          <PlaygroundSection id="email-verification" title="Email Verification">
            <ManageEmail />
          </PlaygroundSection>

          <PlaygroundSection id="rpc-proxy" title="RPC Proxy">
            <EthBlockNumber />
          </PlaygroundSection>
        </main>

        <aside className="playground-config">
          <ConfigPanel
            adapterType={adapterType}
            onSwitch={onSwitch}
            rerender={() => rerender((n) => n + 1)}
          />
        </aside>
      </div>
    </div>
  )
}

function ConfigPanel(props: {
  adapterType: AdapterType
  onSwitch: (type: AdapterType) => void
  rerender: () => void
}) {
  const { adapterType, onSwitch, rerender } = props
  return (
    <section className="control-panel">
      <h2 className="control-panel-title">Configuration</h2>
      <div className="control-grid">
        <label>
          <span>Adapter</span>
          <select value={adapterType} onChange={(e) => onSwitch(e.target.value as AdapterType)}>
            <option value="tempoWallet">tempoWallet</option>
            <option value="dialogRefImpl">dialogRefImpl</option>
            <option value="turnkey">turnkey</option>
            <option value="webAuthn">webAuthn</option>
            <option value="secp256k1">secp256k1</option>
          </select>
        </label>
        {(adapterType === 'tempoWallet' || adapterType === 'dialogRefImpl') && (
          <label>
            <span>Mode</span>
            <select
              value={dialogMode}
              onChange={(e) => {
                switchDialogMode(e.target.value as DialogMode, adapterType)
                rerender()
              }}
            >
              <option value="iframe">iframe</option>
              <option value="popup">popup</option>
            </select>
          </label>
        )}
      </div>
      {(adapterType === 'tempoWallet' || adapterType === 'dialogRefImpl') && (
        <>
          <h3 className="control-panel-title">Theme</h3>
          <ThemeConfig adapterType={adapterType} rerender={rerender} />
          <h3 className="control-panel-title">Occlusion</h3>
          <OcclusionSimulator />
        </>
      )}
    </section>
  )
}

function PlaygroundSection(props: { children: ReactNode; id: string; title: ReactNode }) {
  const { children, id, title } = props
  return (
    <section className="scroll-mt-[24px] flex flex-col gap-[14px]" id={id}>
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      <div className="grid gap-[12px]">{children}</div>
    </section>
  )
}

function useActiveSection() {
  const [active, setActive] = useState<SectionId>(sectionLinks[0].id)

  useEffect(() => {
    function update() {
      let next: SectionId = sectionLinks[0].id

      for (const link of sectionLinks) {
        const section = document.getElementById(link.id)
        if (!section) continue
        if (section.getBoundingClientRect().top <= 120) next = link.id
        else break
      }

      setActive(next)
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return active
}

function useActiveNetwork() {
  const p = provider as {
    store: {
      subscribe: (
        selector: (state: { chainId: number }) => number,
        listener: () => void,
      ) => () => void
      getState: () => { chainId: number }
    }
  }
  const chainId = useSyncExternalStore(
    (cb) =>
      p.store.subscribe(
        (state) => state.chainId,
        () => cb(),
      ),
    () => p.store.getState().chainId,
  )

  if (chainId === tempo.id) return 'mainnet'
  if (chainId === tempoModerato.id) return 'testnet'
  if (chainId === tempoDevnet.id) return 'devnet'
  return `chain ${chainId}`
}

function Button(props: ComponentProps<typeof RegenButton>) {
  const { size = 'small', ...rest } = props
  return <RegenButton size={size} {...rest} />
}

function Faucet() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="tempo_fundAddress" result={result} error={error}>
      <Button
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
      </Button>
    </Method>
  )
}

function WalletDeposit() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_deposit" result={result} error={error}>
      <Button
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
      </Button>
      <Button
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
      </Button>
      <Button
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
      </Button>
    </Method>
  )
}

function WalletSend() {
  const [result, error, execute] = useRequest()
  const [feePayerMode, setFeePayerMode] = useState<'wallet' | 'playground' | 'disabled'>('wallet')

  const feePayerParam = (() => {
    if (feePayerMode === 'disabled') return { feePayer: false as const }
    if (feePayerMode === 'playground') return { feePayer: '/relay' }
    return {}
  })()

  return (
    <Method method="wallet_send" result={result} error={error}>
      <fieldset style={{ marginBottom: 8, border: 'none', padding: 0 }}>
        <legend>Fee Payer</legend>
        {(['wallet', 'playground', 'disabled'] as const).map((mode) => (
          <label key={mode} style={{ marginRight: 12 }}>
            <input
              type="radio"
              name="walletSendFeePayerMode"
              value={mode}
              checked={feePayerMode === mode}
              onChange={() => setFeePayerMode(mode)}
            />{' '}
            {mode[0]!.toUpperCase() + mode.slice(1)}
          </label>
        ))}
      </fieldset>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_send',
              params: [{ ...feePayerParam }],
            }),
          )
        }
      >
        Send
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_send',
              params: [{ token: tokens.pathUSD, ...feePayerParam }],
            }),
          )
        }
      >
        Send (PathUSD)
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_send',
              params: [
                {
                  to: '0x0000000000000000000000000000000000000001',
                  token: tokens.pathUSD,
                  value: '1',
                  ...feePayerParam,
                },
              ],
            }),
          )
        }
      >
        Send ($1 PathUSD)
      </Button>
    </Method>
  )
}

function WalletSwap() {
  const [result, error, execute] = useRequest()
  const token = tokens.pathUSD
  const pairToken = Object.values(tokens).find((x) => x !== token) ?? token

  return (
    <Method method="wallet_swap" result={result} error={error}>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_swap',
              params: [{}],
            }),
          )
        }
      >
        Swap
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_swap',
              params: [{ pairToken, token }],
            }),
          )
        }
      >
        Swap (pair)
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_swap',
              params: [{ amount: '1', pairToken, slippage: 0.01, token, type: 'sell' }],
            }),
          )
        }
      >
        Swap (sell 1 PathUSD)
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_swap',
              params: [{ amount: '1', pairToken, token, type: 'buy' }],
            }),
          )
        }
      >
        Swap (buy 1 PathUSD)
      </Button>
    </Method>
  )
}

function WalletDepositZone() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_depositZone" result={result} error={error}>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_depositZone',
              params: [{}],
            }),
          )
        }
      >
        Deposit to zone
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_depositZone',
              params: [{ token: tokens.pathUSD }],
            }),
          )
        }
      >
        Deposit (PathUSD)
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_depositZone',
              params: [{ amount: '1', token: tokens.pathUSD }],
            }),
          )
        }
      >
        Deposit (1 PathUSD)
      </Button>
    </Method>
  )
}

function WalletWithdrawZone() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_withdrawZone" result={result} error={error}>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_withdrawZone',
              params: [{}],
            }),
          )
        }
      >
        Withdraw from zone
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_withdrawZone',
              params: [{ token: tokens.pathUSD }],
            }),
          )
        }
      >
        Withdraw (PathUSD)
      </Button>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_withdrawZone',
              params: [{ amount: '1', token: tokens.pathUSD }],
            }),
          )
        }
      >
        Withdraw (1 PathUSD)
      </Button>
    </Method>
  )
}

function ProviderState() {
  const [open, setOpen] = useState(true)
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
    <article className="method-panel">
      <header className="method-header">
        <h3>provider store</h3>
        <Button className="method-header-action" onClick={() => setOpen((value) => !value)}>
          {open ? 'Collapse' : 'Expand'}
        </Button>
      </header>
      {open && (
        <pre className="method-result provider-state-result">{Json.stringify(state, null, 2)}</pre>
      )}
    </article>
  )
}

function WalletConnect() {
  const [result, error, execute] = useRequest()
  const tokenlist = useTokenlist()
  const [accessKeyEnabled, setAccessKeyEnabled] = useState(false)
  const [expiry, setExpiry] = useState('86400')
  const [limits, setLimits] = useState<LimitInput[]>([{ token: '', amount: '100', period: '' }])
  const [scopeSelector, setScopeSelector] = useState('transfer(address,uint256)')
  const [authEnabled, setAuthEnabled] = useState(false)

  // Once the tokenlist resolves, hydrate any unselected limit row with the first token.
  useEffect(() => {
    const first = tokenlist[0]?.address
    if (!first) return
    setLimits((prev) => prev.map((l) => (l.token ? l : { ...l, token: first })))
  }, [tokenlist])

  function updateLimit(index: number, patch: Partial<LimitInput>) {
    setLimits((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function addLimit() {
    setLimits((prev) => [...prev, { token: '', amount: '100', period: '' }])
  }
  function removeLimit(index: number) {
    setLimits((prev) => prev.filter((_, i) => i !== index))
  }
  function tokenInfo(address: string) {
    return tokenlist.find((t) => t.address.toLowerCase() === address.toLowerCase())
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = form.get('name') as string
    const digest = form.get('digest') as Hex.Hex
    const method = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')

    const authorizeAccessKey = accessKeyEnabled
      ? (() => {
          const filledLimits = limits.filter((l) => l.token && l.amount)
          return {
            expiry: Math.floor(Date.now() / 1000) + Number(expiry || '86400'),
            ...(filledLimits.length > 0 && {
              limits: filledLimits.map((l) => ({
                token: l.token,
                limit: Hex.fromNumber(parseUnits(l.amount, tokenInfo(l.token)?.decimals ?? 6)),
                ...(l.period ? { period: Number(l.period) } : {}),
              })),
            }),
            ...(scopeSelector && filledLimits[0]
              ? { scopes: [{ address: filledLimits[0].token, selector: scopeSelector }] }
              : {}),
          } as never
        })()
      : undefined

    // Server Authentication: the SDK absolutizes relative URLs against
    // the dapp's origin before forwarding to the wallet host.
    const auth = authEnabled ? '/auth' : undefined

    const capabilities =
      method === 'register'
        ? ({
            method: 'register',
            ...(name ? { name } : {}),
            ...(digest ? { digest } : {}),
            ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
            ...(auth ? { auth } : {}),
          } as const)
        : {
            ...(digest ? { digest } : {}),
            ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
            ...(auth ? { auth } : {}),
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
        <fieldset style={{ marginBottom: 8 }}>
          <legend>
            <label>
              <input
                checked={accessKeyEnabled}
                onChange={(e) => setAccessKeyEnabled(e.target.checked)}
                type="checkbox"
              />{' '}
              Authorize Access Key
            </label>
          </legend>
          {accessKeyEnabled && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label>Expiry (seconds)</label>
                <input
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="86400"
                  style={{ flex: 1 }}
                  value={expiry}
                />
              </div>
              <div style={{ marginBottom: 4 }}>
                <strong>Limits</strong>
              </div>
              {limits.map((limit, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <select
                    onChange={(e) => updateLimit(i, { token: e.target.value })}
                    style={{ flex: '1 1 160px' }}
                    value={limit.token}
                  >
                    <option value="">Select token…</option>
                    {tokenlist.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                  <input
                    onChange={(e) => updateLimit(i, { amount: e.target.value })}
                    placeholder="100"
                    style={{ flex: '1 1 80px' }}
                    value={limit.amount}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      checked={limit.period !== ''}
                      onChange={(e) =>
                        updateLimit(i, { period: e.target.checked ? '2592000' : '' })
                      }
                      type="checkbox"
                    />
                    period
                  </label>
                  {limit.period !== '' && (
                    <select
                      onChange={(e) => updateLimit(i, { period: e.target.value })}
                      style={{ flex: '1 1 100px' }}
                      value={limit.period}
                    >
                      {periodOptions
                        .filter((opt) => opt.value !== '')
                        .map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                    </select>
                  )}
                  <Button
                    disabled={limits.length === 1}
                    onClick={() => removeLimit(i)}
                    type="button"
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button onClick={addLimit} type="button">
                + Add limit
              </Button>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginTop: 8,
                  marginBottom: 8,
                }}
              >
                <label>Scope</label>
                <select
                  onChange={(e) => setScopeSelector(e.target.value)}
                  style={{ flex: 1 }}
                  value={scopeSelector}
                >
                  {scopePresets.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </fieldset>
        <fieldset style={{ marginBottom: 8 }}>
          <legend>
            <label>
              <input
                checked={authEnabled}
                onChange={(e) => setAuthEnabled(e.target.checked)}
                type="checkbox"
              />{' '}
              Authenticate with Server
            </label>
          </legend>
        </fieldset>
        <Button type="submit" value="login">
          Login
        </Button>
        <Button type="submit" value="register">
          Register
        </Button>
      </form>
    </Method>
  )
}

function EthRequestAccounts() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_requestAccounts" result={result} error={error}>
      <Button onClick={() => execute(() => provider.request({ method: 'eth_requestAccounts' }))}>
        Request Accounts
      </Button>
    </Method>
  )
}

function WalletDisconnect() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_disconnect" result={result} error={error}>
      <Button
        onClick={() =>
          execute(async () => {
            await provider.request({ method: 'wallet_disconnect' })
            return 'disconnected'
          })
        }
      >
        Disconnect
      </Button>
    </Method>
  )
}

function EthAccounts() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_accounts" result={result} error={error}>
      <Button onClick={() => execute(() => provider.request({ method: 'eth_accounts' }))}>
        Get Accounts
      </Button>
    </Method>
  )
}

function EthChainId() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_chainId" result={result} error={error}>
      <Button onClick={() => execute(() => provider.request({ method: 'eth_chainId' }))}>
        Get Chain ID
      </Button>
    </Method>
  )
}

function WalletSwitchChain() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_switchEthereumChain" result={result} error={error}>
      {provider.chains.map((c: { id: number; name?: string | undefined }) => (
        <Button
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
        </Button>
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
    <article className="method-panel">
      <header className="method-header">
        <h3>Send</h3>
      </header>
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
                <Button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>×</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button onClick={() => setRows((prev) => [...prev, defaultRow(prev.length)])}>
        + Add Call
      </Button>

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
      <div className="method-body">
        <Button
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
        </Button>

        <Button
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
        </Button>

        <Button
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
        </Button>

        <Button
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
        </Button>

        <Button
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
        </Button>
      </div>

      {method && (
        <header className="method-header">
          <h3>{method}</h3>
        </header>
      )}
      {error && <pre className="method-error">{`${error.name}: ${error.message}`}</pre>}
      {result !== undefined && (
        <pre className="method-result">{Json.stringify(result, null, 2)}</pre>
      )}
    </article>
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
        <Button type="submit">Sign</Button>
      </form>
    </Method>
  )
}

function PersonalSignSiwe() {
  const [result, setResult] = useState<{ message: string; signature: string }>()
  const [error, setError] = useState<Error>()
  return (
    <article className="method-panel">
      <header className="method-header">
        <h3>personal_sign (SIWE)</h3>
      </header>
      <div className="method-body">
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
          <Button type="submit">Sign (SIWE)</Button>
        </form>
      </div>
      {error && <pre className="method-error">{`${error.name}: ${error.message}`}</pre>}
      {result && (
        <pre className="method-result">{`message:\n${result.message}\n\nsignature:\n${result.signature}`}</pre>
      )}
    </article>
  )
}

function EthSignTypedData() {
  const [result, setResult] = useState<{ data: object; signature: string }>()
  const [error, setError] = useState<Error>()

  function signTypedData(label: string, data: object) {
    return (
      <Button
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
      </Button>
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
        <Button type="submit">Verify</Button>
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
        <Button type="submit">Verify</Button>
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
        <Button type="submit">Get Receipt</Button>
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
        <Button type="submit">Get Status</Button>
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
      <Button
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
      </Button>
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

type TokenlistEntry = {
  address: string
  chainId: number
  decimals: number
  logoURI?: string
  name: string
  symbol: string
}

type LimitInput = {
  token: string
  amount: string
  /** Empty string = no period (lifetime budget). */
  period: string
}

/** Fetch the live token list for the current chain, with a static fallback. */
function useTokenlist(): TokenlistEntry[] {
  const [list, setList] = useState<TokenlistEntry[]>(() =>
    Object.entries(tokens).map(([symbol, address]) => ({
      address,
      chainId: env === 'mainnet' ? tempo.id : env === 'devnet' ? tempoDevnet.id : tempoModerato.id,
      decimals: 6,
      name: symbol,
      symbol,
    })),
  )
  useEffect(() => {
    const chainId =
      env === 'mainnet' ? tempo.id : env === 'devnet' ? tempoDevnet.id : tempoModerato.id
    fetch(`https://tokenlist.tempo.xyz/list/${chainId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = (data as { tokens?: TokenlistEntry[] } | null)?.tokens
        if (list?.length) setList(list)
      })
      .catch(() => {})
  }, [])
  return list
}

function WalletAuthorizeAccessKey() {
  const [result, error, execute] = useRequest()
  const tokenlist = useTokenlist()
  const [limits, setLimits] = useState<LimitInput[]>([{ token: '', amount: '100', period: '' }])

  // Once the tokenlist resolves, hydrate any unselected limit row with the first token.
  useEffect(() => {
    const first = tokenlist[0]?.address
    if (!first) return
    setLimits((prev) => prev.map((l) => (l.token ? l : { ...l, token: first })))
  }, [tokenlist])

  function updateLimit(index: number, patch: Partial<LimitInput>) {
    setLimits((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function addLimit() {
    setLimits((prev) => [...prev, { token: '', amount: '100', period: '' }])
  }
  function removeLimit(index: number) {
    setLimits((prev) => prev.filter((_, i) => i !== index))
  }

  function tokenInfo(address: string) {
    return tokenlist.find((t) => t.address.toLowerCase() === address.toLowerCase())
  }

  return (
    <Method method="wallet_authorizeAccessKey" result={result} error={error}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          const expiry = (form.get('expiry') as string) || '3600'
          const scopeSelector = form.get('scopeSelector') as string

          const filledLimits = limits.filter((l) => l.token && l.amount)
          const params: Record<string, unknown> = {}
          if (expiry) params.expiry = Math.floor(Date.now() / 1000) + Number(expiry)
          if (filledLimits.length > 0)
            params.limits = filledLimits.map((l) => ({
              token: l.token,
              limit: Hex.fromNumber(parseUnits(l.amount, tokenInfo(l.token)?.decimals ?? 6)),
              ...(l.period ? { period: Number(l.period) } : {}),
            }))
          if (scopeSelector && filledLimits[0])
            params.scopes = [{ address: filledLimits[0].token, selector: scopeSelector }]

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

        <fieldset style={{ marginBottom: 8 }}>
          <legend>Limits</legend>
          {limits.map((limit, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 6,
                flexWrap: 'wrap',
              }}
            >
              <select
                onChange={(e) => updateLimit(i, { token: e.target.value })}
                style={{ flex: '1 1 160px' }}
                value={limit.token}
              >
                <option value="">Select token…</option>
                {tokenlist.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol}
                  </option>
                ))}
              </select>
              <input
                onChange={(e) => updateLimit(i, { amount: e.target.value })}
                placeholder="100"
                style={{ flex: '1 1 80px' }}
                value={limit.amount}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  checked={limit.period !== ''}
                  onChange={(e) => updateLimit(i, { period: e.target.checked ? '2592000' : '' })}
                  type="checkbox"
                />
                period
              </label>
              {limit.period !== '' && (
                <select
                  onChange={(e) => updateLimit(i, { period: e.target.value })}
                  style={{ flex: '1 1 100px' }}
                  value={limit.period}
                >
                  {periodOptions
                    .filter((opt) => opt.value !== '')
                    .map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                </select>
              )}
              <Button disabled={limits.length === 1} onClick={() => removeLimit(i)} type="button">
                ×
              </Button>
            </div>
          ))}
          <Button onClick={addLimit} type="button">
            + Add limit
          </Button>
        </fieldset>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Scope</label>
          <select defaultValue="transfer(address,uint256)" name="scopeSelector" style={{ flex: 1 }}>
            {scopePresets.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Authorize</Button>
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
        <Button type="submit">Revoke</Button>
      </form>
    </Method>
  )
}

function Fortune() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="fetch /fortune" result={result} error={error}>
      <Button onClick={() => execute(() => fetch('/fortune').then((r) => r.json()))}>
        Get Fortune (0.01 pathUSD)
      </Button>
    </Method>
  )
}

function MppZeroDollarAuth() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="fetch /zero-dollar-auth" result={result} error={error}>
      <Button onClick={() => execute(() => fetch('/zero-dollar-auth').then((r) => r.json()))}>
        Zero-Dollar Auth
      </Button>
    </Method>
  )
}

function Authenticate() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="wallet_connect (auth)" result={result} error={error}>
      <Button
        onClick={() =>
          execute(() =>
            provider.request({
              method: 'wallet_connect',
              params: [
                {
                  capabilities: { auth: '/auth' },
                  chainId: Hex.fromNumber(
                    env === 'devnet' ? tempoDevnet.id : testnet ? tempoModerato.id : tempo.id,
                  ),
                },
              ],
            }),
          )
        }
      >
        Authenticate
      </Button>
    </Method>
  )
}

function Me() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="fetch /me" result={result} error={error}>
      <Button
        onClick={() =>
          execute(async () => {
            const res = await fetch('/me', { credentials: 'include' })
            return { status: res.status, body: await res.json() }
          })
        }
      >
        GET /me
      </Button>
      <Button
        onClick={() =>
          execute(async () => {
            const res = await fetch('/auth/logout', {
              method: 'POST',
              credentials: 'include',
            })
            return { status: res.status }
          })
        }
      >
        POST /auth/logout
      </Button>
    </Method>
  )
}

function ManageEmail() {
  const walletHost = import.meta.env.VITE_WALLET_HOST ?? ''
  return (
    <article className="method-panel">
      <header className="method-header">
        <h3>Manage Email</h3>
      </header>
      <div className="method-body">
        <a href={`${walletHost}/email`} target="_blank" rel="noopener noreferrer">
          Open email settings →
        </a>
      </div>
    </article>
  )
}

function EthBlockNumber() {
  const [result, error, execute] = useRequest()
  return (
    <Method method="eth_blockNumber" result={result} error={error}>
      <Button onClick={() => execute(() => provider.request({ method: 'eth_blockNumber' }))}>
        Get Block Number
      </Button>
    </Method>
  )
}

type Event = { name: string; data: unknown; time: string }

function Events() {
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    function push(name: string, data: unknown) {
      setEvents((prev) => [...prev, { name, data, time: formatEventTime(new Date()) }])
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
    <article className="method-panel">
      <header className="method-header">
        <h3>provider events</h3>
        <Button className="method-header-action" onClick={() => setEvents([])}>
          Clear
        </Button>
      </header>
      {events.length === 0 ? (
        <div className="events-empty">No events yet</div>
      ) : (
        <div className="events-table-wrap">
          <table className="events-table">
            <colgroup>
              <col className="events-table-time" />
              <col className="events-table-name" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Time</th>
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
                    <code className="events-table-value">{formatEventValue(e.data)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

function formatEventTime(date: Date) {
  return date.toTimeString().slice(0, 8)
}

function formatEventValue(value: unknown) {
  if (typeof value === 'string') return value
  return Json.stringify(value, null, 2)
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
      <Button onClick={() => setActive((v) => !v)}>
        {active ? 'Remove Overlay' : 'Simulate Occlusion'}
      </Button>
    </div>
  )
}

const accentOptions = ['', 'neutral', 'blue', 'red', 'amber', 'green', 'purple', 'custom'] as const
const radiusOptions = ['', 'none', 'small', 'medium', 'large', 'full'] as const
const schemeOptions = ['', 'light', 'dark'] as const
type AccentOption = (typeof accentOptions)[number]

function isAccentOption(value: string): value is AccentOption {
  return accentOptions.includes(value as AccentOption)
}

function ThemeConfig(props: { adapterType: AdapterType; rerender: () => void }) {
  const initialAccent = theme?.accent ?? ''
  const [accent, setAccent] = useState<AccentOption>(
    isAccentOption(initialAccent) ? initialAccent : 'custom',
  )
  const [radius, setRadius] = useState(theme?.radius ?? '')
  const [scheme, setScheme] = useState(theme?.scheme ?? '')
  const [customAccent, setCustomAccent] = useState(
    initialAccent && !isAccentOption(initialAccent) ? initialAccent : '#6366f1',
  )

  function apply(next: {
    accent?: AccentOption | undefined
    customAccent?: string | undefined
    radius?: string | undefined
    scheme?: string | undefined
  }) {
    const a = next.accent ?? accent
    const c = next.customAccent ?? customAccent
    const r = next.radius ?? radius
    const s = next.scheme ?? scheme
    const accentValue = a === 'custom' ? c : a
    const t =
      accentValue || r || s
        ? {
            accent: accentValue || undefined,
            radius: (r || undefined) as never,
            scheme: (s || undefined) as never,
          }
        : undefined
    switchTheme(t, props.adapterType)
    props.rerender()
  }

  return (
    <div className="control-grid">
      <label>
        <span>Accent</span>
        <select
          value={accent}
          onChange={(e) => {
            const next = e.target.value
            if (!isAccentOption(next)) return
            setAccent(next)
            apply({ accent: next })
          }}
        >
          {accentOptions.map((v) => (
            <option key={v} value={v}>
              {v || '(default)'}
            </option>
          ))}
        </select>
        {accent === 'custom' && (
          <input
            type="color"
            value={customAccent}
            onChange={(e) => {
              setCustomAccent(e.target.value)
              apply({ customAccent: e.target.value })
            }}
          />
        )}
      </label>
      <label>
        <span>Radius</span>
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
      </label>
      <label>
        <span>Scheme</span>
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
      </label>
    </div>
  )
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
  children: ReactNode
}) {
  return (
    <article className="method-panel">
      <header className="method-header">
        <h3>{method}</h3>
      </header>
      <div className="method-body">{children}</div>
      {error && <pre className="method-error">{`${error.name}: ${error.message}`}</pre>}
      {result !== undefined && (
        <pre className="method-result">{Json.stringify(result, null, 2)}</pre>
      )}
    </article>
  )
}
