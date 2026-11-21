/**
 * The entry for wagmi: `tempoId`, a connector whose wallet is a Tempo ID instance, and `wagmi`, a
 * plugin that adds `accounts.wagmi`, a config whose connector is the app's own instance. The
 * instance's session is the connection, and its Viem client signs: the access key signs
 * transactions, messages, and typed data. The account's owner signs messages and typed data for a
 * session without an access key.
 *
 * @example
 * ```ts
 * import { createConfig, http } from '@wagmi/core'
 * import { tempoId, wagmi } from 'accounts/wagmi'
 * import { tempo } from 'viem/tempo/chains'
 *
 * const config = createConfig({
 *   chains: [tempo],
 *   // An origin's client ID is a third-party app's, whose connection needs an access key.
 *   connectors: [
 *     tempoId({ accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] } }),
 *   ],
 *   transports: { [tempo.id]: http() },
 * })
 *
 * // Or the config of the app's own instance.
 * const instance = Accounts.create({ plugins: [viem(), wagmi()] })
 * instance.wagmi
 * ```
 * @module
 */
import {
  type CreateConfigParameters,
  type CreateConnectorFn,
  createConfig,
} from '@wagmi/core'
import type * as Core from '@wagmi/core'
import { Address, Hex, Provider } from 'ox'
import { TransactionRequest } from 'ox/tempo'
import { type Chain, type Transport, UserRejectedRequestError } from 'viem'
import {
  type ActorRefFrom,
  assertEvent,
  assign,
  createActor,
  type SnapshotFrom,
  setup,
  waitFor,
} from 'xstate'
import * as Accounts from '../Accounts.js'
import * as DefaultAccounts from '../internal/DefaultAccounts.js'
import * as Api from '../internal/Api.js'
import * as Callback from '../internal/Callback.js'
import * as ClientId from '../internal/ClientId.js'
import * as DefaultDialog from '../internal/DefaultDialog.js'
import * as InternalSession from '../internal/Session.js'
import type * as SignIn from '../internal/SignIn.js'
import * as Plugin from '../Plugin.js'
import { pluginOptions, settings, viem } from '../plugins/viem.js'
import * as Session from '../Session.js'

/**
 * The connector's account has no address: the session holds no access key, and Tempo ID returned no Tempo
 * Account for the app on the connector's chain. The `connect` of {@link tempoId} throws it.
 */
export class AccountUnavailableError extends Error {
  override readonly name = 'wagmi.AccountUnavailableError'

  constructor() {
    super(
      'The session holds no access key, and Tempo ID returned no Tempo Account for the app on the chain. Sign in with `accessKey`, or on a page of a realm that creates accounts.',
    )
  }
}

/**
 * A connector whose `chainId` names no chain of the config's `chains`. `createConfig` throws it for
 * the `chainId` of {@link tempoId}, and the connector's `switchChain` and `connect` with `chainId`
 * throw it for such a chain. Add the chain to `chains`, or set `chainId` to one of them.
 */
export class ChainNotConfiguredError extends Error {
  override readonly name = 'wagmi.ChainNotConfiguredError'

  constructor(options: ChainNotConfiguredError.Options) {
    super(
      `Invalid chain: ${options.chainId} is not a chain of the config. Add the chain to the config's \`chains\`, or set \`chainId\` to one of them.`,
    )
  }
}

export declare namespace ChainNotConfiguredError {
  type Options = {
    /** The connector's `chainId`. */
    chainId: number
  }
}

/**
 * A sign-in that set no session, such as a redirect that left the page, or a dismissed browser. The
 * `connect` of {@link tempoId} throws it.
 */
export class SignInIncompleteError extends Error {
  override readonly name = 'wagmi.SignInIncompleteError'

  constructor() {
    super(
      'The sign-in set no session, such as a redirect that left the page, a dismissed browser, or the email step of a passkey. Complete the sign-in, then connect again.',
    )
  }
}

/**
 * A connection without `signIn` on an instance whose sign-in plugins each take input, such as an
 * emailed code. The `connect` of {@link tempoId} throws it. Pass `signIn`.
 */
export class SignInRequiredError extends Error {
  override readonly name = 'wagmi.SignInRequiredError'

  constructor() {
    super(
      "The connector's sign-in plugins each take input, such as an emailed code. Pass `signIn` to `connect`, or add the `dialog`, `passkey`, `redirect`, or `device` plugin.",
    )
  }
}

/**
 * A connection that signs in on an instance without a session: outside a browser, without `store`.
 * The instance would drop the sign-in's tokens, so the `connect` of {@link tempoId} throws it before
 * the sign-in, and sends no request. Pass `store`, such as `Store.memory()`.
 */
export class StoreRequiredError extends Error {
  override readonly name = 'wagmi.StoreRequiredError'

  constructor() {
    super(
      'The instance holds no session outside a browser without `store`, so no sign-in connects. Pass `store`, such as `Store.memory()`.',
    )
  }
}

/**
 * Returns a [wagmi](https://wagmi.sh) connector, from `accounts/wagmi`, whose wallet is a Tempo ID
 * instance. The instance's session is the connection: a sign-in connects, and a sign-out
 * disconnects. `@wagmi/core` is an optional peer dependency of `accounts`, so an app with wagmi
 * installs it beside the package.
 *
 * The connector takes the options of `Accounts.create` but `chain`. It creates the instance on
 * first use, with `Accounts.create`, from `options` and the connector's chain, and adds the `viem`
 * plugin over the config's `chains` and `transports`. A `viem` plugin in `plugins`, such as
 * `viem({ feeToken })`, gives its other options to that plugin. In a browser, the instance is
 * created as the config is, so the dialog's frame preloads on a page without a session. The
 * connector's chain is the config's chain of `chainId`, or the config's first chain.
 *
 * With a session and without `accessKey`, `connect` returns the session's account, with no sign-in.
 * Otherwise it runs `signIn`, or the `signIn` of the first plugin of `plugins` that signs in without
 * input: `device`, `dialog`, `passkey`, or `redirect`. An instance without a sign-in plugin holds
 * `dialog`. The `email` and `backend` plugins take input, so they need `signIn`. Outside a browser
 * without `store`, the instance holds no session, so a sign-in throws {@link StoreRequiredError} and
 * sends no request. Outside a page, `connect` and wagmi's `reconnect` read the store again without
 * a session, so a session that another instance saved to a shared store since, such as another
 * process's, connects with no sign-in. A session without an access key receives the Tempo Account
 * that Tempo ID selects for the app, as `accounts.account.get` returns it.
 *
 * wagmi's actions use the instance's Viem client, so they sign as the `viem` plugin does. The
 * access key signs transactions, messages, and typed data. The account's owner signs messages and
 * typed data for a session without an access key. The client's account throws
 * `Accounts.AccessKeyRequiredError` for a transaction of a session without an access key, as the
 * `viem` plugin lists. A call that names the connected account by address as `account`, such as
 * `sendTransaction(config, { account: address, … })`, signs as a call without `account` does. A
 * call that names another account keeps it.
 *
 * On a page, a transaction that the node refuses for a low balance, a spent limit, or an access key
 * that the chain does not hold retries through wagmi's actions too. The `retry` option of the
 * `viem` plugin describes the retry.
 *
 * `disconnect` signs the user out with `accounts.signOut`. A sign-out through the instance itself
 * disconnects wagmi too. If the sign-out rejects, such as for a revocation with status 0, 429, or
 * 5xx, the session still ends, and the provider emits `disconnect`. wagmi stays connected, so its
 * next `disconnect` revokes the refresh token. If that revocation receives no answer either, the
 * `disconnect` rejects too, and wagmi stays connected. A sign-out or a sign-in through the
 * instance itself ends that connection too.
 *
 * @throws {ChainNotConfiguredError} From `createConfig`, when `chainId` names no chain of the
 *   config's `chains`.
 * @throws {StoreRequiredError} From `connect`, before a sign-in outside a browser without `store`.
 *
 * @example
 * ```ts
 * import { connect, createConfig, http, signMessage } from '@wagmi/core'
 * import { passkey, viem } from 'accounts/plugins'
 * import { tempoId } from 'accounts/wagmi'
 * import { Addresses } from 'viem/tempo'
 * import { tempo, tempoDevnet } from 'viem/tempo/chains'
 *
 * const config = createConfig({
 *   chains: [tempo, tempoDevnet],
 *   connectors: [
 *     tempoId({
 *       accessKey: () => ({
 *         expiry: '1d',
 *         limits: [{ limit: '10', token: 'ousd' }],
 *       }),
 *       chainId: tempoDevnet.id,
 *       plugins: [passkey(), viem({ feeToken: Addresses.ousd })],
 *     }),
 *   ],
 *   transports: { [tempo.id]: http(), [tempoDevnet.id]: http() },
 * })
 *
 * const { accounts } = await connect(config, {
 *   connector: config.connectors[0]!,
 * })
 * const signature = await signMessage(config, { message: 'hi' })
 * ```
 */
