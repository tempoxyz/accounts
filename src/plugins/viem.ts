/**
 * The plugin of the Viem client: `tempoId.viem`, a client whose account follows the instance's
 * session, which a call configures for another chain, a fixed session, or other client options.
 * @module
 */
import { Address } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import {
  type Chain,
  custom,
  http,
  type LocalAccount,
  type Transport,
} from 'viem'
import { type Account, Actions, createClient } from 'viem/tempo'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import * as AccessToken from '../AccessToken.js'
import type * as Id from '../Id.js'
import { KeyRequiredError } from '../Id.js'
import * as Core from '../internal/core.js'
import * as SignIn from '../internal/signIn.js'
import * as AccessKey from '../internal/viem/accessKey.js'
import * as Retry from '../internal/viem/retry.js'
import * as Signer from '../internal/signer.js'
import * as RelayRoute from '../internal/relayRoute.js'
import * as Verify from '../internal/viem/verify.js'
import * as Permissions from '../Permissions.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/** The sign-in for a new access key returned another user or Tempo Account, so the transaction did not send. */
export class RetryAccountError extends Error {
  override readonly name = 'Plugins.viem.RetryAccountError'
  /** The failure that the sign-in resolves. */
  readonly kind: Retry.Kind

  constructor(options: { cause: unknown; kind: Retry.Kind }) {
    super(
      'The sign-in for a new access key returned another account. The transaction did not send. Sign in with the same account, then send it again.',
      { cause: options.cause },
    )
    this.kind = options.kind
  }
}

/** The user closed the screen that a failed transaction showed, so the transaction did not send. */
export class RetryClosedError extends Error {
  override readonly name = 'Plugins.viem.RetryClosedError'
  /** The failure that the screen resolves. */
  readonly kind: Retry.Kind

  constructor(options: { cause: unknown; kind: Retry.Kind }) {
    super(
      `${closedMessages[options.kind]} The transaction did not send. Send it again to retry.`,
      { cause: options.cause },
    )
    this.kind = options.kind
  }
}

/**
 * Returns the plugin of the Viem client, which adds `viem`, and the default client's actions to the
 * instance itself, such as `tempoId.token.transferSync()`. `tempoId.viem` is the default client: the
 * instance's chain, its transport, and an account that follows the instance's session.
 * `tempoId.viem({ … })` returns a client with overrides, such as another chain, or a fixed `session`
 * for one request on a backend. Without options, the clients use Tempo's chains and their own RPC.
 * The plugin takes options, or a function that returns the options of a chain by its ID, such as
 * for a transport of each chain. A chain ID is valid when it names a Tempo chain, or when its
 * options name a `chain` of that ID.
 *
 * The access key signs transactions, messages, and typed data. On a page, the account's owner signs
 * messages and typed data until the chain holds the session's access key, which its first
 * transaction registers: the cloud wallet through Tempo ID, or the account's passkey. A session
 * without an access key on the client's chain signs them through the owner too, on a page or not.
 * Outside a page, a session's access key signs at once, and a fixed session always signs with it.
 * Its signature verifies only after the registration. `verifyHash`, `verifyMessage`, and `verifyTypedData` take the app's
 * `accessToken`, and count a live access key's signature only when the token names the access key. `Actions.account.signMessage` and `signTypedData` sign as the owner
 * explicitly. `accessKey.revoke` and `accessKey.updateLimit`, and their `Sync` forms, send through
 * Tempo ID with the account's owner, unless a call passes `account`.
 *
 * On a page, a transaction of the session's access key that the node refuses for a low balance, a
 * spent limit, or an access key that the chain does not hold shows Tempo ID's screen that fixes it,
 * then sends again, unless `retry` turns it off.
 *
 * @example
 * ```ts
 * const tempoId = Id.create({
 *   plugins: [email(), viem()],
 * })
 *
 * await tempoId.token.transferSync({ amount, to, token })
 * await tempoId.viem({ chainId: tempoTestnet.id }).token.transferSync({ amount, to, token })
 * await tempoId.viem({ session }).token.transferSync({ amount, to, token })
 * ```
 */
