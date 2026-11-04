/**
 * A third-party app that registers nothing. It signs in only through Tempo ID's pages, and its key
 * names its expiry, limits, and scopes, since Tempo ID refuses a third-party key without them.
 * @module
 */
import { AccessKey, Actions, Id, Permissions, Session } from 'accounts'
import type { Authorization, Funding } from 'accounts/internal'
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Json } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { StrictMode, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { formatUnits, isAddress, isAddressEqual, parseUnits } from 'viem'
import { Actions as TempoActions, TempoExecutionError } from 'viem/tempo'
import * as CoinflowFrame from '../web/CoinflowFrame.tsx'
import * as Defaults from '../web/Defaults.ts'
import * as FundingFields from '../web/FundingFields.tsx'
import * as Layout from '../web/Layout.tsx'
import * as Mpp from '../web/Mpp.tsx'
import * as PermissionFields from '../web/PermissionFields.tsx'
import {
  auth,
  byOrigin,
  client,
  clientId,
  clientIdKey,
  on,
  ousd,
  payments,
  tempoIdUrl,
} from './viem.config.ts'

/** The access key expired before a send. */
class KeyExpiredError extends Error {
  override readonly name = 'Transfers.KeyExpiredError'

  constructor() {
    super('The access key expired. Authorize a new key.')
  }
}

/** The API playground's URL, whose MPP routes the page pays. */
const apiUrl = import.meta.env.API_URL ?? 'http://127.0.0.1:5176'

/** Whether the page load is a callback, read before `redirect.complete` removes `state`. */
const callback = new URLSearchParams(location.search).has('state')

/**
 * The default fields: a one-day key that spends 10 OUSD in total, in transfers, MPP charges, which
 * call `transferWithMemo`, and MPP sessions, which open and top up a channel on the channel reserve.
 */
const defaults: PermissionFields.Fields = {
  limits: [{ amount: '10', decimals: 6, period: '', token: ousd }],
  scopes: [
    { call: 'transfer', recipient: '', token: ousd },
    { call: 'transferWithMemo', recipient: '', token: ousd },
    { call: 'open', recipient: '', token: '' },
    { call: 'topUp', recipient: '', token: '' },
  ],
  seconds: '86400',
}

/** `PERMISSIONS` from the end-to-end tests, which replaces the form. */
const configured = import.meta.env.PERMISSIONS
  ? Permissions.from(Json.parse(import.meta.env.PERMISSIONS))
  : undefined

/** The storage key of the form's fields, versioned by their shape. */
const fieldsKey = 'permissions:2'

/** The message that the page signs. */
const message = 'Sign in to the third-party playground'

/** Returns the typed data that the page signs, on the chain of the access key. */
function typedData(options: { chainId: number }) {
  return {
    domain: {
      chainId: options.chainId,
      name: 'Third-party playground',
      version: '1',
    },
    message: { contents: message, nonce: 1n },
    primaryType: 'Greeting',
    types: {
      Greeting: [
        { name: 'contents', type: 'string' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
  } as const
}

/** The sign-in's query key. */
const authorizationKey = ['authorization'] as const

function App() {
  const queryClient = useQueryClient()
  // Aborts the pending dialog sign-in, which the cancel button ends.
  const cancel = useRef<AbortController>(undefined)
  // Why the permission fields cannot form permissions, until the next sign-in starts.
  const [invalid, setInvalid] = useState<string>()
  // Why Tempo ID refused the sign-in, such as a denial on the approval page or a missing field.
  const [refused, setRefused] = useState<string>()
  // Each reset remounts the permission fields, which then read the emptied storage.
  const [resets, setResets] = useState(0)

  // Finishes a redirect sign-in, or returns `null`. A third-party app cannot authorize headlessly,
  // so it holds its sign-in only in the page, and a reload signs the user out of the app.
  const authorization = useQuery({
    queryFn: async () => {
      try {
        const completed = await Actions.redirect.complete(auth)
        // `start` always requests a key, so a sign-in without one is not this page's.
        return completed && 'key' in completed ? completed : null
      } catch (error) {
        if (!(error instanceof Id.RequestError)) throw error
        setRefused(error.message)
        return null
      } finally {
        if (callback) removeIssuer()
      }
    },
    queryKey: authorizationKey,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const redirect = useMutation({
    mutationFn: (funding: Funding.Funding | undefined) => start({ funding }),
  })
  const dialog = useMutation({
    mutationFn: async (options: {
      funding: Funding.Funding | undefined
      signal: AbortSignal
    }) => {
      try {
        return await Actions.dialog.signIn(auth, {
          ...options,
          accessKey: permissions(),
        })
      } catch (error) {
        if (!(error instanceof Id.RequestError)) throw error
        setRefused(error.message)
        return null
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(authorizationKey, result)
    },
  })

  // A third-party app cannot end the Tempo ID session, so sign-out forgets the sign-in and its key.
  const signOut = () => {
    setRefused(undefined)
    queryClient.setQueryData(authorizationKey, null)
  }

  const signedIn = authorization.data
  const starting = redirect.isPending || dialog.isPending
  const pending = (() => {
    if (dialog.isPending) return 'Continue in the Tempo ID dialog…'
    if (redirect.isPending) return 'Opening Tempo ID…'
    return undefined
  })()
  const status =
    pending ??
    invalid ??
    (authorization.error ?? redirect.error ?? dialog.error)?.message ??
    refused

  return (
    <Layout.Page title="Third-party playground">
      <details>
        <summary>Client ID</summary>
        <p>
          The client ID is{' '}
          <a href={clientId}>
            <code>{clientId}</code>
          </a>
          .
        </p>
        <label>
          Client ID
          <select
            defaultValue={byOrigin ? 'origin' : 'document'}
            // The client ID names the app in every request, so a change starts again from a new page.
            onChange={(event) => {
              localStorage.setItem(clientIdKey, event.currentTarget.value)
              location.reload()
            }}
          >
            <option value="document">Metadata document</option>
            <option value="origin">
              Origin, with the name and logo from the manifest
            </option>
          </select>
        </label>
      </details>

      {/* A refused sign-in shows its error beside the form, so the user can sign in again. */}
      {!authorization.isPending && !signedIn ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const problem = remember(event.currentTarget)
            setInvalid(problem)
            if (problem) return
            setRefused(undefined)
            cancel.current = new AbortController()
            dialog.mutate({
              funding: FundingFields.read(new FormData(event.currentTarget)),
              signal: cancel.current.signal,
            })
          }}
        >
          <Layout.Section
            description="Sign in to continue."
            id="sign-in"
            title="Sign in"
          >
            <p className="muted">
              Tempo ID's own sign-in, in a dialog or a redirect. A reload signs
              out of this app.
            </p>
            <Layout.Row>
              <button className="primary" disabled={starting} type="submit">
                Sign in via dialog
              </button>
              <button
                disabled={starting}
                onClick={(event) => {
                  const form = event.currentTarget.form!
                  const problem = remember(form)
                  setInvalid(problem)
                  if (problem) return
                  setRefused(undefined)
                  redirect.mutate(FundingFields.read(new FormData(form)))
                }}
                type="button"
              >
                Sign in via redirect
              </button>
              {dialog.isPending ? (
                <button
                  onClick={() =>
                    cancel.current?.abort(
                      new Error('Sign-in canceled. Sign in again.'),
                    )
                  }
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
            </Layout.Row>
            <details>
              <summary>Funding hint</summary>
              <FundingFields.Form chainId={client.chain.id} />
            </details>
            <details>
              <summary>Permissions</summary>
              <fieldset
                aria-label="Permissions"
                disabled={Boolean(configured)}
                key={resets}
              >
                <p className="muted">
                  {configured
                    ? 'Set by PERMISSIONS.'
                    : 'Tempo ID refuses a third-party access key without an expiry, a limit, and a scope.'}
                </p>
                <PermissionFields.Form
                  chainId={client.chain.id}
                  defaultValue={stored()}
                  disabled={Boolean(configured)}
                  tempoIdUrl={tempoIdUrl}
                />
                {configured ? null : (
                  <Layout.Row>
                    <button
                      onClick={() => {
                        sessionStorage.removeItem(fieldsKey)
                        setInvalid(undefined)
                        setResets((count) => count + 1)
                      }}
                      type="button"
                    >
                      Reset permissions
                    </button>
                  </Layout.Row>
                )}
              </fieldset>
            </details>
          </Layout.Section>
        </form>
      ) : null}

      {signedIn ? (
        <SignedIn authorization={signedIn} onSignOut={signOut} />
      ) : null}

      <CoinflowFrame.Section tempoIdUrl={tempoIdUrl} />

      <p aria-live="polite" role="status">
        {status}
      </p>
    </Layout.Page>
  )
}

/**
 * Shows the signed-in user, the Tempo Account, and the sign-in's details, and the sections that fund
 * the account and pay, sign, and call MPP endpoints with its access key.
 */
function SignedIn(props: SignedIn.Props) {
  const { key, user } = props.authorization
  const { address } = KeyAuthorization.fromRpc(key.keyAuthorization)

  return (
    <>
      <Layout.Section id="account-heading" title="Account">
        <dl>
          <dt>Email</dt>
          <dd id="who">{user.email}</dd>
          <dt>Tempo Account</dt>
          <dd id="account">{key.account}</dd>
          <dt>Access key</dt>
          <dd>{address}</dd>
        </dl>
        <Layout.Row>
          <button onClick={props.onSignOut} type="button">
            Sign out
          </button>
        </Layout.Row>
        <details>
          <summary>Session details</summary>
          <KeyDetails sessionKey={key} />
          <pre>
            {Json.stringify(
              {
                // The tokens stay out of the page.
                accessKey: {
                  account: key.account,
                  chainId: key.chainId,
                  keyAuthorization: key.keyAuthorization,
                },
                expiresAt: new Date(
                  props.authorization.expiresAt,
                ).toISOString(),
                user,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </Layout.Section>
      <Wallet authorization={props.authorization} />
    </>
  )
}

declare namespace SignedIn {
  type Props = {
    /** The sign-in, with its access key account. */
    authorization: Authorization.Authorization
    /** Forgets the sign-in and its key. */
    onSignOut: () => void
  }
}

/** Lists the chain, expiry, and limits of the sign-in's access key. */
function KeyDetails(props: KeyDetails.Props) {
  const { chainId, expiry, limits } = KeyAuthorization.fromRpc(
    props.sessionKey.keyAuthorization,
  )
  const chain = on(Number(chainId)).chain

  return (
    <dl id="key">
      <dt>Chain</dt>
      <dd>
        {Number(chainId) === chain.id
          ? `${chainId} (${chain.name})`
          : String(chainId)}
      </dd>
      <dt>Expires</dt>
      <dd>{expiry ? new Date(expiry * 1000).toLocaleString() : 'Never'}</dd>
      <dt>Limit</dt>
      <dd>
        {(() => {
          if (!limits) return 'Unlimited'
          if (limits.length === 0) return 'No spending'
          return limits
            .map((entry) => {
              // Every TIP-20 token has 6 decimals.
              const amount = `${Number(formatUnits(entry.limit, 6)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${isAddressEqual(entry.token, ousd) ? 'OUSD' : entry.token}`
              return entry.period
                ? `${amount} per ${entry.period} seconds`
                : amount
            })
            .join(', ')
        })()}
      </dd>
    </dl>
  )
}

declare namespace KeyDetails {
  type Props = {
    /** The sign-in's access key. */
    sessionKey: AccessKey.AccessKey
  }
}

/**
 * Shows the balance and funds the Tempo Account, sends OUSD, signs a message and typed data, and pays
 * MPP endpoints, each with the sign-in's access key.
 */
function Wallet(props: Wallet.Props) {
  const { accessKey: account, key } = props.authorization
  const { chainId } = KeyAuthorization.fromRpc(key.keyAuthorization)
  // Sends and reads go to the key's chain, which the permissions can set apart from the page's.
  const chainClient = useMemo(() => on(Number(chainId)), [chainId])
  // The page's sign-in as a session, whose access key pays the MPP section's endpoints. The app holds
  // the access key's account, which signs for a stored key without material.
  const payer = useCallback(
    (overrides: Parameters<typeof payments.mpp>[0] = {}) =>
      payments.mpp({
        ...overrides,
        accessKey: account,
        session: Session.from(props.authorization),
      }),
    [account, props.authorization],
  )
  const explorer = chainClient.chain.blockExplorers?.default.url

  // The read waits for a deposit, a send, or a click, since a page whose browser cannot reach the
  // chain logs an error for each read.
  const balance = useQuery({
    enabled: false,
    queryFn: async () => {
      // OUSD has 6 decimals.
      const { formatted } = await chainClient.token.getBalance({
        account: account.address,
        decimals: 6,
        token: ousd,
      })
      return Number(formatted).toLocaleString('en-US', {
        maximumFractionDigits: 6,
      })
    },
    queryKey: ['balance', account.address],
  })
  // The page holds its sign-in itself, so it names the account. A redirect would drop the sign-in,
  // so the deposit page opens only in a popup.
  const deposit = useMutation({
    mutationFn: () =>
      payments.funding.open({
        address: account.address,
        chainId: Number(chainId),
        mode: 'popup',
      }),
    onSuccess: () => balance.refetch(),
  })
  // Viem attaches the key's authorization to its first transaction.
  const send = useMutation({
    mutationFn: async (form: FormData) => {
      const to = String(form.get('recipient'))
      if (!isAddress(to)) throw new Error('Enter the recipient as an address.')
      // OUSD has 6 decimals.
      const amount = parseUnits(String(form.get('amount')), 6)
      if (amount <= 0n) throw new Error('Enter an amount above 0.')
      if (AccessKey.expired(key)) throw new KeyExpiredError()

      const { receipt } = await chainClient.token.transferSync({
        account,
        amount,
        to,
        token: ousd,
      })
      return receipt
    },
    onSuccess: () => balance.refetch(),
  })
  // The access key signs in a keychain envelope. A verifier reads the access key's state on the
  // chain, so a signature verifies only after the access key's first transaction.
  const sign = useMutation({
    mutationFn: async (kind: 'message' | 'typed-data') => {
      const data = typedData({ chainId: chainClient.chain.id })
      const signature = await (kind === 'message'
        ? account.signMessage({ message })
        : account.signTypedData(data))
      const verified = await (kind === 'message'
        ? chainClient.verifyMessage({
            address: account.address,
            message,
            mode: 'allowAccessKey',
            signature,
          })
        : chainClient.verifyTypedData({
            ...data,
            address: account.address,
            mode: 'allowAccessKey',
            signature,
          }))
      return { kind, signature, verified }
    },
  })
  // The redirect returns to the approval page, which signs a new key for the remembered permissions.
  const renew = useMutation({ mutationFn: start })

  const problem = send.error ? describe(send.error) : undefined
  const result = deposit.data

  return (
    <>
      <Layout.Section id="fund-heading" title="Fund account">
        <p>
          Balance{' '}
          <strong id="balance">
            {(() => {
              if (balance.isFetching) return 'Reading…'
              if (balance.data !== undefined) return `${balance.data} OUSD`
              if (balance.error) return describe(balance.error).message
              return 'Not read'
            })()}
          </strong>
        </p>
        <Layout.Row>
          <button
            className="primary"
            disabled={deposit.isPending}
            onClick={() => deposit.mutate()}
            type="button"
          >
            Deposit via popup
          </button>
          <button
            disabled={balance.isFetching}
            // `refetch` resolves with the error instead of rejecting, so nothing awaits it.
            onClick={() => void balance.refetch()}
            type="button"
          >
            Refresh balance
          </button>
        </Layout.Row>
        <p id="deposit" role="status">
          {(() => {
            if (deposit.isPending) return 'Waiting for the deposit page…'
            if (deposit.error) return deposit.error.message
            if (result?.status === 'received')
              return result.amount === undefined
                ? 'Deposit received.'
                : `Deposit received: ${result.amount} USD.`
            if (result?.status === 'continued')
              return 'Returned without a deposit.'
            if (result?.status === 'closed') return 'Closed the deposit page.'
            return undefined
          })()}
        </p>
      </Layout.Section>

      <Layout.Section id="send-heading" title="Send payments">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send.mutate(new FormData(event.currentTarget))
          }}
        >
          <Layout.Row>
            <label htmlFor="recipient">
              Recipient
              <input
                defaultValue="0x000000000000000000000000000000000000dEaD"
                id="recipient"
                name="recipient"
                pattern="0x[0-9a-fA-F]{40}"
                required
              />
            </label>
            <label htmlFor="amount">
              Amount
              <input
                defaultValue="0.01"
                id="amount"
                inputMode="decimal"
                name="amount"
                pattern="\d+(\.\d{1,6})?"
                required
              />
            </label>
          </Layout.Row>
          <Layout.Row>
            <button className="primary" disabled={send.isPending} type="submit">
              Send OUSD
            </button>
          </Layout.Row>
        </form>
        <p id="transaction" role="status">
          {(() => {
            if (send.isPending) return 'Sending…'
            if (send.data)
              return (
                <>
                  {`Transaction ${send.data.status}: `}
                  {explorer ? (
                    <a
                      href={`${explorer}/tx/${send.data.transactionHash}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {send.data.transactionHash}
                    </a>
                  ) : (
                    send.data.transactionHash
                  )}
                </>
              )
            return problem?.message
          })()}
        </p>
        {problem?.renew ? (
          <>
            <Layout.Row>
              <button
                disabled={renew.isPending}
                onClick={() => renew.mutate()}
                type="button"
              >
                Authorize a new key
              </button>
            </Layout.Row>
            <p role="status">{renew.error?.message}</p>
          </>
        ) : null}
      </Layout.Section>

      <Layout.Section id="sign-heading" title="Sign messages">
        <Layout.Row>
          <button
            disabled={sign.isPending}
            onClick={() => sign.mutate('message')}
            type="button"
          >
            Sign message
          </button>
          <button
            disabled={sign.isPending}
            onClick={() => sign.mutate('typed-data')}
            type="button"
          >
            Sign typed data
          </button>
        </Layout.Row>
        {sign.data ? (
          <dl id={sign.data.kind}>
            <dt>Signed</dt>
            <dd>{sign.data.kind === 'message' ? 'Message' : 'Typed data'}</dd>
            <dt>Verified</dt>
            <dd id={`${sign.data.kind}-verified`}>
              {sign.data.verified ? 'Yes' : 'No'}
            </dd>
            <dt>Signature</dt>
            <dd>
              <code>{sign.data.signature}</code>
            </dd>
          </dl>
        ) : (
          <p id="message-status" role="status">
            {sign.isPending ? 'Signing…' : sign.error?.message}
          </p>
        )}
      </Layout.Section>

      <Mpp.Section apiUrl={apiUrl} payer={payer} sessionKey={key} />
    </>
  )
}

declare namespace Wallet {
  type Props = {
    /** The sign-in, with its access key account and key. */
    authorization: Authorization.Authorization
  }
}

/** Returns a short message for a failure, and whether a new key resolves it. */
function describe(error: Error) {
  if (error instanceof KeyExpiredError)
    return { message: error.message, renew: true }

  // Tempo actions throw a `TempoExecutionError` for a decoded Tempo error. An access key error
  // subclass also carries the details that Viem reads from the chain, such as the remaining limit.
  if (error instanceof TempoExecutionError) {
    if (error.errorName === 'SpendingLimitExceeded') {
      const remaining = (() => {
        if (
          !(
            error instanceof
            TempoActions.accessKey.AccessKeySpendingLimitExceededError
          )
        )
          return ''
        if (error.remaining === undefined || error.decimals === undefined)
          return ''
        const token =
          error.token && isAddressEqual(error.token, ousd) ? ' OUSD' : ''
        return ` ${formatUnits(error.remaining, error.decimals)}${token} remains.`
      })()
      return {
        message: `This send exceeds the access key's limit.${remaining} Send less, or authorize a new key with a higher limit.`,
        renew: true,
      }
    }
    if (error.errorName === 'KeyExpired' || error.errorName === 'KeyNotFound')
      return {
        message: 'The access key expired or was revoked. Authorize a new key.',
        renew: true,
      }
    if (error.errorName === 'CallNotAllowed')
      return {
        message:
          "The access key's scopes do not allow this call. Authorize a new key.",
        renew: true,
      }
    return {
      message: [error.shortMessage, ...error.hints].join(' '),
      renew: false,
    }
  }

  // The node reports a key it does not hold, such as an expired one, only in its message, so Viem
  // decodes no error.
  if (error.message.includes('KeyNotFound'))
    return {
      message: 'The access key expired or was revoked. Authorize a new key.',
      renew: true,
    }
  // Development serves `viem` apart from the prebundled `viem/tempo`, which throws its own copy of
  // `BaseError`, so the page reads the property instead of checking the class.
  if ('shortMessage' in error && typeof error.shortMessage === 'string')
    return { message: error.shortMessage, renew: false }
  return { message: error.message, renew: false }
}

/**
 * `PERMISSIONS`, or the remembered fields. The expiry counts from the call. Tempo ID refuses an
 * empty field with `missing_permissions`.
 */
function permissions() {
  return Defaults.fill(configured ?? PermissionFields.toPermissions(stored()))
}

/** Redirects to Tempo ID's pages to sign in, with the funding hint, if any. */
async function start(options: { funding?: Funding.Funding | undefined } = {}) {
  await Actions.redirect.start(auth, {
    accessKey: permissions(),
    funding: options.funding,
  })
}

/** Keeps the permission fields of `form`. Returns why they are invalid, or `undefined`. */
function remember(form: HTMLFormElement) {
  const fields = PermissionFields.read(new FormData(form))
  if (typeof fields === 'string') return fields
  sessionStorage.setItem(fieldsKey, JSON.stringify(fields))
  return undefined
}

/** Removes a callback's `iss` parameter (RFC 9207) from the URL. */
function removeIssuer() {
  const url = new URL(location.href)
  if (!url.searchParams.has('iss')) return
  url.searchParams.delete('iss')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

/** The remembered fields, or the defaults. */
function stored(): PermissionFields.Fields {
  const value = sessionStorage.getItem(fieldsKey)
  return value ? { ...PermissionFields.empty, ...JSON.parse(value) } : defaults
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