export function tempoId<const plugins extends readonly Plugin.Option[] = []>(
  options: tempoId.Options<plugins> = {},
): CreateConnectorFn<tempoId.Provider, tempoId.Properties<plugins>> {
  const { chainId, plugins: entries = [], ...rest } = options
  // An app's own `viem` plugin, such as one with a `feeToken`, gives its options to the connector's,
  // which takes the config's `chains` and `transports` in their place.
  const flattened = Plugin.flatten(entries)
  const own = flattened.find((plugin) => plugin.id === 'viem') as
    | { [pluginOptions]?: viem.Options | viem.Resolver | undefined }
    | undefined
  const others = flattened.filter((plugin) => plugin !== own)

  // The first plugin that signs in without input signs in at `connect`. An instance without a
  // sign-in plugin holds `dialog`. Plugins such as `email` and `backend` take input, so they need
  // `signIn`.
  const ids = flattened.map((plugin) => plugin.id)
  const defaultSignIn =
    ids.find((id) => defaultSignInIds.has(id)) ??
    (ids.some((id) => DefaultDialog.signInIds.has(id)) ? undefined : 'dialog')

  return connector<plugins>({
    chainId,
    create(config, current, hooks) {
      let context: Plugin.Context | undefined
      const instance = DefaultAccounts.create({
        ...rest,
        chain: current.id,
        // The instance switches only among the config's chains, which wagmi serves.
        chains: config.chains.map((entry) => entry.id),
        plugins: [
          others,
          viem((chainId) => {
            const options = own?.[pluginOptions]
            const base = (() => {
              if (typeof options === 'function') return options(chainId)
              // The object form names one chain: its `chain`, or the connector's chain. Other chains
              // keep their own RPC and pay their own fees, as the viem plugin's own clients do.
              const target = options?.chain?.id ?? current.id
              if (!options || chainId === target) return options
              const { relay: _relay, transport: _transport, ...other } = options
              return other
            })()
            const transport = (
              config.transports as
                | Readonly<Record<number, Transport>>
                | undefined
            )?.[chainId]
            const chain = config.chains.find((entry) => entry.id === chainId)
            return {
              ...base,
              ...(chain ? { chain } : {}),
              ...(transport ? { transport } : {}),
            }
          }),
          // Holds the instance's context, through which a session without an access key receives its
          // account.
          Plugin.from({
            hooks: { afterSignOut: () => hooks.afterSignOut() },
            id: 'wagmi',
            setup(value) {
              context = value
            },
          }),
        ],
      }) as unknown as Base
      return { context: context!, instance }
    },
    defaultSignIn,
  })
}

export declare namespace tempoId {
  /** The parameters of the connector's `connect`, which wagmi's `connect` passes through. */
  type ConnectParameters<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
    withCapabilities extends boolean = false,
  > = {
    /**
     * The access key to request: what it may do, a function that returns it, or `false` for a
     * sign-in without an access key. With it, `connect` signs in again over a held session.
     * Defaults to the connector's `accessKey`.
     */
    accessKey?: SignIn.AccessKeyOption
    /**
     * The chain, one of the config's `chains`. With another chain than the instance's, `connect`
     * selects that chain first. Defaults to the instance's chain.
     */
    chainId?: number | undefined
    /** Whether wagmi restores an earlier connection, which never signs in. */
    isReconnecting?: boolean | undefined
    /**
     * Signs the user in on the instance, such as with `instance.passkey.signIn({ accessKey })`,
     * and receives the call's `accessKey`. Defaults to the `signIn` of the first plugin that signs
     * in without input.
     */
    signIn?:
      | ((
          instance: Instance<plugins>,
          parameters: {
            /** The call's `accessKey`. Absent, the instance's `accessKey` applies. */
            accessKey: SignIn.AccessKeyOption
          },
        ) => Promise<unknown>)
      | undefined
    /** Whether `accounts` holds objects with capabilities in place of addresses. */
    withCapabilities?: withCapabilities | boolean | undefined
  }

  /** The result of the connector's `connect`. */
  type ConnectReturnType<withCapabilities extends boolean = false> = {
    /** The session's account, with capabilities for `withCapabilities`. */
    accounts: withCapabilities extends true
      ? readonly {
          /** The account's address. */
          address: Address.Address
          /** Always empty. */
          capabilities: Record<string, unknown>
        }[]
      : readonly Address.Address[]
    /** The instance's chain. */
    chainId: number
  }

  /** The connector's instance, with the `viem` plugin. */
  type Instance<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
  > = Accounts.Accounts<
    Plugin.Flatten<readonly [...plugins, ReturnType<typeof viem>]>
  >

  type Options<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
  > = Omit<Accounts.create.Options<plugins>, 'chain' | 'chainId'> & {
    /**
     * The connector's chain, the instance's configured chain, which must be one of the config's
     * `chains`. The instance's access keys and wagmi's connection belong to it. Defaults to the
     * config's first chain.
     *
     * wagmi's `switchChain` selects another of the config's `chains` through the instance's
     * `switchChain`, and `getChainId` and wagmi's connection follow it. The instance saves the
     * selection, so a later load starts on it. The object form of a `viem` plugin in `plugins`
     * applies to the configured chain, unless it names a `chain`.
     */
    chainId?: number | undefined
  }

  /** The members that the connector adds to wagmi's. */
  type Properties<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
  > = {
    /**
     * Returns the session's account and the instance's chain, and signs the user in first when the
     * instance holds no session, or with `accessKey`. wagmi's `connect` passes its parameters to
     * it, so an app passes `accessKey` and `signIn` to wagmi's `connect`.
     *
     * The read of the Tempo Account, for a session without an access key, sends the session's
     * access token. If the access token expires within 5 seconds, the read waits for the refresh
     * of `session.accessToken`.
     *
     * @throws {AccountUnavailableError} When the session holds no access key, and Tempo ID returned
     *   no Tempo Account for the app. A third-party client ID, such as an origin, sends no read, so
     *   it throws for every session without an access key.
     * @throws {Accounts.RequestError} When Tempo ID refuses the sign-in, or the read of the Tempo
     *   Account, as each sign-in plugin lists. If the access token is a DPoP token, and the
     *   instance holds no DPoP key or another DPoP key than the one that binds it, the read throws
     *   `invalid_dpop_proof` with status 400, and sends no request. Outside a browser, `isAuthorized`
     *   returns `false` for such a session, so wagmi's `reconnect` skips it, and `connect` signs
     *   in again. The user's denial, `access_denied` without a `reason`, throws
     *   `UserRejectedRequestError` instead.
     * @throws {ChainNotConfiguredError} With `chainId`, for a chain outside the config's `chains`.
     * @throws {SignInIncompleteError} When the sign-in set no session: a redirect that left the
     *   page, a dismissed browser, or the email step of a passkey. After a redirect, wagmi's
     *   `reconnect` connects on the page that the browser returns to.
     * @throws {SignInRequiredError} Without `signIn`, when the instance holds no session, and each
     *   of its sign-in plugins takes input, such as `email`.
     * @throws {UserRejectedRequestError} When the user closes the sign-in, such as the dialog or
     *   the popup, when a later sign-in replaces it, or when the user denies the request, such as
     *   with Deny on the approval page or for a device code. It is Viem's error, with `code` 4001,
     *   as wagmi's other connectors throw it. Its `cause` holds the sign-in's `AbortError`, or the
     *   denial's `Accounts.RequestError` with `access_denied` and no `reason`. wagmi stays
     *   disconnected. A failed `connect` with `chainId` selects the earlier chain again, also in
     *   the store, unless the session changed during it. A sign-in that set no session, such as a
     *   redirect, keeps the selected chain.
     *
     * @example
     * ```ts
     * import { connect } from '@wagmi/core'
     * import { UserRejectedRequestError } from 'viem'
     *
     * // A sign-in without an access key, also over a held session.
     * await connect(config, { accessKey: false, connector })
     *
     * // A sign-in of a plugin that takes input, which receives the call's `accessKey`.
     * await connect(config, {
     *   connector,
     *   signIn: (instance, { accessKey }) =>
     *     instance.email.signIn({ accessKey, code, email: address }),
     * })
     *
     * // The user closed the sign-in, or denied the request.
     * const error = await connect(config, { connector }).catch((error) => error)
     * if (error instanceof UserRejectedRequestError) return
     * ```
     */
    connect<withCapabilities extends boolean = false>(
      parameters?: ConnectParameters<plugins, withCapabilities>,
    ): Promise<ConnectReturnType<withCapabilities>>
    /**
     * Returns the connector's instance, and creates it on the first call. The instance holds the
     * namespace of each plugin, such as `instance.email`, and the `viem` plugin's client.
     *
     * @example
     * ```ts
     * const instance = await connector.getInstance()
     * await instance.email.sendCode({ email: address })
     * ```
     */
    getInstance(): Promise<Instance<plugins>>
  }