export function viem(options: viem.Options | viem.Resolver = {}) {
  /** Returns the options of the chain of `chainId`. */
  const resolve = (chainId: number) =>
    typeof options === 'function' ? options(chainId) : options
  // Only a page waits for the chain to register the session's access key, since the owner's signature
  // through the user's Tempo ID session stands in for it there.
  const page = typeof document !== 'undefined'

  const plugin = Plugin.from({
    actions: (context) => {
      const { config } = context

      /** Returns the chain of `chainId`: its options' `chain`, or Tempo's chain of that ID. */
      function chainOf(chainId: number) {
        const { chain } = resolve(chainId)
        if (chain?.id === chainId) return chain
        return defaultChains.find((entry) => entry.id === chainId)
      }

      // The wagmi plugin's config holds Tempo's chains, and the instance's chain when it is another.
      const tempoChains = defaultChains.map((entry) => chainOf(entry.id)!)
      const instanceChain = chainOf(config.chainId)
      const chains = (instanceChain &&
      !tempoChains.some((entry) => entry.id === instanceChain.id)
        ? [instanceChain, ...tempoChains]
        : tempoChains) as unknown as readonly [Chain, ...Chain[]]
      // The account of each session on each chain, so a client rebuilds no access key at each read.
      const accounts = new Map<
        number,
        WeakMap<Session.Session, LocalAccount | undefined>
      >()
      // The retry of the plugin's clients, whose transports mark the refusals that it retries.
      const retry = Retry.create()
      // The fix in progress for each screen, which concurrent failures that the screen resolves share:
      // a deposit of one token on one chain, or one sign-in on one chain.
      const fixes = new Map<string, Promise<void>>()
      // The clients without overrides beyond `chainId`, one for each chain.
      const clients = new Map<number, viem.Client>()
      // The verifier of the app's access tokens, built at the first verification that names one. Its
      // options are those of the instance's chain.
      let verifier: AccessToken.create.ReturnType | undefined
      const tokens = () =>
        (verifier ??= AccessToken.create(
          config,
          resolve(config.chainId).accessTokens,
        ))
      // The plugin's chains and transports, which the clients and the wagmi plugin share.
      const own = {
        chain: chainOf,
        chains,
        transport: (chainId: number) => {
          const { relay: route, transport } = (() => {
            if (typeof options === 'function') return options(chainId)
            // The object form names one chain: its `chain`, or the instance's chain. Other chains
            // keep their own RPC, so one transport or route never serves another chain's requests.
            const target = options.chain?.id ?? config.chainId
            return chainId === target ? options : {}
          })()
          const rpc = transport ?? http()
          return route ? RelayRoute.transport({ rpc, url: route }) : rpc
        },
      } satisfies viem.Settings

      /**
       * Returns a live access token of `session`, refreshed through the instance when it expires
       * within the margin. Returns `undefined` when the instance holds another user's session.
       */
      async function accessToken(session: Session.Session) {
        if (session.expiresAt - refreshMargin > Date.now())
          return session.accessToken
        const refreshed = await Core.refresh(context)
        if (refreshed?.user.id !== session.user.id) return undefined
        return refreshed.accessToken
      }

      /**
       * Returns the account of the instance's session on `chainId`, or `undefined` while signed out.
       * `byChain` caches it for each session. A page reads whether the chain holds the access key
       * through `transport`, the transport of the client that signs.
       */
      function current(
        chainId: number,
        options: {
          byChain: WeakMap<Session.Session, LocalAccount | undefined>
          transport: Transport
        },
      ) {
        const { byChain, transport } = options
        const session = context.session.get()
        if (!session) return undefined
        if (!byChain.has(session))
          byChain.set(
            session,
            Signer.fromSession(config, session, {
              accessToken: () => accessToken(session),
              chainId,
              ...(page
                ? {
                    registered: (accessKey: Account.AccessKeyAccount) =>
                      registered(accessKey, { chainId, transport }),
                  }
                : {}),
              signer: 'fallback',
            }),
          )
        return byChain.get(session)
      }

      /**
       * Returns whether the chain of `options.chainId` holds `accessKey`, unexpired and unrevoked, read
       * through `options.transport`. Each signature reads it again, since the user can revoke the
       * access key on the chain at any time.
       */
      async function registered(
        accessKey: Account.AccessKeyAccount,
        options: { chainId: number; transport: Transport },
      ) {
        const { chainId, transport } = options
        const chain = chainOf(chainId)
        const metadata = await Actions.accessKey.getMetadata(
          createClient({ chain, transport }),
          {
            account: accessKey.address,
            accessKey: accessKey.accessKeyAddress,
          },
        )
        // The chain reads an absent access key with the zero address and an expiry of 0. A registered
        // access key that never expires reads an expiry of 0 too, and Viem's `verifyHash` refuses its
        // signature, so the owner keeps signing for it. Any other access key verifies only before its
        // expiry, so the read checks the same.
        return (
          !metadata.isRevoked &&
          Address.isEqual(metadata.address, accessKey.accessKeyAddress) &&
          metadata.expiry * 1000n > BigInt(Date.now())
        )
      }

      /**
       * Shows the screen that resolves `failure` of a transaction of the client of `chainId`, and
       * resolves once the transaction can send again. A deposit page opens for a balance, and a sign-in
       * for a new access key with the session's access key's limits and scopes, for an access key or
       * its limit. The new access key keeps the old one's expiry while it is in the future. Otherwise
       * it takes the instance's `accessKey` expiry, or the one that Tempo ID fills. A sign-in that
       * returns another user or account sets no session, and rejects.
       */
      async function fix(
        failure: Retry.Failure,
        options: {
          address: `0x${string}`
          chainId: number
          error: unknown
          signal: AbortSignal | undefined
        },
      ) {
        const { address, chainId, error, signal } = options
        // The screens load from chunks of their own, so a bundle of the client holds them only once
        // a transaction fails.
        if (failure.kind === 'balance') {
          const Funding = await import('../actions/funding.js')
          const result = await Funding.open(config, {
            address,
            chainId,
            mode: 'frame',
            signal,
            ...(failure.amount === undefined
              ? {}
              : { amount: failure.amount, token: failure.token }),
          })
          if (result?.status !== 'received')
            throw new RetryClosedError({ cause: error, kind: failure.kind })
          return
        }
        const before = context.session.get()
        const key = before?.key
        if (!before || !key) throw error
        const authorization = KeyAuthorization.fromRpc(key.keyAuthorization)
        const expiry =
          authorization.expiry && authorization.expiry * 1000 > Date.now()
            ? authorization.expiry
            : context.accessKey()?.expiry
        // An authorization without scopes makes any call.
        const accessKey = Permissions.from({
          chainId: Number(authorization.chainId),
          ...(expiry === undefined ? {} : { expiry }),
          limits: authorization.limits?.map((entry) => ({
            limit: entry.limit,
            period: entry.period || undefined,
            token: entry.token,
          })),
          scopes: authorization.scopes ?? 'any',
        })
        const Dialog = await import('../actions/dialog.js')
        const change = context.session.change()
        const result = await Dialog.signIn(config, {
          accessKey,
          mode: 'iframe',
          signal,
        }).catch((reason: unknown) => {
          if (
            !signal?.aborted &&
            reason instanceof DOMException &&
            reason.name === 'AbortError'
          )
            return change.fail(
              new RetryClosedError({ cause: error, kind: failure.kind }),
            )
          return change.fail(reason)
        })
        const session = SignIn.toSession(result)
        // The retry sends from the live account, so it sends only from the account that failed.
        if (
          session.user.id !== before.user.id ||
          !session.key ||
          !Address.isEqual(session.key.account, key.account)
        )
          return change.fail(
            new RetryAccountError({ cause: error, kind: failure.kind }),
          )
        await change.commit(session)
      }

      /** Returns a new client with `overrides`. */
      function create(overrides: viem.Overrides = {}): viem.Client {
        const {
          chainId = config.chainId,
          retry: retryOverride,
          session,
          transport,
          ...clientOptions
        } = overrides
        const chain = chainOf(chainId)
        if (!chain)
          throw new Error(
            `Invalid chain: ${chainId} is not a Tempo chain, and its options name no \`chain\`. Return its definition as \`chain\`.`,
          )
        const {
          accessTokens: _accessTokens,
          chain: _chain,
          relay: _relay,
          retry: retryDefault = true,
          transport: _transport,
          ...defaults
        } = resolve(chainId)
        // Only a page shows the screens, and only for the session's account, since a fixed session
        // signs on a backend.
        const retries = merge(retryDefault, retryOverride)
        const retrying = page && !session && retries !== false
        const reads = (() => {
          const value = transport ?? own.transport(chainId)
          return retrying ? retry.transport(value) : value
        })()
        const account = (() => {
          if (!session) {
            // The default transport shares one account for each session and chain, and another
            // transport holds its own, whose reads go through it.
            const byChain = (() => {
              if (transport)
                return new WeakMap<Session.Session, LocalAccount | undefined>()
              let cached = accounts.get(chainId)
              if (!cached) accounts.set(chainId, (cached = new WeakMap()))
              return cached
            })()
            return Signer.live(() =>
              current(chainId, { byChain, transport: reads }),
            )
          }
          // A fixed session signs on a backend, which holds no Tempo ID session for its owner.
          const fixed = Signer.fromSession(config, session, {
            chainId,
            signer: 'accessKey',
          })
          if (!fixed) throw new KeyRequiredError()
          return fixed
        })()
        const client = build(
          {
            ...defaults,
            ...clientOptions,
            account,
            chain,
            transport: reads,
          },
          { verifier: tokens },
        )
        const extended = client.extend((client) => ({
          accessKey: {
            revoke: (parameters: AccessKey.revoke.Parameters) =>
              AccessKey.revoke(client as never, { config, parameters }),
            revokeSync: (parameters: AccessKey.revoke.Parameters) =>
              AccessKey.revokeSync(client as never, {
                config,
                parameters,
              }),
            updateLimit: (parameters: AccessKey.updateLimit.Parameters) =>
              AccessKey.updateLimit(client as never, {
                config,
                parameters,
              }),
            updateLimitSync: (parameters: AccessKey.updateLimit.Parameters) =>
              AccessKey.updateLimitSync(client as never, {
                config,
                parameters,
              }),
          },
        })) as viem.Client
        if (!retrying) return extended
        const kinds = typeof retries === 'object' ? retries : {}
        return retry.wrap(extended, {
          enabled: (kind) => kinds[kind] !== false,
          fix(failure, error) {
            // A new access key resolves a spent limit and a missing access key at once, and a second
            // sign-in would end the first.
            const key =
              failure.kind === 'balance'
                ? `balance:${chainId}:${failure.token ?? ''}`
                : `signIn:${chainId}`
            let pending = fixes.get(key)
            if (!pending) {
              pending = fix(failure, {
                address: extended.account.address,
                chainId,
                error,
                signal: kinds.signal,
              }).finally(() => fixes.delete(key))
              fixes.set(key, pending)
            }
            return pending
          },
          signal: kinds.signal,
          skip: internal,
        })
      }

      /** Returns the client with `overrides`, from the cache when they name at most a chain. */
      function get(overrides: viem.Overrides = {}) {
        if (Object.keys(overrides).some((key) => key !== 'chainId'))
          return create(overrides)
        const chainId = overrides.chainId ?? config.chainId
        let client = clients.get(chainId)
        if (!client) clients.set(chainId, (client = create({ chainId })))
        return client
      }

      // A read of a member goes to the default client, built on first use. A call returns a client
      // with its overrides. The target is an arrow function, whose own keys are all configurable.
      const call = (overrides?: viem.Overrides) => get(overrides)
      return new Proxy(call, {
        apply: (_, __, args: [viem.Overrides?]) => get(args[0]),
        // The settings key returns the plugin's chains and transports, which the wagmi plugin reads.
        // No client holds the key, so it shadows no member.
        get: (_, key) => (key === settings ? own : Reflect.get(get(), key)),
        getOwnPropertyDescriptor(_, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(get(), key)
          return descriptor && { ...descriptor, configurable: true }
        },
        has: (_, key) => Reflect.has(get(), key),
        ownKeys: () => Reflect.ownKeys(get()),
      }) as unknown as viem.Namespace
    },
    // The default client's actions, also on the instance itself. They read the default client,
    // whose account follows the session, so `tempoId.token.transferSync()` sends as
    // `tempoId.viem.token.transferSync()` does.
    extend: (instance: Id.Id) => {
      const namespace = (
        instance as unknown as {
          viem: viem.Namespace & { [settings]: viem.Settings }
        }
      ).viem
      // A client on the first chain names the actions, since the instance's chain may be one that
      // only a call's overrides reach. Each member reads the default client at its use. The sample
      // sends no request, so its transport needs no URL, and a chain without one still builds.
      const sample = build(
        {
          account: Signer.live(() => undefined),
          chain: namespace[settings].chains[0],
          transport: custom({ request: () => Promise.resolve(undefined) }),
        },
        { verifier: () => AccessToken.create(instance.config) },
      )
      const members = {}
      for (const key of Object.keys(sample)) {
        if (internal.has(key)) continue
        Object.defineProperty(members, key, {
          enumerable: true,
          get: () => namespace[key as keyof viem.Client],
        })
      }
      return members as viem.Actions
    },
    id: 'viem',
  })
  // The options stay on the plugin, so the wagmi connector rebuilds it over the config's chains.
  return Object.assign(plugin, { [pluginOptions]: options })
}

