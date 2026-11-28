/**
 * The shared part of the web test app's pages: the options and the plugins of each page's instance,
 * which the page creates with its own sign-in plugin, and the page's controls. Each control runs one
 * action of the instance, and shows its outcome as JSON, so a spec starts an action with a click and
 * reads what it returned or threw. The "Send OUSD" form sends one transfer, and the "Send calls" form
 * sends the calls of its field as one transaction, in the fee token of its second field, with the
 * transaction's other fields of its third field, as `ox`'s `Json` writes them.
 *
 * The build reads its client ID from `VITE_CLIENT_ID`, the URL of the MPP test app from
 * `VITE_MPP_URL`, Tempo ID's URL from `VITE_TEMPO_ID_URL`, and the node's RPC URL from
 * `VITE_TEMPO_RPC_URL`, which `test/Apps.ts` sets. The page's query sets the options that a spec
 * varies:
 *
 * | Parameter          | Effect                                                                          |
 * | ------------------ | ------------------------------------------------------------------------------- |
 * | `accessKey`        | The permissions of each access key, as `ox`'s `Json` writes them, or `false`    |
 * | `chains`           | On `/chains/`, the IDs of the chains that the instance serves, with commas      |
 * | `challenge`        | A message that the page's "Sign in" and "Authorize" controls sign               |
 * | `clientId`         | Another app of `Apps.registrations`, in place of the build's                    |
 * | `deposit`          | The options of the "Deposit" and "Preload the deposit page" controls, as JSON   |
 * | `dpop=1`           | A DPoP key binds the tokens. `Dpop.ts` keeps the key between page loads         |
 * | `expiry`           | The expiry of each access key, such as `10s`. Defaults to `1d`                  |
 * | `funding`          | The amount that the page's "Sign in" control needs in the account, as JSON      |
 * | `hint=1`           | The instance keeps the session hint in the `tempo_session` cookie               |
 * | `instanceResource` | The registered resource that the instance names for each request                |
 * | `loginHint`        | The address that the dialog page's sign-in fills in Tempo ID's email field      |
 * | `message`          | The message that each "Sign a message" control signs                            |
 * | `reauthorize=0`    | `useSession` authorizes no Tempo ID session of the browser at a mount           |
 * | `reauthorize=1`    | `useSession` authorizes the Tempo ID session at a mount, also on a local store  |
 * | `resource`         | The registered resource that the tokens of the "Sign in" control are for        |
 * | `retry=0`          | The Viem client shows no screen for a refused transaction, and rejects the call |
 * | `scope`            | The scopes beyond the instance's that the tokens of "Sign in" hold              |
 * | `second=1`         | On `/wagmi/`, the connector's config also holds the second node's chain         |
 * | `signInKey=1`      | On `/redirect/`, only "Sign in" names the access key, not the instance          |
 * | `store=memory`     | The instance keeps its session in `Store.memory`, which only its page holds     |
 * | `typedData`        | The typed data that "Sign typed data as the owner" signs, as `Json` writes it   |
 *
 * With `accessKey=false`, the page's "Sign in" and "Authorize" controls request no access key.
 * @module
 */
import {
  Accounts,
  type Permissions,
  type Plugin,
  type Session,
  Store,
} from 'accounts'
import * as Internal from 'accounts/internal'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { Json } from 'ox'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { http, parseUnits, type TypedDataDefinition } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import * as Dpop from './Dpop.js'

/**
 * One action of a page: the name of its control, and the call, whose result the page shows. The call
 * receives the values of the page's fields, by label.
 */
export type Actions = Readonly<
  Record<string, (fields: Fields) => Promise<unknown>>
>

/** One call of the "Send calls" form, as a `.call` of a `viem/tempo` action returns it. */
type Call = {
  /** The call's data: the selector and the arguments. */
  data: `0x${string}`
  /** The contract that receives the call. */
  to: `0x${string}`
}

/** The values of a page's fields, by label. */
export type Fields = Readonly<Record<string, string>>