  /**
   * The EIP-1193 provider over the instance's client, which the connector's `getProvider` returns.
   * It serves these methods with the instance, and sends every other method to the chain's RPC:
   *
   * - `eth_accounts`: the session's account, or none while signed out.
   * - `eth_chainId`: the chain's ID.
   * - `eth_requestAccounts`: the session's account, after a sign-in when the instance holds no
   *   session.
   * - `eth_sendTransaction`: the hash of the transaction, which the access key signs.
   * - `eth_signTransaction`: the serialized transaction, which the access key signs.
   * - `eth_signTypedData_v4`: the signature of the typed data.
   * - `personal_sign`: the signature of the message.
   *
   * The provider emits `accountsChanged` at a new session's account, and `disconnect` at a
   * sign-out.
   *
   * @throws {Provider.UnauthorizedError} From `personal_sign`, `eth_signTypedData_v4`,
   *   `eth_sendTransaction`, and `eth_signTransaction`, for an address other than the session's
   *   account.
   * @throws {UserRejectedRequestError} From `eth_requestAccounts`, when the user closes the
   *   sign-in or denies the request, as the connector's `connect` does.
   */
  type Provider = Provider.Provider<undefined, true>
}

/**
 * Returns the plugin of the wagmi config, from `accounts/wagmi`: `accounts.wagmi`, a
 * [wagmi](https://wagmi.sh) config whose one connector is the instance itself. The config holds
 * Tempo's chains and the instance's chain, each from the options of the `viem` plugin, with the
 * instance's chain first. Without a `viem` plugin in `plugins`, it adds the Viem client itself, as
 * `viem()` does, so the instance holds `accounts.viem` and its actions. An app that needs other
 * options of the client, such as a `feeToken`, passes `viem({ … })` beside it. `@wagmi/core` is an
 * optional peer dependency of `accounts`, so an app with wagmi installs it beside the package.
 *
 * `accounts.wagmi({ … })` returns a config with overrides, such as `ssr` or more connectors.
 * Without `connectors`, the config holds only Tempo ID.
 *
 * The connector is the one that {@link tempoId} returns, over the app's own instance. `connect`
 * signs in with the first plugin that signs in without input, and `disconnect` signs out. A sign-in
 * or sign-out through the instance connects or disconnects wagmi. The connector throws the errors
 * of {@link tempoId}.
 *
 * @throws {Error} From `Accounts.create`, when the instance's `chainId` is not a Tempo chain and
 *   the Viem client's options name no `chain` of that ID.
 *
 * @example
 * ```tsx
 * import { Accounts } from 'accounts'
 * import { passkey } from 'accounts/plugins'
 * import { wagmi } from 'accounts/wagmi'
 * import { WagmiProvider } from 'wagmi'
 *
 * const accounts = Accounts.create({
 *   accessKey,
 *   plugins: [passkey(), wagmi()],
 * })
 *
 * function App() {
 *   return <WagmiProvider config={accounts.wagmi}>…</WagmiProvider>
 * }
 * ```
 */
export function wagmi(options: wagmi.Options = {}) {
  // The sign-out hooks of each instance's connectors, one for each config that the plugin creates.
  const signOuts = new WeakMap<Plugin.Context, Set<() => void>>()

  return Plugin.from({
    extend(instance: Accounts.Accounts, context: Plugin.Context) {
      // The instance's `viem` plugin, or one of the plugin's own, whose members the plugin adds.
      const held = (instance as unknown as { viem?: viem.Namespace }).viem
      const added = held ? undefined : viem()
      const client = held ?? (added!.actions!(context) as viem.Namespace)
      const { chains, transport } = client[
        settings as never
      ] as unknown as viem.Settings
      const { chainId } = instance.config
      const chain = chains.find((entry) => entry.id === chainId)
      if (!chain)
        throw new Error(
          `Invalid chain: ${chainId} is not a Tempo chain, and the viem plugin's options name no \`chain\`. Return its definition as \`chain\`.`,
        )
      // The connector's chain is the config's first. The instance's namespaces come in the order
      // of `plugins`, so the first namespace that signs in without input signs in at `connect`.
      const ordered = [
        chain,
        ...chains.filter((entry) => entry.id !== chainId),
      ] as const satisfies readonly [Chain, ...Chain[]]
      const defaultSignIn = Object.keys(instance).find((key) =>
        defaultSignInIds.has(key),
      )
      const connect = connector({
        create(_config, _chain, hooks) {
          const held = signOuts.get(context) ?? new Set()
          held.add(hooks.afterSignOut)
          signOuts.set(context, held)
          return { context, instance: instance as Base }
        },
        defaultSignIn,
        eager: true,
      })

      /** Returns a new config with `overrides` over the plugin's options. */
      function create(overrides: wagmi.Overrides = {}): wagmi.Config {
        const { connectors = [], ...rest } = { ...options, ...overrides }
        return createConfig({
          multiInjectedProviderDiscovery: false,
          ...rest,
          chains: ordered,
          connectors: [connect, ...connectors],
          transports: Object.fromEntries(
            ordered.map((entry) => [entry.id, transport(entry.id)]),
          ),
        })
      }

      // A read of a member goes to the default config, built on first use, so a page's provider
      // and its actions share one config. A call returns a new config with its overrides.
      let config: wagmi.Config | undefined
      const get = () => (config ??= create())
      const call = (overrides?: wagmi.Overrides) =>
        overrides ? create(overrides) : get()
      const namespace = new Proxy(call, {
        apply: (_, __, args: [wagmi.Overrides?]) => call(args[0]),
        get: (_, key) => Reflect.get(get(), key),
        getOwnPropertyDescriptor(_, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(get(), key)
          return descriptor && { ...descriptor, configurable: true }
        },
        has: (_, key) => Reflect.has(get(), key),
        ownKeys: () => Reflect.ownKeys(get()),
      }) as unknown as wagmi.Namespace
      const members = { wagmi: namespace } as wagmi.Members
      if (!added) return members
      // The viem plugin's members read the client at each use, so they stay getters.
      return Object.defineProperties(
        Object.assign(members, { viem: client }),
        Object.getOwnPropertyDescriptors(
          added.extend!({ viem: client } as never, context),
        ),
      )
    },
    hooks: {
      afterSignOut(context) {
        for (const fn of signOuts.get(context) ?? []) fn()
      },
    },
    id: 'wagmi',
  })
}

export declare namespace wagmi {
  /** A config of the plugin, whose first connector is the instance's. */
  type Config = Core.Config<
    readonly [Chain, ...Chain[]],
    Record<number, Transport>,
    readonly [
      CreateConnectorFn<tempoId.Provider, tempoId.Properties>,
      ...CreateConnectorFn[],
    ]
  >

  /**
   * The members that the plugin adds to the instance: `wagmi`, and the `viem` plugin's members when
   * `plugins` holds no `viem` plugin.
   */
  type Members = {
    /**
     * The default config, which a call configures. The plugin creates the default config at its
     * first read, and each read returns the same config. A call without overrides returns the
     * default config. A call with overrides returns a new config, whose connector is a new
     * connector over the same instance.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     * import { wagmi } from 'accounts/wagmi'
     *
     * const accounts = Accounts.create({ plugins: [wagmi()] })
     *
     * const config = accounts.wagmi({ ssr: true })
     * ```
     */
    wagmi: Namespace
    /** The Viem client, as the `viem` plugin adds it. */
    viem: viem.Namespace
  } & viem.Actions

  /** `accounts.wagmi`: the default config, which a call configures. */
  type Namespace = Config & ((overrides?: Overrides) => Config)

  /**
   * The plugin's options, which set the default config. `ssr`, `storage`, and `syncConnectedChain`
   * are as wagmi's `createConfig` takes them, with wagmi's defaults.
   *
   * `multiInjectedProviderDiscovery` is whether the config adds a connector for each wallet that
   * announces itself on the page. It defaults to `false`, which leaves them out.
   */
  type Options = Omit<
    CreateConfigParameters<
      readonly [Chain, ...Chain[]],
      Record<number, Transport>
    >,
    'chains' | 'client' | 'connectors' | 'transports'
  > & {
    /** The connectors after the instance's, such as injected wallets. Defaults to none. */
    connectors?: readonly CreateConnectorFn[] | undefined
  }

  /**
   * The overrides of a config, for one call, over the plugin's options. Their `connectors` replace
   * the plugin's.
   */
  type Overrides = Options
}

/**
 * The session that an account's commit settled on, or another sign-in's session, whose account the
 * read starts again for.
 */
type Settled =
  | {
      /** Another sign-in's session, which the read starts again for. */
      other: Session.Any
    }
  | {
      /** The session with its account. */
      session: Session.Any
    }

/**
 * The client's actions that sign with `account`. Viem's actions, such as `writeContract` and
 * `Actions.token.transferSync`, send through them.
 */
const signers = new Set([
  'approve',
  'approveSync',
  'deployContract',
  'sendCalls',
  'sendCallsSync',
  'sendTransaction',
  'sendTransactionSync',
  'signAuthorization',
  'signMessage',
  'signTransaction',
  'signTypedData',
  'transfer',
  'transferSync',
  'writeContract',
  'writeContractSync',
])