export declare namespace viem {
  type Options = Omit<
    NonNullable<Parameters<typeof createClient>[0]>,
    'account' | 'chain' | 'testnet' | 'transport'
  > & {
    /**
     * The options of the verifier of the app's access tokens, which `verifyHash`, `verifyMessage`,
     * and `verifyTypedData` read `accessToken` with, as `AccessToken.create` takes them. Set
     * `issuer` for a backend that reaches Tempo ID at an internal `url`, and `clientIds` for one
     * that accepts the tokens of several apps. Defaults to the instance's issuer and client ID.
     */
    accessTokens?: AccessToken.create.Options | undefined
    /**
     * The chain of the options' chain ID, such as one with a `feeToken` or another RPC URL. A chain of
     * another ID does not apply. Defaults to Tempo's chain of the ID: mainnet, testnet, devnet, or a
     * local node.
     */
    chain?: Chain | undefined
    /**
     * Which refused transactions of the session's access key retry on a page: `false` for none, or
     * an object that turns off each kind with `false`. A retry first shows Tempo ID's screen that
     * fixes the failure, then sends the same transaction again. Defaults to `true`, every kind.
     */
    retry?: RetryOptions | undefined
    /**
     * The URL of the app's relay route, such as `/api/relay`, which the `relay` plugin serves. The
     * chain's transport then sends its sponsorship requests to the route, so the relay's fee payer
     * pays the fees of each transaction. In the object form, it applies to the same chain as
     * `transport`. Absent, each transaction pays its own fees, unless `transport` sponsors them.
     */
    relay?: string | undefined
    /**
     * The transport of the chain's clients. In the object form, it applies to the options' `chain`,
     * or to the instance's chain without one. Defaults to `http()`, the chain's own RPC.
     */
    transport?: Transport | undefined
  }

