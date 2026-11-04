/**
 * The entry for wagmi: `tempoId`, a connector whose wallet is a Tempo ID instance, and `wagmi`, a
 * plugin that adds `tempoId.wagmi`, a config whose connector is the app's own instance. The
 * instance's session is the connection, and its Viem client signs: the access key signs
 * transactions, messages, and typed data. The account's owner signs messages and typed data for a
 * session without an access key, and on a page until the chain holds the session's access key.
 *
 * @example
 * ```ts
 * import { createConfig, http } from '@wagmi/core'
 * import { tempoId, wagmi } from 'accounts/wagmi'
 * import { tempo } from 'viem/tempo/chains'
 *
 * const config = createConfig({
 *   chains: [tempo],
 *   connectors: [tempoId()],
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
import type { Chain, Transport } from 'viem'
import { waitFor } from 'xstate'
import * as Accounts from '../Accounts.js'
import * as DefaultDialog from '../internal/defaultDialog.js'
import type * as SignIn from '../internal/signIn.js'
import * as Plugin from '../Plugin.js'
import { pluginOptions, settings, viem } from '../plugins/viem.js'
import * as Session from '../Session.js'

/**
 * The connector's account has no address: the session holds no access key, and Tempo ID returned no Tempo
 * Account for the app on the connector's chain.
 */
export class AccountUnavailableError extends Error {
  override readonly name = 'wagmi.AccountUnavailableError'

  constructor() {
    super(
      'The session holds no key, and Tempo ID returned no Tempo Account for the app on the chain. Sign in with `accessKey`, or on a page of a realm that creates accounts.',
    )
  }
}

/** A connection or a chain switch to a chain other than the connector's. */
export class ChainSwitchError extends Error {
  override readonly name = 'wagmi.ChainSwitchError'

  constructor(options: ChainSwitchError.Options) {
    super(
      `Invalid chain: ${options.chainId} is not the connector's chain, ${options.current}. A session and its key belong to one chain, so put the chain first in the config's \`chains\`.`,
    )
  }
}

export declare namespace ChainSwitchError {
  type Options = {
    /** The chain that the call requested. */
    chainId: number
    /** The connector's chain. */
    current: number
  }
}

/** A sign-in that set no session, such as a redirect that left the page, or a dismissed browser. */
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
 * emailed code.
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
 * Returns a wagmi connector whose wallet is a Tempo ID instance. The connector creates the instance
 * on first use, from `options` and the config's first chain, and adds the `viem` plugin over the
 * config's `chains` and `transports`. A `viem` plugin in `plugins`, such as `viem({ feeToken })`,
 * gives its other options to that plugin. In a browser, the instance is created as the config is.
 *
 * `connect` returns the instance's session without a sign-in, unless it receives `accessKey`.
 * Otherwise it runs `signIn`, or the `signIn` of the first plugin of `plugins` that signs in without
 * input: `device`, `dialog`, `passkey`, or `redirect`. An instance without a sign-in plugin holds
 * `dialog`. A session without an access key receives the Tempo Account that Tempo ID selects for the app.
 *
 * wagmi's actions use the instance's Viem client. The access key signs transactions, messages, and
 * typed data. The account's owner signs messages and typed data for a session without an access key,
 * and on a page until the chain holds the session's access key. `disconnect` signs the user out.
 *
 * @example
 * ```ts
 * const config = createConfig({
 *   chains: [tempo],
 *   connectors: [tempoId({ plugins: [passkey()] })],
 *   transports: { [tempo.id]: http() },
 * })
 *
 * await connect(config, { connector: config.connectors[0]! })
 * ```
 */
