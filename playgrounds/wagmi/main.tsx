/**
 * A wagmi app with its own sign-in UI and an access key for each sign-in. The Tempo ID instance is
 * the page's wagmi connector, so each sign-in through the instance connects wagmi, and each sign-out
 * disconnects it. The page reads the connection, the balance, and the sends through wagmi's hooks.
 * @module
 */
import { AccessKey, Accounts, Permissions, type Session } from 'accounts'
import type { Funding } from 'accounts/internal'
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Json } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import {
  type FormEvent,
  StrictMode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot } from 'react-dom/client'
import { formatUnits, isAddress, isAddressEqual, parseUnits } from 'viem'
import { verifyMessage, verifyTypedData } from 'viem/actions'
import { Actions as TempoActions, TempoExecutionError } from 'viem/tempo'
import {
  useChains,
  useClient,
  useConnection,
  useDisconnect,
  useSignMessage,
  useSignTypedData,
  WagmiProvider,
} from 'wagmi'
import { Hooks } from 'wagmi/tempo'
import * as Layout from '../web/Layout.tsx'
import * as Mpp from '../web/Mpp.tsx'
import * as Defaults from './Defaults.ts'
import * as FundingFields from './FundingFields.tsx'
import * as PermissionFields from './PermissionFields.tsx'
import { clientId, ousd, tempoId, tempoIdUrl } from './TempoId.ts'

/** The access key expired before a send. */
class KeyExpiredError extends Error {
  override readonly name = 'Transfers.KeyExpiredError'

  constructor() {
    super('The access key expired. Authorize a new key.')
  }
}

const apiUrl = import.meta.env.API_URL ?? 'http://127.0.0.1:5176'

/** The app's name, since Tempo ID returns none to the app's page. */
const appName = 'Wagmi playground'

/**
 * The result of the deposit page that a redirect opened, read once on load before the address bar
 * drops its `deposit_status`.
 */
const returned = tempoId.funding.complete()

/** The message that the page signs. */
const message = 'Sign in to the wagmi playground'