  /**
   * Which refused transactions retry: `true` for every kind, `false` for none, or an object whose
   * kinds default to `true`.
   */
  type RetryOptions =
    | boolean
    | {
        /** A balance below the transaction's need opens the deposit page. */
        balance?: boolean | undefined
        /** An access key that the chain does not hold, expired, or revoked, signs in for a new one. */
        key?: boolean | undefined
        /** A spent limit of the access key signs in for a new access key. */
        limit?: boolean | undefined
        /** Closes the screen of a retry, and rejects the call with the signal's reason. */
        signal?: AbortSignal | undefined
      }

  /** Returns the options of the chain of `chainId`. */
  type Resolver = (chainId: number) => Options

  /** The overrides of a client, for one call. */
  type Overrides = Omit<
    NonNullable<Parameters<typeof createClient>[0]>,
    'account' | 'chain' | 'testnet'
  > & {
    /**
     * The chain ID: a Tempo chain, or one whose options name its `chain`. Defaults to the instance's
     * `chainId`.
     */
    chainId?: number | undefined
    /** Which refused transactions of the client retry. Defaults to the plugin's `retry`. */
    retry?: RetryOptions | undefined
    /**
     * A fixed session, such as one that `tempoId.backend.get` returns, whose access key signs. A
     * client of a session without an access key throws `Id.KeyRequiredError`.
     */
    session?: Session.Session | undefined
  }