/**
 * The actions of a group that take `account` as their target, not their signer, such as
 * `token.getBalance` and `faucet.fundSync`.
 */
const groupReads = /^(call|estimate|fund|get|read|simulate|verify|watch)/

/** The members of a client that are its settings, not its action groups. */
const settingKeys = new Set([
  'account',
  'batch',
  'ccipRead',
  'chain',
  'tokens',
  'transport',
])

/** The wallet requests that the client of `getClient` signs for the connected account. */
const walletMethods = {
  /**
   * The requests that send a transaction and return its hash, which the client sends with its own
   * `sendTransaction`. Viem's synchronous actions send one of them, then wait for the receipt.
   * `eth_sendTransactionSync` returns a receipt, so it stays with the chain's RPC.
   */
  transaction: new Set(['eth_sendTransaction', 'wallet_sendTransaction']),
}

/** The IDs of the plugins whose `signIn` takes no input, which `connect` runs without `signIn`. */
const defaultSignInIds = new Set(['device', 'dialog', 'passkey', 'redirect'])

/** The members of every connector's instance, whatever its plugins. */
type Base = Accounts.Accounts<readonly [ReturnType<typeof viem>]>

/** The options of the connector's `saved`. */
type SavedOptions = {
  /**
   * Whether the caller's call created the instance before `saved`, such as a `connect` with
   * `chainId`, so the instance's first load is current. Defaults to `false`.
   */
  created?: boolean | undefined
}

/** The `signIn` of a sign-in plugin's namespace. */
type SignInFn = {
  signIn: (parameters: {
    accessKey: SignIn.AccessKeyOption
  }) => Promise<unknown>
}

/** Returns the result of `fn` as a promise, which rejects with the error that `fn` throws. */
function settle<value>(fn: () => value): Promise<value> {
  return new Promise((resolve) => resolve(fn()))
}

/** Returns the address of `session`'s account, or `undefined` without an access key and an account. */
function addressOf(session: Session.Any | undefined) {
  return (
    session?.accessKey?.account ??
    session?.account?.address ??
    session?.accessKeys?.[0]?.account
  )
}

/**
 * Returns a connector over the instance that `source.create` returns. The connector calls it once,
 * at the first use of the instance.
 */