/** The outcome of an action: `pending` while it runs, then what it returned or threw. */
type Outcome = {
  /** Whether the action runs, returned, or threw. */
  state: 'fulfilled' | 'pending' | 'rejected'
  /** The result, or the error's fields, as JSON. Empty while the action runs. */
  text: string
}

/** The members of a page's instance that the shared controls call. */
export type Instance = Pick<
  Accounts.Accounts<Plugin.Flatten<ReturnType<typeof plugins>>>,
  | 'accessKey'
  | 'account'
  | 'chain'
  | 'config'
  | 'funding'
  | 'session'
  | 'signOut'
  | 'token'
  | 'useSession'
  | 'viem'
>

/** The limit that each update of an access key sets: 50 OUSD. */
export const limit = {
  limit: parseUnits('50', 6),
  token: Addresses.ousd,
} as const

/** The page's query, which sets the options that a spec varies. */
export const query = new URLSearchParams(window.location.search)

/** Tempo ID's URL. */
export const url: string = import.meta.env.VITE_TEMPO_ID_URL

/**
 * Returns what a spec reads of `session`: its user, its expiry, and its access key. Each token shows
 * as the first bytes of its SHA-256 hash, so a spec compares tokens, and the proof holds none.
 */
export async function describe(session: Session.Session | undefined) {
  if (!session) return null
  const [accessToken, refreshToken] = await Promise.all([
    fingerprint(session.accessToken),
    session.refreshToken ? fingerprint(session.refreshToken) : null,
  ])
  return {
    accessToken,
    address: session.address ?? null,
    challengeSignature: session.challengeSignature ?? null,
    email: session.user.email,
    expiresAt: session.expiresAt,
    key: session.accessKey
      ? {
          account: session.accessKey.account,
          chainId: session.accessKey.chainId,
          expiry:
            Number(session.accessKey.keyAuthorization.expiry ?? 0) || null,
          id: session.accessKey.keyAuthorization.keyId,
        }
      : null,
    refreshToken,
  }
}

/**
 * Returns the options of the page's deposit controls, which the page's query sets: the amount, the
 * token, the mode, and the redirect URI. Defaults to none.
 */
export function deposit(): NonNullable<
  Parameters<Instance['funding']['open']>[0]
> {
  const deposit = query.get('deposit')
  return deposit ? JSON.parse(deposit) : {}
}