  /** A client of the plugin, with its account and its chain. */
  type Client = ReturnType<typeof build>

  /**
   * The default client's actions and action groups, which the instance also holds, without the
   * client's account, chain, transport, and other settings.
   */
  type Actions = Omit<Client, Internal>

  /** The members of a client that are its settings, not its actions. */
  type Internal =
    | 'account'
    | 'batch'
    | 'cacheTime'
    | 'ccipRead'
    | 'chain'
    | 'dataSuffix'
    | 'extend'
    | 'key'
    | 'name'
    | 'pollingInterval'
    | 'request'
    | 'scope'
    | 'tokens'
    | 'transport'
    | 'type'
    | 'uid'

  /** The chains and transports of the plugin, which `tempoId.viem[settings]` returns. */
  type Settings = {
    /**
     * Returns the chain of `chainId`: its options' `chain`, or Tempo's chain of that ID. Absent when
     * neither holds the ID.
     */
    chain: (chainId: number) => Chain | undefined
    /** Tempo's chains, with the instance's chain first when it is another, each from its options. */
    chains: readonly [Chain, ...Chain[]]
    /** Returns the transport of the chain of `chainId`, or `http()` when its options hold none. */
    transport: (chainId: number) => Transport
  }

  /** `tempoId.viem`: the default client, which a call configures. */
  type Namespace = Client & ((overrides?: Overrides) => Client)
}