function connector<const plugins extends readonly Plugin.Option[]>(source: {
  /** The connector's chain, one of the config's `chains`. Defaults to the config's first chain. */
  chainId?: number | undefined
  create: (
    config: Parameters<CreateConnectorFn>[0],
    chain: Chain,
    hooks: {
      /** Runs after each sign-out of the instance, as the plugin hook `afterSignOut` does. */
      afterSignOut: () => void
    },
  ) => {
    context: Plugin.Context
    instance: Base
  }
  defaultSignIn: string | undefined
  /** Whether the instance exists already, so the connector reads it at setup, also on a server. */
  eager?: boolean | undefined
}): CreateConnectorFn<tempoId.Provider, tempoId.Properties<plugins>> {
  const { defaultSignIn } = source

  return (config) => {
    const chain = (() => {
      if (source.chainId === undefined) return config.chains[0]
      const found = config.chains.find((entry) => entry.id === source.chainId)
      if (!found) throw new ChainNotConfiguredError({ chainId: source.chainId })
      return found
    })()
    // The listeners of the provider that follows the instance's chain, which alone receives
    // `chainChanged`.
    const emitter = Provider.createEmitter()
    // The listeners of every provider, which each receive `accountsChanged` and `disconnect`.
    // The listeners of each named chain's provider, with the read of its own chain's account.
    const named = new Map<
      ReturnType<typeof Provider.createEmitter>,
      () => Promise<readonly Address.Address[]>
    >()
    const emitters = new Set<ReturnType<typeof Provider.createEmitter>>([
      emitter,
    ])
    // The providers of each named chain, and the one that follows the instance's chain, so a
    // provider's listeners stay with it.
    const providers = new Map<number | 'instance', tempoId.Provider>()
    let context: Plugin.Context | undefined
    let instance: Base | undefined
    // The account read in progress of each session without an address, which every caller awaits.
    const reads = new WeakMap<Session.Any, Promise<Session.Any>>()
    // The clients that {@link ownAccount} returns, for each client of the instance.
    const owned = new WeakMap<object, object>()
    // The sign-outs of `disconnect` in progress. The session empties at once, but wagmi's connection
    // ends only once the sign-out settles, so a failed revocation leaves wagmi connected, and wagmi's
    // next `disconnect` calls the connector again, whose sign-out then revokes the refresh token. The
    // next sign-out or sign-in of the instance itself ends that connection too.
    const disconnects = createActor(
      machines.disconnect.provide({ actions: { end: () => onDisconnect() } }),
    ).start()
    // The `connect` calls with `chainId` that switched the chain, so a failed one selects the
    // earlier chain again.
    const connects = createActor(machines.connect).start()

    /**
     * Returns the address of the instance's session, and signs the user in first when the instance
     * holds no session, the call names `accessKey`, or {@link foreign} names the session.
     */
    async function connectInstance(
      parameters: tempoId.ConnectParameters<plugins>,
      options: SavedOptions = {},
    ): Promise<Address.Address> {
      const { accessKey, isReconnecting, signIn } = parameters

      // The user's denial rejects the sign-in, or, on the page that a redirect returns to, the
      // restore of its callback.
      const session = await (async () => {
        // wagmi's `reconnect` calls `isAuthorized` first, which reads the store outside a
        // page, so a reconnect takes its session without a second read.
        if (isReconnecting) return await restored()
        // The first `connect` creates the instance, here or in its `getChainId`, and its first
        // load is current, so the store is read once.
        const current = await saved(options)
        const instance = getInstance()
        // Over a session that {@link foreign} names, `connect` signs in again.
        if (current && accessKey === undefined && !foreign(current))
          return current
        // Without a session, the instance drops the sign-in's tokens, which stay live at Tempo ID.
        if (!instance.session.actor) throw new StoreRequiredError()
        if (!signIn && !defaultSignIn) throw new SignInRequiredError()
        if (signIn)
          await signIn(instance as tempoId.Instance<plugins>, { accessKey })
        else
          await (instance as unknown as Record<string, SignInFn>)[
            defaultSignIn!
          ]!.signIn({ accessKey })
        // A sign-in that returned without a session, such as at the email step of a passkey, leaves
        // the held session as it was, so only a new session completes it.
        const next = await instance.session.get()
        return next === current ? undefined : next
      })().catch((error: unknown) => {
        // wagmi and EIP-1193 read a refused request as code 4001, which a closed dialog or popup
        // is, and so is the user's denial.
        if (
          (error as { name?: unknown } | undefined)?.name === 'AbortError' ||
          Callback.denied(error)
        )
          throw new UserRejectedRequestError(error as Error)
        throw error
      })
      if (!session) throw new SignInIncompleteError()

      const address = addressOf(await withAccount(session))
      if (!address) throw new AccountUnavailableError()
      return address
    }

    /**
     * Ends wagmi's connection after a sign-out of the instance itself, such as `accounts.signOut()`,
     * that follows a failed `disconnect`.
     */
    function afterSignOut() {
      if (!machines.held(disconnects.getSnapshot()) || context?.session.get())
        return
      disconnects.send({ type: 'session.change' })
      endConnection()
    }

    // The account that each named chain's provider last reported.
    const reported = new WeakMap<object, Address.Address | undefined>()

    /**
     * Emits `accountsChanged` to each named chain's provider whose own chain's account changed. A
     * failed read emits nothing, so the promise needs no other handler.
     */
    function emitNamed() {
      for (const [entry, accountsOf] of named)
        void accountsOf()
          .then((own) => {
            if (!own[0] || own[0] === reported.get(entry)) return
            reported.set(entry, own[0])
            entry.emit('accountsChanged', own)
          })
          .catch(() => undefined)
    }

    /** Returns the instance's chain ID, once its stored selection loads. */
    async function getChainId() {
      await restored()
      return getInstance().chain.get()
    }

    /**
     * Selects the instance's chain, and returns the config's chain of it. Throws
     * {@link ChainNotConfiguredError} for a chain outside the config's `chains`.
     */
    async function switchChain(chainId: number) {
      const target = config.chains.find((entry) => entry.id === chainId)
      if (!target) throw new ChainNotConfiguredError({ chainId })
      // A queued switch ends the switch of a `connect` at its start, before its `chain.change`.
      connects.send({ type: 'chain.switch' })
      await getInstance().switchChain({ chainId })
      return target
    }

    /** Returns the address of the instance's session as a list, empty while signed out. */
    async function getAccounts(): Promise<readonly Address.Address[]> {
      const address = addressOf(await restored())
      return address ? [address] : []
    }

    /** Returns the instance, and creates it on the first call. */
    function getInstance(): Base {
      if (instance) return instance
      const created = source.create(config, chain, { afterSignOut })
      context = created.context
      instance = created.instance
      // wagmi and the providers' listeners follow the instance's chain, also a switch through the
      // instance itself.
      instance.chain.subscribe((chainId) => {
        connects.send({ chainId, type: 'chain.change' })
        config.emitter.emit('change', { chainId })
        emitter.emit('chainChanged', Hex.fromNumber(chainId))
      })
      instance.session.subscribe((session, previous) => {
        // A switch moves the session to its chain with the same tokens, so only another session,
        // such as a sign-in or a sign-out, ends the switch of a `connect`.
        if (session?.accessToken !== previous?.accessToken)
          connects.send({ type: 'session.change' })
        // An authorization empties a saved session whose access key expired, and renews it. wagmi
        // stays connected, or reconnecting, until the authorization returns.
        if (
          !session &&
          instance!.session.status.get().status === 'reauthorizing'
        )
          return
        const snapshot = disconnects.getSnapshot()
        // The expiry ended wagmi's connection already, so the read that empties the session ends
        // nothing again.
        if (!session && machines.expired(snapshot))
          return disconnects.send({ type: 'session.change' })
        // `disconnect` ends wagmi's connection once its sign-out settles. The provider's listeners
        // receive the end of the session at once.
        if (!session && machines.signingOut(snapshot)) return onSignOut()
        // wagmi can hold the account of a session that `disconnect` ended, which a new session replaces.
        const stale = machines.stale(snapshot)
        if (session) disconnects.send({ type: 'session.change' })
        const next = addressOf(session)
        if (session && !next) {
          // A session without an access key or an account, such as a dialog's sign-in without an
          // access key, has no address until its account is read. The account's commit notifies
          // this subscriber again.
          if (addressOf(previous)) onDisconnect()
          else if (stale) endConnection()
          // A failed read leaves wagmi disconnected, and `connect` reads the account again.
          void withAccount(session).catch(() => undefined)
          return
        }
        if (next === addressOf(previous)) {
          // A named chain's account can change alone, such as at a retry on its chain.
          if (session) emitNamed()
          return
        }
        if (next) onAccountsChanged([next])
        else onDisconnect()
      })
      // A renewal that ends without a session ends the session that the subscriber kept: an
      // authorization that finds no Tempo ID session, or a sign-out during the renewal, which moves
      // the status to `pending` until the authorization returns.
      instance.session.status.subscribe((status, previous) => {
        // At its access keys' expiry, the instance keeps the session until a read empties it, and
        // the status signs out at once, so wagmi's connection ends with the status.
        const snapshot = instance!.session.actor?.getSnapshot()
        if (snapshot && InternalSession.machines.expired(snapshot))
          disconnects.send({
            connected: addressOf(snapshot.context.session) !== undefined,
            type: 'session.expire',
          })
        if (
          previous.status === 'reauthorizing' &&
          status.status !== 'reauthorizing' &&
          status.status !== 'signedIn' &&
          addressOf(previous.session)
        )
          onDisconnect()
      })
      return instance
    }

    /**
     * Returns the result of `client`'s own action for a wallet request from `client`'s account, such
     * as `eth_sendTransaction`, or `undefined` for any other request.
     */
    function walletRequest(
      client: object,
      parameters: { method: string; params?: unknown },
    ) {
      const params = (parameters.params ?? []) as readonly unknown[]
      const from = (() => {
        if (
          walletMethods.transaction.has(parameters.method) ||
          parameters.method === 'eth_signTransaction'
        )
          return (params[0] as { from?: unknown } | undefined)?.from
        if (parameters.method === 'personal_sign') return params[1]
        if (parameters.method === 'eth_signTypedData_v4') return params[0]
        return undefined
      })()
      if (
        typeof from !== 'string' ||
        !Address.validate(from, { strict: false })
      )
        return undefined
      // The client's account reads the session at each use, and throws while signed out.
      const current = (() => {
        try {
          return (client as { account?: { address?: Address.Address } }).account
            ?.address
        } catch {
          return undefined
        }
      })()
      if (!current || !Address.isEqual(from, current)) return undefined
      // The client's own actions send their requests through the client's `request`, which applies
      // the signal of a scope, and retry for a new access key as the client's actions do.
      const actions = client as {
        sendTransaction: (parameters: unknown) => Promise<unknown>
        signMessage: (parameters: unknown) => Promise<unknown>
        signTransaction: (parameters: unknown) => Promise<unknown>
        signTypedData: (parameters: unknown) => Promise<unknown>
      }
      if (parameters.method === 'personal_sign')
        return actions.signMessage({ message: { raw: params[0] as Hex.Hex } })
      if (parameters.method === 'eth_signTypedData_v4') {
        const typedData = params[1]
        return actions.signTypedData(
          typeof typedData === 'string' ? JSON.parse(typedData) : typedData,
        )
      }
      const { from: _, ...transaction } = TransactionRequest.fromRpc(
        params[0] as TransactionRequest.Rpc,
      )
      if (parameters.method === 'eth_signTransaction')
        return actions.signTransaction(transaction)
      return actions.sendTransaction(transaction)
    }

    /**
     * Returns `client`, whose actions sign with the client's account also for a call that names that
     * account by address, as wagmi's actions pass the connected address. Viem reads an address as an
     * account of the node, which holds no access key, so the call would reach the chain's RPC. A call
     * that names another account keeps it.
     */
    function ownAccount<value extends object>(client: value): value {
      /** Returns `args` without an `account` that names the client's account by address. */
      function strip(args: readonly unknown[]) {
        const [parameters, ...rest] = args
        if (!parameters || typeof parameters !== 'object') return args
        // A coordinated authorization, such as `accessKey.signAuthorization` with `owner`, names
        // the account to authorize as `account`, and its `owner` signs.
        if ('owner' in parameters) return args
        const { account, ...other } = parameters as { account?: unknown }
        const address = (() => {
          if (typeof account === 'string') return account
          const entry = account as { address?: unknown; type?: unknown }
          if (entry?.type === 'json-rpc' && typeof entry.address === 'string')
            return entry.address
          return undefined
        })()
        if (!address || !Address.validate(address, { strict: false }))
          return args
        // The client's account reads the session at each use, and throws while signed out. Without a
        // session, such as after a failed `disconnect`, the call drops the address too, so it
        // rejects with the account's error instead of at the RPC.
        const current = (() => {
          try {
            return (client as { account?: { address?: Address.Address } })
              .account?.address
          } catch {
            return 'signedOut' as const
          }
        })()
        if (current === 'signedOut') return [other, ...rest]
        if (!current || !Address.isEqual(address, current)) return args
        return [other, ...rest]
      }

      /** Returns `fn`, called without an `account` that names the client's account by address. */
      function signer(fn: Function, object: object) {
        // A function proxy keeps the action's own members, such as `transfer.estimateGas`.
        return new Proxy(fn, {
          apply: (target, _, args: readonly unknown[]) =>
            Reflect.apply(target, object, strip(args)),
        })
      }

      /** Returns an action group, such as `token`, whose writes sign as the client's own actions do. */
      function group(value: object): object {
        const cached = owned.get(value)
        if (cached) return cached
        const wrapped = new Proxy(value, {
          get(object, key, receiver) {
            const member = Reflect.get(object, key, receiver)
            // A read, such as `getBalance`, reads `account` as its target, so it keeps it.
            if (typeof key !== 'string' || typeof member !== 'function')
              return member
            if (groupReads.test(key)) return member
            return signer(member, object)
          },
        })
        owned.set(value, wrapped)
        return wrapped
      }

      const cached = owned.get(client)
      if (cached) return cached as value
      const wrapped = new Proxy(client, {
        get(object, key, receiver) {
          const member = Reflect.get(object, key, receiver)
          if (typeof key !== 'string') return member
          // An action that Viem's tree-shakable actions call with the address as a JSON-RPC
          // account, such as `token.grantRoles`, sends a wallet request from it. The connector's
          // provider signs the request of the connected account with the access key.
          if (key === 'request' && typeof member === 'function')
            return (
              parameters: { method: string; params?: unknown },
              ...rest: readonly unknown[]
            ) => {
              const signed = walletRequest(object, parameters)
              if (signed) return signed
              return Reflect.apply(member, object, [parameters, ...rest])
            }
          // A client that `extend` or `scope` returns, such as wagmi's `getWalletClient`, signs
          // the same way.
          if (
            (key === 'extend' || key === 'scope') &&
            typeof member === 'function'
          )
            return (...args: readonly unknown[]) =>
              ownAccount(Reflect.apply(member, object, args) as object)
          // Viem binds the actions of a group to the client, so the group strips `account` itself.
          // The client's settings, such as `account`, stay as they are, so the retry of the viem
          // plugin finds the client's own account by identity.
          if (member && typeof member === 'object' && !settingKeys.has(key))
            return group(member)
          // Only an action that signs reads `account` as its signer. A read, such as `verifyHash`,
          // reads it as its target, so it keeps it.
          if (!signers.has(key) || typeof member !== 'function') return member
          return signer(member, object)
        },
      })
      owned.set(client, wrapped)
      return wrapped
    }

    /**
     * Returns the EIP-1193 provider over the instance's client of `chainId`, created once. Without
     * `chainId`, the provider follows the instance's chain at each request.
     */
    function getProvider(chainId: number | undefined): tempoId.Provider {
      const cached = providers.get(chainId ?? 'instance')
      if (cached) return cached
      const chainOf = () => chainId ?? getInstance().chain.get()

      /**
       * Returns the address that the provider's client signs as on its chain, which can differ from
       * the instance chain's. Empty while signed out.
       */
      async function accountsOf(): Promise<readonly Address.Address[]> {
        if (!(await restored())) return []
        // The client's account reads the session at each use, and throws while signed out.
        const address = (() => {
          try {
            return getInstance().viem({ chainId: chainOf() }).account?.address
          } catch {
            return undefined
          }
        })()
        return address ? [address] : []
      }

      /**
       * Returns the client of the provider's chain once `address` is the address that it signs as,
       * and throws otherwise. The chain resolves once, after the session and the stored chain load,
       * so the check and the request use one client.
       */
      async function own(address: unknown) {
        await restored()
        const client = getInstance().viem({ chainId: chainOf() })
        // The client's account reads the session at each use, and throws while signed out.
        const current = (() => {
          try {
            return client.account?.address
          } catch {
            return undefined
          }
        })()
        if (
          typeof address === 'string' &&
          current &&
          Address.isEqual(address as Address.Address, current)
        )
          return client
        throw new Provider.UnauthorizedError({
          message: `Invalid account: ${String(address)} is not the session's account. Sign with the connected account.`,
        })
      }

      const listeners =
        chainId === undefined ? emitter : Provider.createEmitter()
      emitters.add(listeners)
      if (chainId !== undefined) named.set(listeners, accountsOf)
      const provider = {
        ...listeners,
        async request(parameters: {
          method: string
          params?: unknown
        }): Promise<unknown> {
          const params = (parameters.params ?? []) as readonly unknown[]
          switch (parameters.method) {
            case 'eth_accounts':
              return accountsOf()
            case 'eth_chainId':
              // The stored chain loads with the session, so the provider never reports the
              // configured chain before it.
              if (chainId === undefined) await restored().catch(() => undefined)
              return Hex.fromNumber(chainOf())
            case 'eth_requestAccounts':
              await connectInstance({})
              return accountsOf()
            case 'eth_sendTransaction': {
              const request = params[0] as TransactionRequest.Rpc
              const client = await own(request.from)
              const { from: _, ...transaction } =
                TransactionRequest.fromRpc(request)
              return client.sendTransaction(transaction as never)
            }
            case 'eth_signTransaction': {
              const request = params[0] as TransactionRequest.Rpc
              const client = await own(request.from)
              const { from: _, ...transaction } =
                TransactionRequest.fromRpc(request)
              return client.signTransaction(transaction as never)
            }
            case 'eth_signTypedData_v4': {
              const client = await own(params[0])
              const typedData = params[1]
              return client.signTypedData(
                (typeof typedData === 'string'
                  ? JSON.parse(typedData)
                  : typedData) as never,
              )
            }
            case 'personal_sign': {
              const client = await own(params[1])
              return client.signMessage({
                message: { raw: params[0] as Hex.Hex },
              })
            }
            default:
              // The following provider reads the chain once the stored selection loads.
              if (chainId === undefined) await restored().catch(() => undefined)
              return getInstance()
                .viem({ chainId: chainOf() })
                .request(parameters as never)
          }
        },
      } as unknown as tempoId.Provider
      providers.set(chainId ?? 'instance', provider)
      return provider
    }

    /**
     * Emits the change of the session's accounts to wagmi and to the providers' listeners. wagmi
     * reads `change` only for a connection of this connector, and `connect` without one, so a
     * sign-in through the instance itself connects wagmi too.
     */
    function onAccountsChanged(accounts: readonly string[]) {
      if (accounts.length === 0) return onDisconnect()
      const addresses = accounts.map((account) => Address.checksum(account))
      config.emitter.emit('change', { accounts: addresses })
      emitter.emit('accountsChanged', addresses)
      emitNamed()
      // wagmi's `connect` makes this connector the current one, so it follows only when no other
      // connector holds the current connection, never over another wallet. A failed read of
      // wagmi's storage counts as none, so the promise needs no other handler.
      void connectIfChosen(addresses)
    }

    /** Emits wagmi's `connect` unless another connector holds wagmi's current connection. */
    async function connectIfChosen(addresses: readonly Address.Address[]) {
      // Without storage, the connector cannot read wagmi's current connection, so it connects
      // nothing, never over another wallet. `connect` and `reconnect` connect it.
      if (!config.storage) return
      // wagmi persists its state, whose `current` names the connection that its actions use.
      const store = await (async () =>
        (await config.storage?.getItem('store')) as
          | {
              state?: {
                connections?: Map<string, { connector?: { id?: string } }>
                current?: string | null
              }
            }
          | null
          | undefined)().catch(() => undefined)
      const current = store?.state?.current
      const holder = current
        ? store?.state?.connections?.get?.(current)?.connector?.id
        : undefined
      if (holder && holder !== 'tempoId') return
      // A sign-out or another sign-in can complete during the read, so only the session that the
      // instance still holds connects.
      const session = context?.session.get()
      const held = addressOf(session)
      if (!held || !Address.isEqual(held, addresses[0]!)) return
      // `isAuthorized` refuses such a session, so a late read connects it neither.
      if (foreign(session!)) return
      config.emitter.emit('connect', {
        accounts: addresses,
        chainId: getInstance().chain.get(),
      })
    }

    /**
     * Returns whether `session` is a session outside a browser whose tokens another DPoP key binds,
     * such as the DPoP key of an earlier run that the store did not keep. Every request refuses its
     * tokens, and no other context holds that DPoP key, so wagmi connects to no such session. A
     * page or a worker keeps it, since another context of the browser can hold that DPoP key.
     */
    function foreign(session: Session.Any) {
      return (
        !Session.local(session) &&
        Api.page() === undefined &&
        Api.unbound(getInstance().config, session)
      )
    }

    /** Emits the end of the session to wagmi and to the providers' listeners. */
    function onDisconnect() {
      endConnection()
      onSignOut()
    }

    /** Emits the end of wagmi's connection to wagmi. */
    function endConnection() {
      config.emitter.emit('disconnect')
    }

    /** Emits the end of the session to the providers' listeners. */
    function onSignOut() {
      const error = new Provider.DisconnectedError({
        message: 'The user signed out.',
      })
      for (const entry of emitters) entry.emit('disconnect', error)
      // A later sign-in of the same account reports it again to each named chain's provider.
      for (const [entry] of named) reported.delete(entry)
    }

    /**
     * Returns the instance's session once an authorization in progress returns, such as the page's
     * restore with `reauthorize`, so wagmi stays reconnecting while the status is `pending` or
     * `reauthorizing`.
     */
    async function restored(): Promise<Session.Any | undefined> {
      const instance = getInstance()
      const session = await instance.session.get()
      const { actor } = instance.session
      if (session || !actor) return session
      // `waitFor` resolves at once for a snapshot that is settled already.
      await waitFor(
        actor,
        (snapshot) =>
          snapshot.matches('signedIn') || snapshot.matches('signedOut'),
      )
      return instance.session.status.get().session
    }

    /**
     * Returns the instance's session as {@link restored} does. Outside a page, no message tells the
     * instance of another context's change, such as another process's sign-in or sign-out on a
     * shared store, so it reads the store again, unless the call came during the instance's first
     * load, whose read is current. A page's other tabs send that message, so a page reads nothing
     * more.
     */
    async function saved(
      options: SavedOptions = {},
    ): Promise<Session.Any | undefined> {
      // A call that creates the instance, such as the `isAuthorized` of the first `reconnect`,
      // starts its first load, whose read comes after the call starts, so it reads no more. A load
      // that started before the call can miss another context's later change.
      const created = instance === undefined
      const { actor } = getInstance().session
      const loading =
        created && actor
          ? !InternalSession.machines.loaded(actor.getSnapshot())
          : false
      const session = await restored()
      if (typeof document !== 'undefined') return session
      if (loading || options.created) return session
      // A held session can be stale: another context can end it, or save one that replaces it.
      // A failed read keeps the held session, or leaves none. No commit follows the adoption, so the
      // reload runs the plugins' hooks.
      return await context!.session.reload({ hooks: true }).catch(() => session)
    }

    /**
     * Returns `session`, with the Tempo Account that Tempo ID selects for the app when it holds no
     * access key and no account, such as after a dialog's sign-in without an access key. The
     * session's subscriber and `connect` both read the account of a new session, so concurrent
     * reads of one session share one request.
     */
    function withAccount(held: Session.Any): Promise<Session.Any> {
      if (addressOf(held)) return Promise.resolve(held)
      const pending = reads.get(held)
      if (pending) return pending
      const read = readAccount(held).finally(() => reads.delete(held))
      reads.set(held, read)
      return read
    }

    /** Reads the account of `held`, a session without an address, as {@link withAccount} returns it. */
    async function readAccount(held: Session.Any): Promise<Session.Any> {
      // Tempo ID returns the Tempo Account only for a first-party app's access token, and the page of
      // a third-party app has no CORS grant for the read, so the read sends no request.
      if (ClientId.thirdParty(getInstance().config.clientId)) return held
      if (Session.local(held)) return held
      // The session's access token authenticates the read, so it returns the account of the
      // session's user, also on a page of another site, which sends no Tempo ID cookie. A token
      // that another DPoP key binds throws without a request, as every other request with the
      // session's token does. Only a token that expires within 5 seconds waits for the refresh of
      // `session.accessToken`. A refresh beside the read would commit a session without an
      // account, whose own read would send a second request.
      const accessToken = await (async () => {
        if (held.expiresAt - 5_000 <= Date.now())
          return getInstance()
            .session.accessToken()
            .catch((error: unknown) => {
              // A sign-out or another user's sign-in during the refresh ends this read, and the
              // checks below end it, or hand it to the session that the instance holds.
              if (error instanceof Accounts.SignedOutError) return undefined
              throw error
            })
        Api.checkBound(getInstance().config, {
          accessToken: held.accessToken,
        })
        return held.accessToken
      })()
      // A sign-in can complete while the session refreshes, so the account goes only to the
      // session that the instance holds. A sign-out ends the read. A refresh commits a new
      // session, whose own read the subscriber starts, so this read joins it.
      const current = context!.session.get()
      if (!current) throw new Accounts.SupersededError()
      if (current !== held) return withAccount(current)
      if (!accessToken) throw new Accounts.SupersededError()
      // The account belongs to the chain of the read, which a switch can leave during it.
      const chainId = getInstance().chain.get()
      const account = await getInstance().account.get({ accessToken, chainId })
      if (!account) return held
      // The account commits under the lock that a refresh takes, onto the session that the
      // instance holds then, so it never overtakes a refresh's tokens. Another sign-in's session
      // reads its own account, outside the lock, since a refresh takes the lock.
      const result = await context!.session.exclusive<Settled>(async () => {
        // A sign-out in this instance while the read waited ends it, and the reload never takes in
        // another context's session over that sign-out.
        if (!context!.session.get()) throw new Accounts.SupersededError()
        // The stored session can hold another context's later tokens, so the account applies to
        // those, never to this instance's earlier copy.
        const latest = await context!.session.reload()
        if (!latest) throw new Accounts.SupersededError()
        if (addressOf(latest)) return { session: latest }
        // A switch during the read reads the account on its own chain.
        if (getInstance().chain.get() !== chainId) return { session: latest }
        if (
          Session.subject(latest) !== Session.subject(held) ||
          latest.accessKey?.keyAuthorization.keyId !==
            held.accessKey?.keyAuthorization.keyId
        )
          return { other: latest }
        const next = Session.from({ ...latest, account })
        await context!.session.change({ update: true }).commit(next)
        return { session: next }
      })
      return 'other' in result ? withAccount(result.other) : result.session
    }

    return {
      async connect(parameters = {}) {
        const { chainId, withCapabilities } = parameters
        // `getChainId` can create the instance, so the call records it first.
        const created = instance === undefined
        const previous = chainId === undefined ? undefined : await getChainId()
        const target = chainId === previous ? undefined : chainId
        if (
          target !== undefined &&
          !config.chains.some((entry) => entry.id === target)
        )
          throw new ChainNotConfiguredError({ chainId: target })
        // Each call starts an attempt, so a failed earlier call never selects its chain again under
        // a later call. The attempt starts before the switch, so the switch ends no earlier call.
        connects.send({
          chainId: target === undefined ? undefined : previous,
          target,
          type: 'connect.start',
        })
        const attempt = connects.getSnapshot().context.attempt

        const address = await (async () => {
          if (target !== undefined)
            await getInstance().switchChain({ chainId: target })
          return connectInstance(parameters, { created })
        })().catch(async (error: unknown) => {
          // A connection that fails, such as at a closed dialog, keeps the earlier chain, also in
          // the store, unless another switch, a new session, or a later call happened during it.
          // A sign-in that set no session, such as a redirect that left the page, continues on
          // the selected chain, which holds its pending result.
          const earlier =
            error instanceof SignInIncompleteError
              ? undefined
              : machines.earlier(connects.getSnapshot(), attempt)
          connects.send({ attempt, type: 'connect.end' })
          // The rollback replaces only the call's chain, so a switch of the instance that was still
          // queued at the failure keeps its chain.
          if (earlier !== undefined)
            await getInstance()
              .switchChain({ chainId: earlier, from: target })
              .catch(() => undefined)
          throw error
        })
        connects.send({ attempt, type: 'connect.end' })
        return {
          accounts: withCapabilities
            ? [{ address, capabilities: {} }]
            : [address],
          chainId: getInstance().chain.get(),
        } as never
      },
      /**
       * Signs the user out with the instance's `signOut`.
       *
       * @throws {Accounts.RequestError} When the revocation receives no answer, with status 0, 429,
       *   or 5xx. wagmi then stays connected, so the app calls `disconnect` again.
       */
      async disconnect() {
        const instance = getInstance()

        disconnects.send({ type: 'signOut.start' })
        try {
          await instance.signOut()
        } catch (error) {
          // Without a session, wagmi keeps the ended session's account, so its next `disconnect`
          // revokes the refresh token. A session that a sign-in set during the sign-out stays.
          disconnects.send({
            type: context!.session.get() ? 'signOut.finish' : 'signOut.fail',
          })
          throw error
        }
        disconnects.send({ type: 'signOut.finish' })
        // A sign-in that commits during the sign-out holds a new session, which stays connected.
        if (!context!.session.get()) endConnection()
      },
      getAccounts,
      getChainId,
      getClient: (parameters = {}) =>
        settle(() =>
          ownAccount(
            getInstance().viem({
              chainId: parameters.chainId ?? getInstance().chain.get(),
            }),
          ),
        ),
      getInstance: () =>
        settle(() => getInstance() as tempoId.Instance<plugins>),
      /**
       * Returns the {@link tempoId.Provider} of the chain of `chainId`. Without `chainId`, the
       * provider follows the instance's chain at each request, and emits `chainChanged` at each
       * switch. A provider of a named chain stays on it.
       *
       * @example
       * ```ts
       * import { toHex } from 'viem'
       *
       * const provider = await connector.getProvider()
       * const signature = await provider.request({
       *   method: 'personal_sign',
       *   params: [toHex('hi'), address],
       * })
       * ```
       */
      getProvider: (parameters = {}) =>
        settle(() => getProvider(parameters.chainId)),
      id: 'tempoId',
      async isAuthorized() {
        const session = await saved()
        if (!session) return false
        return !foreign(session)
      },
      name: 'Tempo ID',
      onAccountsChanged,
      onChainChanged(chainId) {
        config.emitter.emit('change', { chainId: Number(chainId) })
      },
      onDisconnect,
      setup() {
        // In a browser, the instance preloads its sign-in as it is created. A server render creates
        // none, since it has no page origin for the client ID. wagmi does not await `setup`, so a
        // failed creation, such as for a duplicate plugin, throws again at the first call instead.
        if (source.eager || typeof document !== 'undefined')
          try {
            getInstance()
          } catch {}
        return Promise.resolve()
      },
      /**
       * Selects the config's chain of `chainId` through the instance's `switchChain`, and returns
       * it. wagmi's `switchChain` calls it. The connector emits wagmi's `change` at each switch of
       * the instance's chain, also one through the instance itself, so wagmi follows it. On a
       * chain where the session holds no access key, the first transaction opens the dialog for
       * one.
       *
       * @throws {ChainNotConfiguredError} For a chain outside the config's `chains`.
       *
       * @example
       * ```ts
       * import { switchChain } from '@wagmi/core'
       * import { tempoModerato } from 'viem/tempo/chains'
       *
       * await switchChain(config, { chainId: tempoModerato.id })
       * ```
       */
      switchChain: (parameters) => switchChain(parameters.chainId),
      type: 'tempoId',
    }
  }
}

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The machine of a connector's `connect` calls. A call with `chainId` switches the chain before
   * the sign-in, and a failure of it in `switched` selects the earlier chain again. The start of
   * another switch, a change to another chain, a change of the session, or a later call ends
   * `switched` for the call.
   *
   * | State      | A failed `connect` of the latest call     |
   * | ---------- | ---------------------------------------- |
   * | `idle`     | Keeps the chain                          |
   * | `switched` | Selects the chain before the call again  |
   */
  export const connect = setup({
    actions: {
      /** Applies the earliest outstanding switch of the calls. */
      apply: assign((args) => ({ pending: args.context.pending.slice(1) })),
      /** Ends the call's switch. */
      clear: assign({ chainId: undefined, pending: [] }),
      /** Starts a later call's switch, and keeps the chain before the earliest call that switched. */
      follow: assign((args) => {
        assertEvent(args.event, 'connect.start')
        return {
          attempt: args.context.attempt + 1,
          // A switch to the chain of the switch before it changes nothing, so the instance
          // emits no change for it.
          pending:
            args.event.target === undefined ||
            args.event.target === args.context.pending.at(-1)
              ? args.context.pending
              : [...args.context.pending, args.event.target],
        }
      }),
      /** Starts a call, with its switch or without one. */
      start: assign((args) => {
        assertEvent(args.event, 'connect.start')
        return {
          attempt: args.context.attempt + 1,
          chainId: args.event.chainId,
          pending: args.event.target === undefined ? [] : [args.event.target],
        }
      }),
    },
    guards: {
      /** Whether the call that starts switched the chain. */
      switches: (args) => {
        assertEvent(args.event, 'connect.start')
        return args.event.target !== undefined
      },
      /** Whether the call that ends is the latest one. */
      latest: (args) => {
        assertEvent(args.event, 'connect.end')
        return args.event.attempt === args.context.attempt
      },
      /** Whether the chain changed to the chain of the earliest outstanding switch of the calls. */
      own: (args) => {
        assertEvent(args.event, 'chain.change')
        return args.event.chainId === args.context.pending[0]
      },
    },
    types: {
      context: {} as connect.Context,
      events: {} as connect.Event,
    },
  }).createMachine({
    context: { attempt: 0, chainId: undefined, pending: [] },
    id: 'connect',
    initial: 'idle',
    states: {
      idle: {
        on: {
          'connect.start': [
            { actions: 'start', guard: 'switches', target: 'switched' },
            { actions: 'start' },
          ],
        },
      },
      switched: {
        on: {
          'chain.change': [
            { actions: 'apply', guard: 'own' },
            { actions: 'clear', target: 'idle' },
          ],
          'chain.switch': { actions: 'clear', target: 'idle' },
          'connect.end': { actions: 'clear', guard: 'latest', target: 'idle' },
          'connect.start': [
            { actions: 'follow', guard: 'switches', target: 'switched' },
            { actions: 'start', target: 'idle' },
          ],
          'session.change': { actions: 'clear', target: 'idle' },
        },
      },
    },
  })

  export declare namespace connect {
    /** The machine's context. */
    type Context = {
      /** The number of the latest call, which counts each call. */
      attempt: number
      /** The chain before the earliest of the overlapping calls that switched. Absent in `idle`. */
      chainId: number | undefined
      /**
       * The chains of the switches of the overlapping calls that are not applied yet, in order.
       * Switches apply in order, so a change to the first one is a call's own. Any other change,
       * such as a switch of the instance, ends `switched`. Empty in `idle`.
       */
      pending: readonly number[]
    }

    /** An event of a connector. */
    type Event =
      | {
          /** The chain of the instance. */
          chainId: number
          /** The instance's chain changed. */
          type: 'chain.change'
        }
      | {
          /** A switch of the connector started, before the instance selects its chain. */
          type: 'chain.switch'
        }
      | {
          /** The number of the call, from `attempt` after its `connect.start`. */
          attempt: number
          /** A call settled. */
          type: 'connect.end'
        }
      | {
          /** The chain before the call. Absent for a call that switched no chain. */
          chainId: number | undefined
          /** The chain that the call selected. Absent for a call that switched no chain. */
          target: number | undefined
          /** A call started its sign-in, after its switch. */
          type: 'connect.start'
        }
      | {
          /** The instance's session changed. */
          type: 'session.change'
        }

    /** A running machine. */
    type Actor = ActorRefFrom<typeof connect>

    /** A snapshot of the machine. */
    type Snapshot = SnapshotFrom<typeof connect>
  }

  /** Returns the chain that a failed call of `attempt` selects again, or `undefined` to keep the chain. */
  export function earlier(snapshot: connect.Snapshot, attempt: number) {
    if (!snapshot.matches('switched') || snapshot.context.attempt !== attempt)
      return undefined
    return snapshot.context.chainId
  }

  /** Returns the state of `context`: `switched` while it holds the call's chains. */
  export function select(context: connect.Context) {
    return context.chainId === undefined ? 'idle' : 'switched'
  }

  /**
   * The machine of a connector's `disconnect` calls. The session's subscriber ends wagmi's connection
   * at an empty session only outside `signingOut`. In `signingOut`, `disconnect` ends it once its
   * sign-out settles. A sign-out that rejects without a session leaves wagmi connected in `held`, so
   * wagmi's next `disconnect` revokes the refresh token. The next sign-out or sign-in of the instance
   * ends `held`. At the expiry of a connected session's access keys, `expired` ends wagmi's
   * connection once, and the instance's next change of the session, such as the read that empties
   * the expired session, ends `expired`.
   *
   * | State        | wagmi's connection                                            | Tag     |
   * | ------------ | ------------------------------------------------------------- | ------- |
   * | `idle`       | Follows the instance's session                                |         |
   * | `signingOut` | Holds the account of the session that the sign-out ended      | `stale` |
   * | `held`       | Holds the account of the session that a failed sign-out ended | `stale` |
   * | `expired`    | Ended at the expiry of the session's access keys              |         |
   */
  export const disconnect = setup({
    actions: {
      /** Ends wagmi's connection and the providers' sessions. The connector provides it. */
      end: () => {},
      /** Counts a sign-out that settled. */
      finish: assign((args) => ({ runs: args.context.runs - 1 })),
      /** Counts a sign-out that started. */
      start: assign((args) => ({ runs: args.context.runs + 1 })),
    },
    guards: {
      /** Whether wagmi holds the account of the session that expired. */
      connected: (args) => {
        assertEvent(args.event, 'session.expire')
        return args.event.connected
      },
      /** Whether the sign-out that settles is the last one in progress. */
      last: (args) => args.context.runs === 1,
    },
    types: {
      context: {} as disconnect.Context,
      events: {} as disconnect.Event,
    },
  }).createMachine({
    context: { runs: 0 },
    id: 'disconnect',
    initial: 'idle',
    states: {
      expired: {
        entry: 'end',
        on: {
          'session.change': { target: 'idle' },
          'signOut.start': { actions: 'start', target: 'signingOut' },
        },
      },
      held: {
        on: {
          'session.change': { target: 'idle' },
          'signOut.start': { actions: 'start', target: 'signingOut' },
        },
        tags: ['stale'],
      },
      idle: {
        on: {
          'session.expire': { guard: 'connected', target: 'expired' },
          'signOut.start': { actions: 'start', target: 'signingOut' },
        },
      },
      signingOut: {
        on: {
          'signOut.fail': [
            { actions: 'finish', guard: 'last', target: 'held' },
            { actions: 'finish' },
          ],
          'signOut.finish': [
            { actions: 'finish', guard: 'last', target: 'idle' },
            { actions: 'finish' },
          ],
          'signOut.start': { actions: 'start' },
        },
        tags: ['stale'],
      },
    },
  })

  export declare namespace disconnect {
    /** The machine's context. */
    type Context = {
      /** The sign-outs of `disconnect` in progress. */
      runs: number
    }

    /** An event of a connector. */
    type Event =
      | {
          /**
           * The instance's session changed to a new session, a sign-out of the instance completed,
           * or a read emptied the expired session.
           */
          type: 'session.change'
        }
      | {
          /** Whether wagmi holds the account of the session. */
          connected: boolean
          /** The session's access keys expired while the instance held it. */
          type: 'session.expire'
        }
      | {
          /** The sign-out of a `disconnect` call rejected, and the instance holds no session. */
          type: 'signOut.fail'
        }
      | {
          /** The sign-out of a `disconnect` call resolved, or rejected beside a new session. */
          type: 'signOut.finish'
        }
      | {
          /** A `disconnect` call started its sign-out. */
          type: 'signOut.start'
        }

    /** A running machine. */
    type Actor = ActorRefFrom<typeof disconnect>

    /** A snapshot of the machine. */
    type Snapshot = SnapshotFrom<typeof disconnect>
  }

  /** Returns whether wagmi's connection ended at the expiry of the session's access keys. */
  export function expired(snapshot: disconnect.Snapshot) {
    return snapshot.matches('expired')
  }

  /** Returns whether a failed sign-out of `disconnect` left wagmi connected without a session. */
  export function held(snapshot: disconnect.Snapshot) {
    return snapshot.matches('held')
  }

  /** Returns whether a sign-out of `disconnect` runs, so wagmi's connection waits for it to settle. */
  export function signingOut(snapshot: disconnect.Snapshot) {
    return snapshot.matches('signingOut')
  }

  /** Returns whether wagmi can hold the account of a session that `disconnect` ended. */
  export function stale(snapshot: disconnect.Snapshot) {
    return snapshot.hasTag('stale')
  }
}