export function tempoId<const plugins extends readonly Plugin.Option[] = []>(
  options: tempoId.Options<plugins> = {},
): CreateConnectorFn<tempoId.Provider, tempoId.Properties<plugins>> {
  const { plugins: entries = [], ...rest } = options
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
    create(config) {
      let context: Plugin.Context | undefined
      const instance = Accounts.create({
        ...rest,
        chainId: config.chains[0].id,
        plugins: [
          others,
          viem((chainId) => {
            const options = own?.[pluginOptions]
            const base = (() => {
              if (typeof options === 'function') return options(chainId)
              // The object form names one chain: its `chain`, or the config's first chain. Other
              // chains keep their own RPC and pay their own fees, as the viem plugin's own clients do.
              const target = options?.chain?.id ?? config.chains[0].id
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
    /** The chain, which must be the connector's. Defaults to the connector's. */
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
    /** The connector's chain. */
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
  > = Omit<Accounts.create.Options<plugins>, 'chainId' | 'dev'>

  /** The members that the connector adds to wagmi's. */
  type Properties<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
  > = {
    /**
     * Returns the session's account, and signs the user in first when the instance holds no
     * session, or with `accessKey`.
     */
    connect<withCapabilities extends boolean = false>(
      parameters?: ConnectParameters<plugins, withCapabilities>,
    ): Promise<ConnectReturnType<withCapabilities>>
    /** Returns the connector's instance, and creates it on the first call. */
    getInstance(): Promise<Instance<plugins>>
  }

  /**
   * The EIP-1193 provider over the instance's client. It serves `eth_accounts`,
   * `eth_requestAccounts`, `eth_chainId`, `eth_sendTransaction`, `personal_sign`, and
   * `eth_signTypedData_v4` with the instance, and sends every other method to the chain's RPC.
   */
  type Provider = Provider.Provider<undefined, true>
}

/**
 * Returns the plugin of the wagmi config: `tempoId.wagmi`, a config whose one connector is the
 * instance itself, over the chains and transports of the `viem` plugin. Without a `viem` plugin in
 * `plugins`, it adds the Viem client itself, as `viem()` does. An app passes `viem({ … })` for
 * other options, such as a `feeToken`.
 * The instance's chain is the config's first. `tempoId.wagmi({ … })` returns a config with overrides,
 * such as `ssr` or more connectors. Without `connectors`, the config holds only Tempo ID.
 *
 * The connector is the one that {@link tempoId} returns, over the app's own instance: `connect`
 * signs in with the instance's sign-in, and `disconnect` signs out.
 *
 * @example
 * ```tsx
 * const tempoId = Accounts.create({ accessKey, plugins: [passkey(), wagmi()] })
 *
 * <WagmiProvider config={tempoId.wagmi}>…</WagmiProvider>
 *
 * const config = tempoId.wagmi({ ssr: true })
 * ```
 */
export function wagmi(options: wagmi.Options = {}) {
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
        create: () => ({ context, instance: instance as Base }),
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
    /** The default config, which a call configures. */
    wagmi: Namespace
    /** The Viem client, as the `viem` plugin adds it. */
    viem: viem.Namespace
  } & viem.Actions

  /** `tempoId.wagmi`: the default config, which a call configures. */
  type Namespace = Config & ((overrides?: Overrides) => Config)

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
      other: Session.Session
    }
  | {
      /** The session with its account. */
      session: Session.Session
    }

/** The IDs of the plugins whose `signIn` takes no input, which `connect` runs without `signIn`. */
const defaultSignInIds = new Set(['device', 'dialog', 'passkey', 'redirect'])

/** The members of every connector's instance, whatever its plugins. */
type Base = Accounts.Accounts<readonly [ReturnType<typeof viem>]>

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
function addressOf(session: Session.Session | undefined) {
  return session?.key?.account ?? session?.account?.address
}

/**
 * Returns a connector over the instance that `source.create` returns. The connector calls it once,
 * at the first use of the instance.
 */
function connector<const plugins extends readonly Plugin.Option[]>(source: {
  create: (config: Parameters<CreateConnectorFn>[0]) => {
    context: Plugin.Context
    instance: Base
  }
  defaultSignIn: string | undefined
  /** Whether the instance exists already, so the connector reads it at setup, also on a server. */
  eager?: boolean | undefined
}): CreateConnectorFn<tempoId.Provider, tempoId.Properties<plugins>> {
  const { defaultSignIn } = source

  return (config) => {
    const chain = config.chains[0]
    const emitter = Provider.createEmitter()
    // The providers of each chain, so a provider's listeners stay with it.
    const providers = new Map<number, tempoId.Provider>()
    let context: Plugin.Context | undefined
    let instance: Base | undefined

    /**
     * Returns the address of the instance's session, and signs the user in first when the instance
     * holds no session or the call names `accessKey`.
     */
    async function connectInstance(
      parameters: tempoId.ConnectParameters<plugins>,
    ): Promise<Address.Address> {
      const { accessKey, isReconnecting, signIn } = parameters
      const instance = getInstance()

      const session = await (async () => {
        const current = await restored()
        if (isReconnecting || (current && accessKey === undefined))
          return current
        if (signIn)
          await signIn(instance as tempoId.Instance<plugins>, { accessKey })
        else {
          if (!defaultSignIn) throw new SignInRequiredError()
          const namespace = (instance as unknown as Record<string, SignInFn>)[
            defaultSignIn
          ]!
          await namespace.signIn({ accessKey })
        }
        // A sign-in that returned without a session, such as at the email step of a passkey, leaves
        // the held session as it was, so only a new session completes it.
        const next = await instance.session.get()
        return next === current ? undefined : next
      })()
      if (!session) throw new SignInIncompleteError()

      const address = addressOf(await withAccount(session))
      if (!address) throw new AccountUnavailableError()
      return address
    }

    /** Returns the address of the instance's session as a list, empty while signed out. */
    async function getAccounts(): Promise<readonly Address.Address[]> {
      const address = addressOf(await restored())
      return address ? [address] : []
    }

    /** Returns the instance, and creates it on the first call. */
    function getInstance(): Base {
      if (instance) return instance
      const created = source.create(config)
      context = created.context
      instance = created.instance
      instance.session.subscribe((session, previous) => {
        // An authorization empties a saved session whose access key expired, and renews it. wagmi
        // stays connected, or reconnecting, until the authorization returns.
        if (
          !session &&
          instance!.session.status.get().status === 'reauthorizing'
        )
          return
        const next = addressOf(session)
        if (session && !next) {
          // A session without an access key or an account, such as a keyless dialog's, has no address
          // until its account is read. The account's commit notifies this subscriber again.
          if (addressOf(previous)) onDisconnect()
          // A failed read leaves wagmi disconnected, and `connect` reads the account again.
          void withAccount(session).catch(() => undefined)
          return
        }
        if (next === addressOf(previous)) return
        if (next) onAccountsChanged([next])
        else onDisconnect()
      })
      // A renewal that ends without a session ends the session that the subscriber kept: an
      // authorization that finds no Tempo ID session, or a sign-out during the renewal, which moves
      // the status to `pending` until the authorization returns.
      instance.session.status.subscribe((status, previous) => {
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

    /** Returns the EIP-1193 provider over the instance's client of `chainId`, created once. */
    function getProvider(chainId: number): tempoId.Provider {
      const cached = providers.get(chainId)
      if (cached) return cached
      const client = getInstance().viem({ chainId })

      /** Throws when `address` is not the address of the instance's session. */
      async function own(address: unknown) {
        const [current] = await getAccounts()
        if (
          typeof address === 'string' &&
          current &&
          Address.isEqual(address as Address.Address, current)
        )
          return
        throw new Provider.UnauthorizedError({
          message: `Invalid account: ${String(address)} is not the session's account. Sign with the connected account.`,
        })
      }

      const provider = {
        ...emitter,
        async request(parameters: {
          method: string
          params?: unknown
        }): Promise<unknown> {
          const params = (parameters.params ?? []) as readonly unknown[]
          switch (parameters.method) {
            case 'eth_accounts':
              return getAccounts()
            case 'eth_chainId':
              return Hex.fromNumber(chainId)
            case 'eth_requestAccounts':
              return [await connectInstance({})]
            case 'eth_sendTransaction': {
              const request = params[0] as TransactionRequest.Rpc
              await own(request.from)
              const { from: _, ...transaction } =
                TransactionRequest.fromRpc(request)
              return client.sendTransaction(transaction as never)
            }
            case 'eth_signTypedData_v4': {
              await own(params[0])
              const typedData = params[1]
              return client.signTypedData(
                (typeof typedData === 'string'
                  ? JSON.parse(typedData)
                  : typedData) as never,
              )
            }
            case 'personal_sign': {
              await own(params[1])
              return client.signMessage({
                message: { raw: params[0] as Hex.Hex },
              })
            }
            default:
              return client.request(parameters as never)
          }
        },
      } as unknown as tempoId.Provider
      providers.set(chainId, provider)
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
      const held = addressOf(context?.session.get())
      if (!held || !Address.isEqual(held, addresses[0]!)) return
      config.emitter.emit('connect', {
        accounts: addresses,
        chainId: chain.id,
      })
    }

    /** Emits the end of the session to wagmi and to the providers' listeners. */
    function onDisconnect() {
      config.emitter.emit('disconnect')
      emitter.emit(
        'disconnect',
        new Provider.DisconnectedError({ message: 'The user signed out.' }),
      )
    }

    /**
     * Returns the instance's session once an authorization in progress returns, such as the page's
     * restore with `reauthorize`, so wagmi stays reconnecting while the status is `pending` or
     * `reauthorizing`.
     */
    async function restored(): Promise<Session.Session | undefined> {
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
     * Returns `session`, with the Tempo Account that Tempo ID selects for the app when it holds no
     * access key and no account, such as after a dialog's sign-in without an access key.
     */
    async function withAccount(
      held: Session.Session,
    ): Promise<Session.Session> {
      if (addressOf(held)) return held
      // The session's access token authenticates the read, so it returns the account of the
      // session's user, also on a page of another site, which sends no Tempo ID cookie. A held
      // session's token can have expired, so the session refreshes first.
      const session =
        held.expiresAt <= Date.now()
          ? ((await getInstance().session.refresh()) ?? held)
          : held
      if (addressOf(session)) return session
      // A sign-in can complete while the session refreshes, so the account goes only to the
      // session that the instance holds. A sign-out ends the read.
      const current = context!.session.get()
      if (!current) throw new Accounts.SupersededError()
      if (current !== session) return withAccount(current)
      const account = await getInstance().account.get({
        accessToken: session.accessToken,
      })
      if (!account) return session
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
        if (
          latest.user.id !== session.user.id ||
          latest.key?.keyAuthorization.keyId !==
            session.key?.keyAuthorization.keyId
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
        if (chainId !== undefined && chainId !== chain.id)
          throw new ChainSwitchError({ chainId, current: chain.id })

        const address = await connectInstance(parameters)
        return {
          accounts: withCapabilities
            ? [{ address, capabilities: {} }]
            : [address],
          chainId: chain.id,
        } as never
      },
      async disconnect() {
        await getInstance().signOut()
      },
      getAccounts,
      getChainId: () => Promise.resolve(chain.id),
      getClient: (parameters = {}) =>
        settle(() =>
          getInstance().viem({ chainId: parameters.chainId ?? chain.id }),
        ),
      getInstance: () =>
        settle(() => getInstance() as tempoId.Instance<plugins>),
      getProvider: (parameters = {}) =>
        settle(() => getProvider(parameters.chainId ?? chain.id)),
      id: 'tempoId',
      async isAuthorized() {
        return (await restored()) !== undefined
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
      switchChain(parameters) {
        if (parameters.chainId !== chain.id)
          return Promise.reject(
            new ChainSwitchError({
              chainId: parameters.chainId,
              current: chain.id,
            }),
          )
        return Promise.resolve(chain)
      },
      type: 'tempoId',
    }
  }
}