/** Returns the first 8 bytes of the SHA-256 hash of `value`, as hex. */
export async function fingerprint(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(hash).subarray(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Returns the funding hint of a sign-in that the page's query sets: the amount that the app needs in
 * the Tempo Account. Defaults to none.
 */
export function funding() {
  const funding = query.get('funding')
  return funding ? { funding: Internal.Funding.from(JSON.parse(funding)) } : {}
}

/**
 * Returns the `loginHint` of a dialog sign-in that the page's query sets: the address that Tempo ID's
 * sign-in fills in its email field. Defaults to none.
 */
export function loginHint() {
  const loginHint = query.get('loginHint')
  return loginHint ? { loginHint } : {}
}

/**
 * Returns the message of the page's query once the window receives the event
 * `test-app-web:message`, and rejects at the event `test-app-web:refusal`, as a request to an app's
 * backend does. The dialog covers the page while it waits, so a spec dispatches the event. Once
 * `signal` aborts, the document holds `data-message-signal="aborted"`.
 */
export function issue(signal: AbortSignal) {
  signal.addEventListener(
    'abort',
    () => {
      document.documentElement.dataset.messageSignal = 'aborted'
    },
    { once: true },
  )
  return new Promise<string>((resolve, reject) => {
    window.addEventListener('test-app-web:message', () => resolve(message()), {
      once: true,
    })
    window.addEventListener(
      'test-app-web:refusal',
      () => reject(new Error('The page issued no message.')),
      { once: true },
    )
  })
}

/** Returns the message that each "Sign a message" control signs, which the page's query sets. */
export function message() {
  return query.get('message') ?? 'Sign in to the web test app'
}

/** Renders the page: the session's status, the page's own controls, and the shared controls. */
export function mount(accounts: Instance, options: mount.Options) {
  createRoot(document.getElementById('root')!, {
    // The boundary shows the error, so React logs none to the console.
    onCaughtError: () => {},
  }).render(
    <React.StrictMode>
      <Boundary>
        <App
          accounts={accounts}
          actions={options.actions}
          fields={options.fields ?? []}
        />
      </Boundary>
    </React.StrictMode>,
  )
}

export declare namespace mount {
  type Options = {
    /** The actions of the page's own controls, by label. */
    actions: Actions
    /** The labels of the page's fields, whose values each action receives. Defaults to none. */
    fields?: readonly string[] | undefined
  }
}

/**
 * Returns the options of each page's instance, on the suite's node. Each sign-in requests the access
 * key of the page's query, or one that sends up to 100 OUSD until the query's expiry.
 */
export async function options() {
  const accessKey = query.get('accessKey')
  return {
    accessKey: () =>
      accessKey && accessKey !== 'false'
        ? (Json.parse(accessKey) as Permissions.Permissions)
        : permissions({ limit: '100' }),
    chain: tempoLocalnet.id,
    clientId: query.get('clientId') ?? import.meta.env.VITE_CLIENT_ID,
    ...(query.get('dpop') === '1' ? { dpop: await Dpop.load() } : {}),
    ...(query.get('hint') === '1' ? { hint: { cookie: true as const } } : {}),
    ...(query.get('instanceResource')
      ? { resource: query.get('instanceResource')! }
      : {}),
    ...(query.get('store') === 'memory' ? { store: Store.memory() } : {}),
    url,
  } satisfies Accounts.create.Options
}

/** Returns the permissions of an access key that sends up to `limit` OUSD until the query's expiry. */
export function permissions(
  options: permissions.Options,
): Permissions.Permissions {
  return {
    expiry: (query.get('expiry') as Permissions.Duration | null) ?? '1d',
    limits: [{ limit: options.limit, token: 'ousd' }],
  }
}

export declare namespace permissions {
  type Options = {
    /** The OUSD that the access key may send, as a decimal string. */
    limit: `${number}`
  }
}

/** Returns the plugins that each page adds after its sign-in plugin: `react` and `viem`. */
export function plugins() {
  return [
    react(
      query.has('reauthorize')
        ? { reauthorizeOnMount: query.get('reauthorize') !== '0' }
        : {},
    ),
    viem({
      chain: tempoLocalnet,
      ...(query.get('retry') === '0' ? { retry: false } : {}),
      transport: http(import.meta.env.VITE_TEMPO_RPC_URL),
    }),
  ] as const
}

/**
 * Returns the request items of a sign-in that the page's query sets: the challenge, the access key
 * or `false` in place of it, and the resource and the scopes that the tokens are for.
 */
export function request() {
  const challenge = query.get('challenge')
  const resource = query.get('resource')
  const scope = query.get('scope')
  return {
    ...(query.get('accessKey') === 'false'
      ? { accessKey: false as const }
      : {}),
    ...(query.get('signInKey') === '1'
      ? { accessKey: permissions({ limit: '100' }) }
      : {}),
    ...(challenge ? { challenge } : {}),
    ...(resource ? { resource } : {}),
    ...(scope ? { scope } : {}),
  }
}

/**
 * Shows the outcome of the action `name` as an output that a spec reads: its state as `data-state`,
 * and its text. The output of `Proof` is hidden, so no screenshot holds a token.
 */
export function Result(props: Result.Props) {
  const { name, outcome } = props
  return (
    <output
      data-action={name}
      data-state={outcome?.state ?? 'idle'}
      hidden={name === 'Proof'}
    >
      {outcome?.text}
    </output>
  )
}

export declare namespace Result {
  type Props = {
    /** The action's name. */
    name: string
    /** The action's outcome, or `undefined` before its first run. */
    outcome: Outcome | undefined
  }
}

/**
 * Returns a signal that aborts when the window receives the event `test-app-web:abort`, with an
 * error as its reason, as an app's own cancel of a sign-in does. The dialog covers the page while a
 * sign-in runs, so no control of the page can abort it, and a spec dispatches the event.
 */
export function signal() {
  const controller = new AbortController()
  window.addEventListener(
    'test-app-web:abort',
    () => controller.abort(new Error('The page ended the sign-in.')),
    { once: true },
  )
  return controller.signal
}

/**
 * Returns the outcome of each action of a page, by name, and `run`, which runs an action and shows
 * what it returns or throws under its name.
 */
export function useOutcomes(): useOutcomes.ReturnType {
  const [outcomes, setOutcomes] = React.useState<
    Readonly<Record<string, Outcome>>
  >({})

  const run = React.useCallback((name: string, fn: () => Promise<unknown>) => {
    const settle = (outcome: Outcome) =>
      setOutcomes((outcomes) => ({ ...outcomes, [name]: outcome }))
    settle({ state: 'pending', text: '' })
    // The outcome shows the failure, so the promise never rejects.
    void Promise.resolve()
      .then(fn)
      .then(
        (value) =>
          settle({ state: 'fulfilled', text: JSON.stringify(value ?? null) }),
        (error: unknown) =>
          settle({ state: 'rejected', text: JSON.stringify(failure(error)) }),
      )
  }, [])

  return { outcomes, run }
}

export declare namespace useOutcomes {
  type ReturnType = {
    /** The outcome of each action that ran, by name. */
    outcomes: Readonly<Record<string, Outcome>>
    /** Runs `fn`, and shows what it returns or throws under `name`. */
    run: (name: string, fn: () => Promise<unknown>) => void
  }
}

/**
 * Shows the error that `useSession` throws, such as a refused redirect's, in place of the controls.
 * React takes an error boundary only as a class.
 */
class Boundary extends React.Component<Boundary.Props, Boundary.State> {
  static getDerivedStateFromError(error: unknown): Boundary.State {
    return { text: JSON.stringify(failure(error)) }
  }

  override state: Boundary.State = { text: undefined }

  override render() {
    const { text } = this.state
    if (text === undefined) return this.props.children
    return <output id="failure">{text}</output>
  }
}

declare namespace Boundary {
  type Props = {
    /** The page. */
    children: React.ReactNode
  }

  type State = {
    /** The fields of the error that the page threw, as JSON. `undefined` while it renders. */
    text: string | undefined
  }
}

/** A component that reads the session, as any component of an app does, and renders nothing. */
function Reader(props: Reader.Props) {
  const { accounts, onMount } = props
  accounts.useSession()

  React.useEffect(() => {
    onMount()
  }, [])

  return null
}

declare namespace Reader {
  type Props = {
    /** The page's instance. */
    accounts: Instance
    /** Runs after the mount, once `useSession` started its restore. */
    onMount: () => void
  }
}

function App(props: App.Props) {
  const { accounts } = props
  const { session, status } = accounts.useSession()
  const chain = React.useSyncExternalStore(
    accounts.chain.subscribe,
    accounts.chain.get,
  )
  const [history, setHistory] = React.useState<readonly string[]>([])
  // The count of mounted readers, and the call that ends the wait for the latest one's mount.
  const [readers, setReaders] = React.useState(0)
  const mounted = React.useRef<(() => void) | undefined>(undefined)
  const { outcomes, run } = useOutcomes()

  // Each status that the hook returned, in order, which shows what a component rendered.
  React.useEffect(() => {
    setHistory((history) =>
      history.at(-1) === status ? history : [...history, status],
    )
  }, [status])

  const fields = React.useRef<HTMLFormElement>(null)

  const actions: Actions = {
    ...props.actions,
    'Access token': async () =>
      fingerprint(await accounts.session.accessToken()),
    Account: async () => {
      const account = await accounts.account.get()
      return account ? { address: account.address, owner: account.owner } : null
    },
    'Complete the deposit': () => Promise.resolve(accounts.funding.complete()),
    Deposit: () => accounts.funding.open(deposit()),
    // A mount of `useSession` restores the session with `reauthorize`. The call after the mount does
    // the same, so the action ends after a restore.
    'Mount a session reader': async () => {
      await new Promise<void>((resolve) => {
        mounted.current = resolve
        setReaders((count) => count + 1)
      })
      return describe(await accounts.session.get({ reauthorize: true }))
    },
    'Preload the deposit page': () => accounts.funding.preload(deposit()),
    // A spec verifies in its own process, as an app's backend does, so the page hands it the access
    // token. The output is hidden, so no screenshot of the proof holds the token.
    Proof: async () => {
      const session = await accounts.session.get()
      if (!session) return null
      return {
        accessToken: await accounts.session.accessToken(),
        address: session.address ?? null,
        challengeSignature: session.challengeSignature ?? null,
        keyAuthorization: session.accessKey?.keyAuthorization ?? null,
      }
    },
    Refresh: async () => describe(await accounts.session.refresh()),
    // The Viem client's action, which Tempo ID sends from the account with no page.
    'Revoke the access key without a dialog': async () => {
      const accessKey = (await accounts.session.get())?.accessKey
        ?.keyAuthorization.keyId
      if (!accessKey) return null
      const { receipt } = await accounts.accessKey.revokeSync({ accessKey })
      return { transactionHash: receipt.transactionHash }
    },
    // Tempo ID revokes the refresh token, as it does from another device. The instance receives
    // no notice, so its next refresh meets the refusal.
    'Revoke the refresh token': async () => {
      const token = (await accounts.session.get())?.refreshToken
      if (!token) return false
      const response = await fetch(new URL('/oauth2/revoke', url), {
        body: new URLSearchParams({
          client_id: accounts.config.clientId,
          token,
          token_type_hint: 'refresh_token',
        }),
        method: 'POST',
      })
      return response.ok
    },
    Session: async () => describe(await accounts.session.get()),
    // Tempo ID signs as the account's owner, with no page, for an app with `tempo-id:sign`.
    'Sign a message as the owner': async () => {
      const account = await accounts.account.get()
      if (!account) return null
      const text = message()
      const signature = await Internal.Actions.account.signMessage(
        accounts.config,
        { account: account.address, chain: tempoLocalnet.id, message: text },
      )
      return { address: account.address, message: text, signature }
    },
    // The access key signs. The client's `verifyMessage` counts its signature with the session's
    // access token, which names the access key.
    'Sign a message with the access key': async () => {
      const address = (await accounts.session.get())?.accessKey?.account
      if (!address) return null
      const text = message()
      const signature = await accounts.viem.signMessage({ message: text })
      const verified = await accounts.viem.verifyMessage({
        accessToken: await accounts.session.accessToken(),
        address,
        message: text,
        signature,
      })
      return { address, message: text, signature, verified }
    },
    'Sign out': () => accounts.signOut(),
    'Sign out everywhere': () => accounts.signOut({ everywhere: true }),
    'Sign typed data as the owner': async () => {
      const account = await accounts.account.get()
      if (!account) return null
      const signature = await Internal.Actions.account.signTypedData(
        accounts.config,
        {
          account: account.address,
          chain: tempoLocalnet.id,
          typedData: Json.parse(
            query.get('typedData') ?? 'null',
          ) as TypedDataDefinition,
        },
      )
      return { address: account.address, signature }
    },
    // The Viem client's action, which Tempo ID sends from the account with no page.
    'Update the limit to 50 without a dialog': async () => {
      const accessKey = (await accounts.session.get())?.accessKey
        ?.keyAuthorization.keyId
      if (!accessKey) return null
      const result = await accounts.accessKey.updateLimitSync({
        accessKey,
        ...limit,
      })
      return {
        limit: String(result.limit),
        transactionHash: result.receipt.transactionHash,
      }
    },
    'User info': async () => {
      const response = await accounts.session.fetch({
        url: new URL('/oauth2/userinfo', url),
      })
      const user = (await response.json()) as { email?: string | undefined }
      return { email: user.email ?? null, status: response.status }
    },
  }

  return (
    <main>
      <p>
        Status <span id="status">{status}</span>
      </p>
      <p>
        History <span id="history">{history.join(' ')}</span>
      </p>
      {Array.from({ length: readers }, (_, index) => (
        <Reader
          accounts={accounts}
          key={index}
          onMount={() => mounted.current?.()}
        />
      ))}
      <p>
        Chain <span id="chain">{chain}</span>
      </p>
      {session && (
        <p>
          Signed in as <span id="email">{session.user.email}</span>
        </p>
      )}
      {session?.accessKey && (
        <p>
          Tempo Account <span id="account">{session.accessKey.account}</span>
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          run('Send OUSD', async () => {
            const { receipt } = await accounts.token.transferSync({
              amount: parseUnits(String(form.get('amount')), 6),
              to: String(form.get('to')) as `0x${string}`,
              token: Addresses.ousd,
            })
            return { transactionHash: receipt.transactionHash }
          })
        }}
      >
        <input aria-label="Recipient" name="to" required />
        <input aria-label="Amount" name="amount" required />
        <button type="submit">Send OUSD</button>
        <Result name="Send OUSD" outcome={outcomes['Send OUSD']} />
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          run('Send calls', async () => {
            const calls = JSON.parse(
              String(form.get('calls')),
            ) as readonly Call[]
            const feeToken = String(form.get('feeToken'))
            const fields = String(form.get('fields') ?? '')
            // The client's chain is Viem's general `Chain`, whose request names no `calls`.
            const receipt = await accounts.viem.sendTransactionSync({
              calls,
              ...(feeToken ? { feeToken: feeToken as `0x${string}` } : {}),
              ...(fields ? (Json.parse(fields) as object) : {}),
              throwOnReceiptRevert: true,
            } as Parameters<typeof accounts.viem.sendTransactionSync>[0])
            return { transactionHash: receipt.transactionHash }
          })
        }}
      >
        <input aria-label="Calls" name="calls" required />
        <input aria-label="Fee token" name="feeToken" />
        <input aria-label="Fields" name="fields" />
        <button type="submit">Send calls</button>
        <Result name="Send calls" outcome={outcomes['Send calls']} />
      </form>
      <form ref={fields}>
        {props.fields.map((label) => (
          <input aria-label={label} key={label} name={label} />
        ))}
      </form>
      <ul>
        {Object.entries(actions).map(([name, fn]) => (
          <li key={name}>
            <button
              onClick={() =>
                run(name, () =>
                  fn(
                    Object.fromEntries(
                      [...new FormData(fields.current!)].map(
                        ([label, value]) => [label, String(value)],
                      ),
                    ),
                  ),
                )
              }
              type="button"
            >
              {name}
            </button>
            <Result name={name} outcome={outcomes[name]} />
          </li>
        ))}
      </ul>
    </main>
  )
}

declare namespace App {
  type Props = {
    /** The page's instance. */
    accounts: Instance
    /** The page's own actions, which show before the shared ones. */
    actions: Actions
    /** The labels of the page's fields. */
    fields: readonly string[]
  }
}

/** Returns the fields of `error` that a spec asserts: its name and message, and a refusal's fields. */
function failure(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error), name: null }
  const refusal = error as Error & {
    code?: string | undefined
    reason?: string | undefined
    status?: number | undefined
  }
  return {
    code: refusal.code ?? null,
    message: error.message,
    name: error.name,
    reason: refusal.reason ?? null,
    status: refusal.status ?? null,
  }
}