/** Returns the typed data that the page signs, on the chain of the access key. */
function typedData(options: { chainId: number }) {
  return {
    domain: { chainId: options.chainId, name: appName, version: '1' },
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

/** Whether the page load is a callback, read before the instance's completion removes `state`. */
const callback = new URLSearchParams(location.search).has('state')

/** `PERMISSIONS` from the end-to-end tests, which replaces the form. */
const configured = import.meta.env.PERMISSIONS
  ? Permissions.from(Json.parse(import.meta.env.PERMISSIONS))
  : undefined

/**
 * Whether a sign-in authorizes an access key: the tab's `?key=`, kept across redirects, or
 * `VITE_KEY`. Defaults to `true`. A deployed build reads the query, since its settings are fixed.
 */
const key = (() => {
  const requested = new URLSearchParams(location.search).get('key')
  if (requested) sessionStorage.setItem('key', requested)
  return (
    (requested ?? sessionStorage.getItem('key') ?? import.meta.env.VITE_KEY) !==
    'false'
  )
})()

/** The storage key of the form's fields, versioned by their shape. */
const fieldsKey = 'permissions:2'

/** The query key of the session's restore on page load. */
const restoreKey = ['restore'] as const

/** The storage key of whether the signed-in wallet waits for its upgrade, one per app. */
const upgradeKey = `upgrade-available:${clientId}`

// The callback's code redemption starts before the first render. The instance completes one
// redirect for each page load, so wagmi's reconnection and the restore read the same result, and the
// restore handles its refusal.
if (callback) void tempoId.session.get().catch(() => undefined)

/**
 * Returns the instance's session, and renders again at each change. wagmi holds only the connection's
 * address, so the page reads the user, the key, and the tokens here.
 */
function useSession() {
  return useSyncExternalStore(
    tempoId.session.subscribe,
    () => tempoId.session.actor?.getSnapshot().context.session,
  )
}

/**
 * Returns the instance's status, which holds a saved session whose access key expired while the
 * restore renews it.
 */
function useStatus() {
  return useSyncExternalStore(
    tempoId.session.status.subscribe,
    tempoId.session.status.get,
  )
}

function App() {
  const connection = useConnection()
  const disconnect = useDisconnect()
  const session = useSession()
  const sessionStatus = useStatus()
  const [email, setEmail] = useState<string>()
  // Why the permission fields cannot form permissions, until the next sign-in starts.
  const [invalid, setInvalid] = useState<string>()
  // A wallet.tempo passkey without an email, whose `link` the emailed-code sign-in sends back.
  const [linking, setLinking] = useState<string>()
  // Whether passkeys sign in to this app on this page. A refusal with `passkey_not_permitted` hides
  // the button, since every later attempt fails the same way.
  const [passkeys, setPasskeys] = useState(true)
  // Each reset remounts the permission fields, which then read the emptied storage.
  const [resets, setResets] = useState(0)
  // Cancels a pending dialog sign-in from the page.
  const cancel = useRef<AbortController>(undefined)
  // Whether the signed-in wallet waits for its upgrade, which the page then offers.
  const [upgradeAvailable, setUpgradeAvailable] = useState(false)

  // Authorizes a visitor whom Tempo ID already signed in, or returns `null`.
  const authorizeVisitor = async () => {
    try {
      const result = await withAccount(() =>
        tempoId.authorize({ accessKey: permissions() }),
      )
      if (!result) return null
      setUpgradeAvailable(result.upgradeAvailable)
      writeUpgrade(result.upgradeAvailable)
      return result
    } catch (error) {
      // A wallet that waits for its upgrade signs a key only through its passkey, which needs a
      // click, so the page shows the sign-in.
      if (
        error instanceof Accounts.RequestError &&
        error.reason === 'upgrade_required'
      )
        return null
      // An SSO sign-in returns here signed in, and the passkey it linked can own the account. That
      // passkey signs only on a click, so the page signs in without a key and offers one.
      if (
        error instanceof Accounts.RequestError &&
        error.reason === 'webauthn_required'
      )
        return (await tempoId.authorize({ accessKey: false })) ?? null
      throw error
    }
  }

  // Finishes a redirect sign-in, or restores the saved session, or authorizes a visitor already
  // signed in, or returns `null`. Each session that it sets connects wagmi through the connector.
  // The authorization runs inside the restore, so the instance's status shows a saved session whose
  // access key expired until the authorization renews it.
  const restore = useQuery({
    queryFn: async () => {
      // Whether the restore reached the page's own authorization, which returns its own result.
      let authorizing = false
      // A saved session keeps its key across page loads, so a passkey-owned account signs once. A
      // refused redirect, such as a denial on the approval page, throws, and the page shows the
      // sign-in with the refusal.
      const restored = await (async () => {
        try {
          return await tempoId.session.get({
            async reauthorize() {
              authorizing = true
              return (await authorizeVisitor()) ?? undefined
            },
          })
        } finally {
          if (callback) removeIssuer()
        }
      })()
      // The saved flag keeps the Upgrade wallet button after a reload.
      if (!authorizing) setUpgradeAvailable(readUpgrade())
      return restored ?? null
    },
    queryKey: restoreKey,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const redirect = useMutation({
    mutationFn: (funding: Funding.Funding | undefined) =>
      start({ funding, key }),
  })
  // The click handler starts the sign-in, since the dialog's fallback popup opens only within the
  // click.
  // A refusal, such as a denial on the approval page, leaves the page signed out with the refusal.
  const dialog = useMutation({
    mutationFn: (signIn: Promise<Session.Session>) => signIn,
  })
  // Each time the sign-in form shows, the page prefetches the sign-in page's assets, so the page
  // that a redirect or a popup opens loads them from the browser's cache. It prepares the passkey
  // sign-in too, so the passkey button starts the ceremony without a request.
  const prepared = useRef<Prepared | undefined>(undefined)
  useEffect(() => {
    if (restore.isPending || session) return
    // The prefetch never rejects, and the sign-in works without it.
    void tempoId.redirect.prefetch()
    prepared.current = prepare()
  }, [restore.isPending, session])
  const passkey = useMutation({
    mutationFn: async () => {
      // Other fields authorize other permissions, so the click prepares a sign-in of its own.
      if (prepared.current?.fields !== JSON.stringify(stored()))
        prepared.current = prepare()
      try {
        const result = await prepared.current.passkey.signIn()
        return 'step' in result ? result : await upgrade(result)
      } catch (error) {
        // The passkey's one assertion signs in and signs the key, also when it owns the account.
        // Only an account of another passkey refuses it. The session stays, so the page signs in
        // without a key and offers one.
        if (
          error instanceof Accounts.RequestError &&
          error.reason === 'webauthn_required'
        )
          return await tempoId.authorize({ accessKey: false })
        // No realm of the app holds passkeys for this page's origin, such as Tempo Cash's.
        if (
          error instanceof Accounts.RequestError &&
          error.reason === 'passkey_not_permitted'
        ) {
          setPasskeys(false)
          throw new Error(
            'Passkeys cannot sign in to this app on this page. Sign in with your email.',
            { cause: error },
          )
        }
        throw error
      }
    },
    onSuccess: (result) => {
      if (!result) return
      // A wallet.tempo passkey without an email links through the emailed-code sign-in.
      if ('step' in result) return setLinking(result.step.link)
      signedInWith(result)
    },
  })
  const sendCode = useMutation({
    mutationFn: (email: string) => tempoId.email.sendCode({ email }),
    onSuccess: (_, email) => setEmail(email),
  })
  const resendCode = useMutation({
    mutationFn: () => tempoId.email.sendCode({ email: email! }),
  })
  const verifyCode = useMutation({
    mutationFn: async (code: string) => {
      try {
        return await upgrade(
          await tempoId.email.signIn({
            accessKey: permissions(),
            code,
            email: email!,
            link: linking,
          }),
        )
      } catch (error) {
        // The link's passkey signs again with the code, and that assertion signs the key of its
        // account. Only an account of another passkey refuses it. The session stays, so the page
        // signs in without a key and offers one.
        if (
          error instanceof Accounts.RequestError &&
          error.reason === 'webauthn_required'
        )
          return await tempoId.authorize({ accessKey: false })
        throw error
      }
    },
    onSuccess: (result) => {
      if (result) signedInWith(result)
    },
  })
  // wagmi's disconnection signs out through the connector. A session that wagmi has not connected
  // yet signs out through the instance. Either way the instance empties the session even when
  // Tempo ID cannot end it, so the client already stopped signing, and the error still shows.
  const signOut = useMutation({
    mutationFn: async () => {
      writeUpgrade(false)
      if (connection.status === 'connected') await disconnect.mutateAsync()
      else await tempoId.signOut()
    },
    onSettled: () => {
      setEmail(undefined)
      setUpgradeAvailable(false)
      setLinking(undefined)
      dialog.reset()
      resendCode.reset()
      sendCode.reset()
      verifyCode.reset()
    },
  })

  // Shows whether the wallet of a session that a click signed in waits for its upgrade.
  const signedInWith = (result: { upgradeAvailable: boolean }) => {
    setUpgradeAvailable(result.upgradeAvailable)
    writeUpgrade(result.upgradeAvailable)
  }

  // Keeps the permission fields of `form` for the sign-in it starts, or shows why they are invalid.
  const check = (form: HTMLFormElement) => {
    const problem = remember(form)
    setInvalid(problem)
    return !problem
  }

  const checking = restore.isPending || connection.status === 'reconnecting'
  // The page is signed in once wagmi connects the session's account.
  // Empties the remembered fields, and remounts each permissions form, which then reads them.
  const reset = () => {
    sessionStorage.removeItem(fieldsKey)
    setInvalid(undefined)
    setResets((count) => count + 1)
  }

  const signedIn =
    connection.status === 'connected' && connection.address && session
      ? { address: connection.address, session }
      : undefined
  // A session that wagmi does not connect yet, such as one without a key whose account the
  // connector reads first.
  const connecting = !checking && !signedIn && session !== undefined
  const starting =
    passkey.isPending ||
    dialog.isPending ||
    redirect.isPending ||
    sendCode.isPending
  const error = [
    restore,
    dialog,
    passkey,
    redirect,
    sendCode,
    resendCode,
    verifyCode,
    signOut,
  ].find((state) => state.error)?.error
  const pending = (() => {
    if (sendCode.isPending) return 'Sending a code…'
    if (resendCode.isPending) return 'Sending a new code…'
    if (passkey.isPending) return 'Waiting for your passkey…'
    if (dialog.isPending) return 'Continue in the Tempo ID dialog…'
    if (redirect.isPending) return 'Opening Tempo ID…'
    if (verifyCode.isPending) return 'Signing in…'
    if (signOut.isPending) return 'Signing out…'
    return undefined
  })()
  const status =
    pending ??
    invalid ??
    error?.message ??
    (resendCode.isSuccess ? `A new code was sent to ${email}.` : undefined)

  return (
    <Layout.Page title={appName}>
      <p className="muted">
        wagmi{' '}
        <span className="badge" id="status">
          {connection.status}
        </span>
      </p>
      {sessionStatus.status === 'reauthorizing' ? (
        <p aria-live="polite">
          Signed in as {sessionStatus.session.user.email}. Renewing your access
          key…
        </p>
      ) : null}
      {connecting ? (
        <Layout.Section id="connecting" title="Connecting">
          <p>Connecting your Tempo Account…</p>
          <Layout.Row>
            <button
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              type="button"
            >
              Sign out
            </button>
          </Layout.Row>
        </Layout.Section>
      ) : null}

      {/* A refused authorization on load shows its error beside the sign-in, so the user can sign in again. */}
      {!checking && !signedIn && !connecting && !email ? (
        <>
          <Layout.Section
            description={
              linking
                ? 'Sign in with your email to link this passkey.'
                : 'Sign in to continue.'
            }
            id="sign-in"
            title="Sign in"
          >
            <ul className="steps">
              <li>
                <strong>Headless API:</strong> an emailed code or a passkey, on
                this page.
              </li>
              {linking ? null : (
                <li>
                  <strong>OAuth:</strong> Tempo ID's own sign-in, in a dialog or
                  a redirect.
                </li>
              )}
            </ul>
          </Layout.Section>

          <Layout.Section id="headless" title="Headless API">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!check(event.currentTarget)) return
                // A failed redirect or passkey keeps its error, which would otherwise hide this flow's.
                passkey.reset()
                dialog.reset()
                redirect.reset()
                sendCode.mutate(
                  String(new FormData(event.currentTarget).get('email')),
                )
              }}
            >
              <label htmlFor="email">Email</label>
              <div className="row">
                <input
                  autoComplete="email"
                  className="grow"
                  id="email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                />
                <button className="primary" disabled={starting} type="submit">
                  Sign in
                </button>
              </div>
              {/* A passkey waiting to link links only through the emailed code, so other sign-ins wait. */}
              {linking || !passkeys ? null : (
                <>
                  <p aria-hidden="true" className="divider">
                    or
                  </p>
                  <Layout.Row>
                    <button
                      disabled={starting}
                      onClick={(event) => {
                        if (!check(event.currentTarget.form!)) return
                        dialog.reset()
                        redirect.reset()
                        passkey.mutate()
                      }}
                      type="button"
                    >
                      Continue with passkey
                    </button>
                  </Layout.Row>
                </>
              )}
              <PermissionsPanel onReset={reset} resets={resets} />
            </form>
          </Layout.Section>

          {linking ? null : (
            <Layout.Section id="oauth" title="OAuth">
              <form onSubmit={(event) => event.preventDefault()}>
                <Layout.Row>
                  <button
                    disabled={starting}
                    onClick={(event) => {
                      if (!check(event.currentTarget.form!)) return
                      passkey.reset()
                      redirect.reset()
                      cancel.current = new AbortController()
                      dialog.mutate(
                        tempoId.dialog.signIn({
                          accessKey: key ? permissions() : false,
                          signal: cancel.current.signal,
                        }),
                      )
                    }}
                    type="button"
                  >
                    Sign in via dialog
                  </button>
                  <button
                    disabled={starting}
                    onClick={(event) => {
                      if (!check(event.currentTarget.form!)) return
                      passkey.reset()
                      dialog.reset()
                      redirect.mutate(
                        FundingFields.read(
                          new FormData(event.currentTarget.form!),
                        ),
                      )
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
                  <summary>Funding hint, for the redirect</summary>
                  <FundingFields.Form chainId={tempoId.config.chainId} />
                </details>
                <PermissionsPanel onReset={reset} resets={resets} />
              </form>
            </Layout.Section>
          )}
        </>
      ) : null}

      {!checking && !signedIn && !connecting && email ? (
        <Layout.Section id="code-step" title="Enter the code">
          <form onSubmit={field('code', verifyCode.mutate)}>
            <p>Enter the code sent to {email}.</p>
            <label htmlFor="code">Code</label>
            <input
              autoComplete="one-time-code"
              id="code"
              inputMode="numeric"
              name="code"
              required
            />
            <Layout.Row>
              <button
                className="primary"
                disabled={verifyCode.isPending}
                type="submit"
              >
                Sign in
              </button>
              <button
                disabled={verifyCode.isPending || resendCode.isPending}
                onClick={() => {
                  verifyCode.reset()
                  resendCode.mutate()
                }}
                type="button"
              >
                Resend code
              </button>
              <button
                disabled={verifyCode.isPending}
                onClick={() => {
                  setEmail(undefined)
                  resendCode.reset()
                  sendCode.reset()
                  verifyCode.reset()
                }}
                type="button"
              >
                Use a different email
              </button>
            </Layout.Row>
          </form>
        </Layout.Section>
      ) : null}

      {signedIn ? (
        <SignedIn
          address={signedIn.address}
          onUpgrade={() => {
            setUpgradeAvailable(false)
            // The saved flag drops too, so a reload shows no Upgrade wallet.
            writeUpgrade(false)
          }}
          session={signedIn.session}
          upgradeAvailable={upgradeAvailable}
          onSignOut={() => signOut.mutate()}
          signingOut={signOut.isPending}
        />
      ) : null}

      <p aria-live="polite" role="status">
        {status}
      </p>
    </Layout.Page>
  )
}

/**
 * Shows the signed-in user, the connected Tempo Account, and the session's details, and the sections
 * that fund the account and pay, sign, and call MPP endpoints through wagmi with its access key.
 */
function SignedIn(props: SignedIn.Props) {
  const { key, user } = props.session
  const queryClient = useQueryClient()
  // Tempo ID reads the app's account for the user, and its realm, whether or not the sign-in
  // authorized a key.
  const tempoAccount = useQuery({
    // A query holds no `undefined`, so a user without an account in the app's realms reads `null`.
    queryFn: async () => (await tempoId.account.get()) ?? null,
    queryKey: ['account', user.id],
  })
  // The default realm goes unnamed, so only a named realm, such as Tempo Cash, shows.
  const realm =
    tempoAccount.data?.realm.id === 'default'
      ? undefined
      : tempoAccount.data?.realm
  const api = useMutation({
    mutationFn: async () => {
      // An access token lasts 5 minutes, so a page left open refreshes it first. The refresh token
      // rotates, so the instance saves the new one, and the page reads it from the session.
      const tokens = await (async () => {
        const current = props.session
        if (current.expiresAt - 30_000 > Date.now()) return current
        return (await tempoId.session.refresh()) ?? current
      })()
      const response = await fetch(new URL('/me', apiUrl), {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      })
      return JSON.stringify(await response.json(), null, 2)
    },
  })

  // The dialog shows the approval page on this page, which shows the key and signs it on approval.
  // The instance's store holds the new session, which the page and the connector read.
  const authorize = useMutation({
    mutationFn: () => tempoId.dialog.signIn({ accessKey: permissions() }),
  })
  const hasPasskey = tempoAccount.data?.keys.some(
    (entry) => entry.type === 'webAuthn',
  )
  // Two prompts: the authenticator creates the passkey, then the new passkey signs Tempo ID's proof.
  const addPasskey = useMutation({
    mutationFn: () => tempoId.passkey.register(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['account', user.id] }),
  })
  // A sign-in upgrades a wallet.tempo passkey's wallet, unless it ran on page load or the user
  // canceled the upgrade's prompt. Then the wallet upgrades on a click, and keeps the key.
  const walletUpgrade = useMutation({
    mutationFn: () => tempoId.account.upgrade(),
    onSuccess: props.onUpgrade,
  })

  return (
    <>
      <Layout.Section id="account-heading" title="Account">
        <dl>
          <dt>Email</dt>
          <dd id="who">{user.email}</dd>
          <dt>Tempo Account</dt>
          <dd>
            <span id="account">{props.address}</span>
            {realm ? (
              <>
                {' in '}
                <span id="realm">{realm.name}</span>
              </>
            ) : null}
          </dd>
          <dt>Access key</dt>
          <dd>
            {key
              ? KeyAuthorization.fromRpc(key.keyAuthorization).address
              : 'None'}
          </dd>
        </dl>
        {key && props.upgradeAvailable ? (
          <>
            <p className="warning">
              Your wallet waits for its upgrade. The upgrade keeps this key.
            </p>
            <Layout.Row>
              <button
                disabled={walletUpgrade.isPending}
                onClick={() => walletUpgrade.mutate()}
                type="button"
              >
                Upgrade wallet
              </button>
            </Layout.Row>
            <p id="upgrade" role="status">
              {walletUpgrade.isPending
                ? 'Upgrading your wallet…'
                : walletUpgrade.error?.message}
            </p>
          </>
        ) : null}
        {key ? null : (
          <>
            <p>Signed in without an access key.</p>
            {/* The read creates an account where a Privy app can own it, as the approval does. */}
            {tempoAccount.data ? (
              <Layout.Row>
                <button
                  className="primary"
                  disabled={authorize.isPending}
                  onClick={() => authorize.mutate()}
                  type="button"
                >
                  Authorize an access key
                </button>
              </Layout.Row>
            ) : null}
            <p role="status">{authorize.error?.message}</p>
          </>
        )}
        <Layout.Row>
          <button
            disabled={api.isPending}
            onClick={() => api.mutate()}
            type="button"
          >
            Call the API
          </button>
          {/* An account that a passkey already owns offers no second one. */}
          {hasPasskey ? null : (
            <button
              disabled={addPasskey.isPending}
              onClick={() => addPasskey.mutate()}
              type="button"
            >
              Add passkey
            </button>
          )}
          <button
            disabled={props.signingOut}
            onClick={props.onSignOut}
            type="button"
          >
            Sign out
          </button>
        </Layout.Row>
        <pre id="api">
          {api.isPending ? 'Calling…' : (api.data ?? api.error?.message)}
        </pre>
        <p id="passkey" role="status">
          {(() => {
            if (addPasskey.isPending) return 'Waiting for your passkey…'
            if (addPasskey.data)
              return `Passkey added. It owns ${addPasskey.data.address}.`
            return addPasskey.error?.message
          })()}
        </p>
        <details>
          <summary>Session details</summary>
          {key ? <KeyDetails sessionKey={key} /> : null}
          <pre>
            {Json.stringify(
              {
                // The tokens stay out of the page.
                accessKey: key
                  ? {
                      account: key.account,
                      chainId: key.chainId,
                      keyAuthorization: key.keyAuthorization,
                    }
                  : null,
                account: tempoAccount.data ?? null,
                expiresAt: new Date(props.session.expiresAt).toISOString(),
                user,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </Layout.Section>

      {key ? (
        <Wallet address={props.address} sessionKey={key} />
      ) : (
        <Layout.Section id="fund-heading" title="Fund account">
          <Deposit />
        </Layout.Section>
      )}
    </>
  )
}

declare namespace SignedIn {
  type Props = {
    /** The account that wagmi connects. */
    address: `0x${string}`
    /** Disconnects wagmi, which signs out of Tempo ID and the app. */
    onSignOut: () => void
    /** Marks the wallet upgraded. */
    onUpgrade: () => void
    /** The session, with its access key if the sign-in authorized one. */
    session: Session.Session
    /** Whether a sign-out is pending. */
    signingOut: boolean
    /** Whether the wallet waits for its upgrade. */
    upgradeAvailable: boolean
  }
}

/** Lists the chain, expiry, and limits of the session's access key. */
function KeyDetails(props: KeyDetails.Props) {
  const { chainId, expiry, limits } = KeyAuthorization.fromRpc(
    props.sessionKey.keyAuthorization,
  )
  const chain = useChains().find((entry) => entry.id === Number(chainId))

  return (
    <dl id="key">
      <dt>Chain</dt>
      <dd>{chain ? `${chainId} (${chain.name})` : String(chainId)}</dd>
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
    /** The session's access key. */
    sessionKey: AccessKey.AccessKey
  }
}

/**
 * Opens Tempo ID's deposit page for the session's account, in a popup or through a redirect, which
 * returns to the page's origin with the result. A popup's result resolves the mutation.
 */
function Deposit(props: Deposit.Props) {
  const deposit = useMutation({
    // The deposit funds the access key's chain, where the page reads and sends.
    mutationFn: (mode: 'popup' | 'redirect') =>
      tempoId.funding.open({ chainId: props.chainId, mode }),
    onSuccess: () => props.onDeposit?.(),
  })
  const result = deposit.data ?? returned

  return (
    <>
      <Layout.Row>
        <button
          className="primary"
          disabled={deposit.isPending}
          onClick={() => deposit.mutate('popup')}
          type="button"
        >
          Deposit via popup
        </button>
        <button
          disabled={deposit.isPending}
          onClick={() => deposit.mutate('redirect')}
          type="button"
        >
          Deposit via redirect
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
    </>
  )
}

declare namespace Deposit {
  type Props = {
    /** The chain to fund. Absent for the page's own chain. */
    chainId?: number | undefined
    /** Runs after the deposit page returns, such as to read the balance again. Absent for none. */
    onDeposit?: (() => void) | undefined
  }
}

/**
 * Shows the balance and funds the Tempo Account, sends OUSD, signs a message and typed data, and pays
 * MPP endpoints, each through wagmi with the session's access key.
 */
function Wallet(props: Wallet.Props) {
  const key = props.sessionKey
  const account = props.address
  // Sends and reads go to the key's chain, which the permissions can set apart from the page's.
  // wagmi sends only on the connection's chain, so a key on another chain reads and deposits only.
  const chainId = Number(KeyAuthorization.fromRpc(key.keyAuthorization).chainId)
  const chain = useChains().find((entry) => entry.id === chainId)
  const explorer = chain?.blockExplorers?.default.url
  // The key chain's client, without an account, which verifies the signatures on chain.
  const client = useClient({ chainId })
  // Why the send form's values cannot send, until the next send.
  const [invalid, setInvalid] = useState<Error>()

  // The read waits for a deposit, a send, or a click, since a page whose browser cannot reach the
  // chain logs an error for each read.
  const balance = Hooks.token.useGetBalance({
    account,
    chainId,
    query: { enabled: false },
    token: ousd,
  })
  // The connector's Viem client signs with the access key, and attaches the key's authorization to
  // its first transaction. The transfer resolves with its receipt, after which the balance changes.
  const send = Hooks.token.useTransferSync({
    mutation: { onSuccess: () => balance.refetch() },
  })
  // The connector signs through the instance: as the account's owner until the chain holds the
  // access key, and then with the access key. A verifier reads the access key's state on the chain.
  const signMessage = useSignMessage()
  const signTypedData = useSignTypedData()
  const sign = useMutation({
    mutationFn: async (kind: 'message' | 'typed-data') => {
      if (!client) throw new Error('wagmi holds no client for the chain.')
      const data = typedData({ chainId })
      const signature = await (kind === 'message'
        ? signMessage.mutateAsync({ message })
        : signTypedData.mutateAsync(data))
      const verified = await (kind === 'message'
        ? verifyMessage(client, {
            address: account,
            message,
            mode: 'allowAccessKey',
            signature,
          })
        : verifyTypedData(client, {
            ...data,
            address: account,
            mode: 'allowAccessKey',
            signature,
          }))
      // An access key signs in a keychain envelope, and the owner in any other.
      const signer =
        SignatureEnvelope.deserialize(signature).type === 'keychain'
          ? 'Access key'
          : 'Owner'
      return { kind, signature, signer, verified }
    },
  })
  // The dialog shows the approval page on this page, which signs a new key for the remembered
  // permissions.
  const renew = useMutation({
    mutationFn: () => tempoId.dialog.signIn({ accessKey: permissions() }),
  })

  const sendError = invalid ?? send.error ?? undefined
  const problem = sendError ? describe(sendError) : undefined

  return (
    <>
      <Layout.Section id="fund-heading" title="Fund account">
        <p>
          Balance{' '}
          <strong id="balance">
            {(() => {
              if (balance.isFetching) return 'Reading…'
              if (balance.data !== undefined)
                return `${Number(balance.data.formatted).toLocaleString('en-US', { maximumFractionDigits: 6 })} OUSD`
              if (balance.error) return describe(balance.error).message
              return 'Not read'
            })()}
          </strong>
        </p>
        <Layout.Row>
          <Deposit chainId={chainId} onDeposit={() => void balance.refetch()} />
          <button
            disabled={balance.isFetching}
            // `refetch` resolves with the error instead of rejecting, so nothing awaits it.
            onClick={() => void balance.refetch()}
            type="button"
          >
            Refresh balance
          </button>
        </Layout.Row>
      </Layout.Section>

      <Layout.Section id="send-heading" title="Send payments">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send.reset()
            const form = new FormData(event.currentTarget)
            const problem = (() => {
              const to = String(form.get('recipient'))
              if (!isAddress(to))
                return new Error('Enter the recipient as an address.')
              // OUSD has 6 decimals.
              const amount = parseUnits(String(form.get('amount')), 6)
              if (amount <= 0n) return new Error('Enter an amount above 0.')
              if (AccessKey.expired(key)) return new KeyExpiredError()
              send.mutate({ amount, chainId, to, token: ousd })
              return undefined
            })()
            setInvalid(problem)
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
            if (problem) return problem.message
            if (send.isPending) return 'Sending…'
            if (!send.data) return undefined
            const { receipt } = send.data
            return (
              <>
                {`Transaction ${receipt.status}: `}
                {explorer ? (
                  <a
                    href={`${explorer}/tx/${receipt.transactionHash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {receipt.transactionHash}
                  </a>
                ) : (
                  receipt.transactionHash
                )}
              </>
            )
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
            <dt>Signer</dt>
            <dd id={`${sign.data.kind}-signer`}>{sign.data.signer}</dd>
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

      {/* The mpp plugin pays only on the viem plugin's chains, whose chains wagmi holds too. */}
      {chain ? (
        <Mpp.Section apiUrl={apiUrl} payer={tempoId.mpp} sessionKey={key} />
      ) : null}
    </>
  )
}

declare namespace Wallet {
  type Props = {
    /** The account that wagmi connects, which the key signs for. */
    address: `0x${string}`
    /** The session's access key. */
    sessionKey: AccessKey.AccessKey
  }
}

/**
 * The folded permission fields of one sign-in form, which start from the remembered fields. Each
 * sign-in remembers the fields of its own form.
 */
function PermissionsPanel(props: PermissionsPanel.Props) {
  return (
    <details>
      <summary>Permissions</summary>
      <fieldset
        aria-label="Permissions"
        disabled={Boolean(configured)}
        key={props.resets}
      >
        <p className="muted">
          {configured
            ? 'Set by PERMISSIONS.'
            : "Empty fields use Tempo ID's defaults."}
        </p>
        <PermissionFields.Form
          chainId={tempoId.config.chainId}
          defaultValue={stored()}
          disabled={Boolean(configured)}
          tempoIdUrl={tempoIdUrl}
        />
        {configured ? null : (
          <Layout.Row>
            <button onClick={props.onReset} type="button">
              Reset permissions
            </button>
          </Layout.Row>
        )}
      </fieldset>
    </details>
  )
}

declare namespace PermissionsPanel {
  type Props = {
    /** Empties the remembered fields. */
    onReset: () => void
    /** The count of resets, whose change remounts the fields. */
    resets: number
  }
}

/** Returns a short message for a failure, and whether a new key resolves it. */
function describe(error: Error) {
  if (error instanceof KeyExpiredError)
    return { message: error.message, renew: true }

  // Tempo actions throw a `TempoExecutionError` for a decoded Tempo error, which wagmi's errors hold
  // as a cause. An access key error subclass also carries the details that Viem reads from the
  // chain, such as the remaining limit.
  const decoded = (() => {
    let current: unknown = error
    while (current instanceof Error) {
      if (current instanceof TempoExecutionError) return current
      current = current.cause
    }
    return undefined
  })()
  if (decoded) {
    if (decoded.errorName === 'SpendingLimitExceeded') {
      const remaining = (() => {
        if (
          !(
            decoded instanceof
            TempoActions.accessKey.AccessKeySpendingLimitExceededError
          )
        )
          return ''
        if (decoded.remaining === undefined || decoded.decimals === undefined)
          return ''
        const token =
          decoded.token && isAddressEqual(decoded.token, ousd) ? ' OUSD' : ''
        return ` ${formatUnits(decoded.remaining, decoded.decimals)}${token} remains.`
      })()
      return {
        message: `This send exceeds the access key's limit.${remaining} Send less, or authorize a new key with a higher limit.`,
        renew: true,
      }
    }
    if (
      decoded.errorName === 'KeyExpired' ||
      decoded.errorName === 'KeyNotFound'
    )
      return {
        message: 'The access key expired or was revoked. Authorize a new key.',
        renew: true,
      }
    if (decoded.errorName === 'CallNotAllowed')
      return {
        message:
          "The access key's scopes do not allow this call. Authorize a new key.",
        renew: true,
      }
    return {
      message: [decoded.shortMessage, ...decoded.hints].join(' '),
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

/** A prepared passkey sign-in, with the fields whose permissions it authorizes. */
type Prepared = {
  /** The remembered fields, as JSON, when the page prepared the sign-in. */
  fields: string
  /** The sign-in's handle. */
  passkey: ReturnType<typeof tempoId.passkey.prepare>
}

/** Prepares the passkey sign-in of the remembered fields. */
function prepare(): Prepared {
  return {
    fields: JSON.stringify(stored()),
    passkey: tempoId.passkey.prepare({ accessKey: permissions() }),
  }
}

/**
 * `PERMISSIONS`, or the remembered fields, with the playgrounds' own for what they leave out. The
 * expiry counts from the call.
 */
function permissions() {
  return Defaults.fill(configured ?? PermissionFields.toPermissions(stored()))
}

/**
 * Upgrades the wallet of a sign-in whose account can upgrade, in the click that signed in, and
 * returns the sign-in with `upgradeAvailable` false. A refused upgrade, such as a canceled prompt,
 * returns it unchanged, and the page offers the upgrade on a click.
 */
async function upgrade<
  const result extends Session.Session & { upgradeAvailable: boolean },
>(result: result): Promise<result> {
  if (!result.upgradeAvailable) return result
  // The upgrade registers the session's key first, so the key keeps working.
  const upgraded = await tempoId.account.upgrade().then(
    () => true,
    () => false,
  )
  return upgraded ? { ...result, upgradeAvailable: false } : result
}

/** Returns whether the signed-in wallet waits for its upgrade, as the page saved it. */
function readUpgrade() {
  return localStorage.getItem(upgradeKey) === 'true'
}

/** Saves whether the signed-in wallet waits for its upgrade, for the next page load. */
function writeUpgrade(value: boolean) {
  if (value) localStorage.setItem(upgradeKey, 'true')
  else localStorage.removeItem(upgradeKey)
}

/**
 * Runs `fn`. If `authorize` refuses with `rejected`, as for a new user without a Tempo Account, the
 * page creates the account and authorizes again.
 */
async function withAccount<result>(fn: () => Promise<result>) {
  try {
    return await fn()
  } catch (error) {
    if (
      !(error instanceof Accounts.RequestError && error.reason === 'rejected')
    )
      throw error
    // No account to create, such as in a realm without a Privy app, leaves the refusal as it was.
    if (!(await tempoId.account.get())) throw error
    return await tempoId.authorize({ accessKey: permissions() })
  }
}

/**
 * Redirects to Tempo ID's pages with the funding hint, if any, and requests a key if `key` is set.
 */
async function start(options: {
  funding?: Funding.Funding | undefined
  key: boolean
}) {
  await tempoId.redirect.signIn({
    accessKey: options.key ? permissions() : false,
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

/** The remembered fields, or none. */
function stored(): PermissionFields.Fields {
  const fields = sessionStorage.getItem(fieldsKey)
  return { ...PermissionFields.empty, ...(fields ? JSON.parse(fields) : {}) }
}

/** Returns a form handler that calls `action` with the field `name`. */
function field(name: string, action: (value: string) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    action(String(new FormData(event.currentTarget).get(name)))
  }
}

document.title = appName
// The page sends no `Cross-Origin-Opener-Policy`, so Tempo ID's page in a popup posts the callback to
// the tab that opened it, and the page needs no `dialog.callback()`. wagmi's provider reconnects the
// instance's saved session as it mounts.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={tempoId.wagmi}>
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