/**
 * The key of `tempoId.viem` that returns the plugin's {@link viem.Settings}. The entries of the
 * package do not export it, so only the package's own plugins read it.
 */
export const settings = Symbol('viem.settings')

/**
 * The key of a `viem` plugin that holds the options it was created with. The entries of the package
 * do not export it, so only the package's own plugins read it.
 */
export const pluginOptions = Symbol('viem.options')

/**
 * Returns the retries of a client: the plugin's `retry`, with the call's `retry` over it. A call's
 * object turns on or off the kinds that it names, and keeps the plugin's other kinds.
 */
function merge(
  plugin: viem.RetryOptions,
  call: viem.RetryOptions | undefined,
): viem.RetryOptions {
  if (call === undefined || typeof call === 'boolean') return call ?? plugin
  const base =
    plugin === false
      ? { balance: false, key: false, limit: false }
      : plugin === true
        ? {}
        : plugin
  return { ...base, ...call }
}

/** What the user closed, for each kind of failure, in the message of {@link RetryClosedError}. */
const closedMessages = {
  balance: 'The user closed the deposit page before a deposit arrived.',
  key: 'The user closed the sign-in for a new access key.',
  limit: 'The user closed the sign-in for a new access key with a new limit.',
} as const satisfies Record<Retry.Kind, string>

/** Tempo's chains, which a chain ID without a `chain` in its options uses. */
const defaultChains = [tempo, tempoTestnet, tempoDevnet, tempoLocalnet] as const

/** The time before a token's expiry at which the owner's account read refreshes it, in milliseconds. */
const refreshMargin = 30_000

/**
 * Creates a Tempo client with an account and a chain, so its type holds both. Its `verifyHash`,
 * `verifyMessage`, and `verifyTypedData` take the app's `accessToken`, and count an access key's
 * signature only when the token names the access key, as `Verify.hash` describes.
 */
function build(
  parameters: Omit<
    NonNullable<Parameters<typeof createClient>[0]>,
    'account' | 'chain' | 'transport'
  > & { account: LocalAccount; chain: Chain; transport: Transport },
  options: { verifier: () => AccessToken.create.ReturnType },
) {
  const { verifier } = options
  const client = createClient(parameters)
  return client.extend((base) => ({
    verifyHash: (parameters: Omit<Verify.hash.Options, 'verifier'>) =>
      Verify.hash(base, { ...parameters, verifier }),
    verifyMessage: (parameters: Omit<Verify.message.Options, 'verifier'>) =>
      Verify.message(base, { ...parameters, verifier }),
    verifyTypedData: (parameters: Omit<Verify.typedData.Options, 'verifier'>) =>
      Verify.typedData(base, { ...parameters, verifier }),
  }))
}

/** The members of a client that are its settings, not its actions, which the instance leaves out. */
const internal = new Set<string>([
  'account',
  'batch',
  'cacheTime',
  'ccipRead',
  'chain',
  'dataSuffix',
  'extend',
  'key',
  'name',
  'pollingInterval',
  'request',
  'scope',
  'tokens',
  'transport',
  'type',
  'uid',
] satisfies readonly viem.Internal[])
