/**
 * The entry for MPP: `mpp`, a plugin that adds `tempoId.fetch` and `tempoId.mpp`, which pay the
 * 402 challenges of Machine Payments Protocol (MPP) endpoints with the session's access key,
 * through mppx.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { mpp } from 'accounts/mpp'
 * import { dialog } from 'accounts/plugins'
 *
 * const tempoId = Accounts.create({ accessKey, plugins: [dialog(), mpp()] })
 *
 * await tempoId.dialog.signIn()
 * const response = await tempoId.fetch('https://api.example.com/fortune')
 * ```
 * @module
 */
import { Mppx, tempo } from 'mppx/client'
import type { Chain, Client, Transport } from 'viem'
import { createClient, formatUnits, parseUnits } from 'viem'
import type { Account } from 'viem/tempo'
import * as AccessKey from '../AccessKey.js'
import * as Accounts from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import { settings, viem } from '../plugins/viem.js'
import type * as Session from '../Session.js'

/** A charge costs more than `maxAmount`, so the payer signs nothing. */
export class MaxAmountError extends Error {
  override readonly name = 'mpp.MaxAmountError'

  constructor(options: MaxAmountError.Options) {
    super(
      `The charge of ${options.amount} exceeds the \`maxAmount\` of ${options.maxAmount}. Raise \`maxAmount\` to pay it.`,
    )
  }
}

export declare namespace MaxAmountError {
  type Options = {
    /** The charge's amount, in the units of its token. */
    amount: string
    /** The most that a charge may cost, in the units of its token. */
    maxAmount: string
  }
}

/** `maxAmount` names a fraction finer than a TIP-20 token's 6 decimals, so the payer signs nothing. */
export class MaxAmountPrecisionError extends Error {
  override readonly name = 'mpp.MaxAmountPrecisionError'

  constructor(options: MaxAmountPrecisionError.Options) {
    super(
      `Invalid \`maxAmount\`: ${options.maxAmount} has more than 6 decimals. Round it to 6 decimals.`,
    )
  }
}

export declare namespace MaxAmountPrecisionError {
  type Options = {
    /** The most that a charge may cost, as the payer received it. */
    maxAmount: string
  }
}

/**
 * Returns the plugin of MPP payments, which adds `tempoId.fetch` and `tempoId.mpp`. `tempoId.fetch`
 * is `fetch` that pays each charge an endpoint challenges for, and `tempoId.mpp.session()` returns
 * a session manager, which pays each request of a channel with a voucher. The access key of the
 * instance's session signs every payment, so no payment reaches the account's owner.
 * `tempoId.mpp({ session })` returns a payer of a fixed session's access key, such as one that
 * `tempoId.backend.get` returns.
 *
 * The plugin reads the chains and transports of the `viem` plugin, or of a `viem` plugin of its
 * own without one in `plugins`. `mppx` is an optional peer dependency of `accounts`.
 *
 * @example
 * ```ts
 * const tempoId = Accounts.create({ accessKey, plugins: [dialog(), mpp()] })
 *
 * const response = await tempoId.fetch('https://api.example.com/fortune')
 *
 * const session = tempoId.mpp.session()
 * await session.fetch('https://api.example.com/content')
 * await session.close()
 * ```
 */
export function mpp(options: mpp.Options = {}) {
  const { fetch } = options
  // The context of each instance, by its configuration, since an app can pass one plugin to
  // several instances.
  const contexts = new WeakMap<Accounts.Config, Plugin.Context>()

  return Plugin.from({
    extend(instance: Accounts.Accounts) {
      const context = contexts.get(instance.config)!
      const held = (instance as unknown as { viem?: viem.Namespace }).viem
      const namespace = held ?? (viem().actions!(context) as viem.Namespace)
      const { chain: chainOf, transport } = namespace[
        settings as never
      ] as unknown as viem.Settings
      // A client without an account reads the chain and broadcasts. The access key signs.
      const clients = new Map<number, Client<Transport, Chain>>()
      // The payers of each access key, one for each setting of the charges.
      const payers = new WeakMap<AccessKey.AccessKey, Map<string, mpp.Payer>>()

      /** Returns the client of the chain of `chainId`, which the viem plugin resolves. */
      function getClient(parameters: { chainId?: number | undefined } = {}) {
        const chainId = parameters.chainId ?? instance.config.chainId
        const existing = clients.get(chainId)
        if (existing) return existing
        const chain = chainOf(chainId)
        if (!chain)
          throw new Error(
            `Invalid chain: ${chainId} is not a Tempo chain, and the viem plugin's options name no \`chain\`. Return its definition as \`chain\`.`,
          )
        // The client is the chain's own, so its chain ID needs no `eth_chainId` request, which viem's
        // `signTransaction` otherwise sends before each charge.
        const client = createClient({
          chain,
          transport: transport(chainId),
        }).extend(() => ({ getChainId: () => Promise.resolve(chain.id) }))
        clients.set(chainId, client)
        return client
      }

      /**
       * Returns the payer of the access key of `overrides.session`, or of the instance's session,
       * with the plugin's settings under `overrides`.
       */
      function payer(overrides: mpp.Overrides) {
        const current = overrides.session ?? context.session.get()
        if (!current) throw new Accounts.SignedOutError()
        if (!current.key) throw new Accounts.KeyRequiredError()
        const maxAmount = overrides.maxAmount ?? options.maxAmount
        const maxDeposit = overrides.maxDeposit ?? options.maxDeposit
        const mode = overrides.mode ?? options.mode
        const account = AccessKey.toAccount(AccessKey.from(current.key), {
          accessKey: overrides.accessKey,
        })
        // A payer of an app's own access key is not cached, since the session's key does not name it.
        if (overrides.accessKey)
          return create({
            account,
            fetch,
            getClient,
            maxAmount,
            maxDeposit,
            mode,
          })
        let byKey = payers.get(current.key)
        if (!byKey) payers.set(current.key, (byKey = new Map()))
        // JSON keeps an absent setting apart from an empty one, so an empty `maxAmount` still fails.
        const name = JSON.stringify([
          maxAmount ?? null,
          maxDeposit ?? null,
          mode ?? null,
        ])
        const existing = byKey.get(name)
        if (existing) return existing

        const created = create({
          account,
          fetch,
          getClient,
          maxAmount,
          maxDeposit,
          mode,
        })
        byKey.set(name, created)
        return created
      }

      /** Returns the payer that resolves its access key at each call, as `payer` does. */
      function bind(overrides: mpp.Overrides = {}): mpp.Payer {
        return {
          // A missing session or access key rejects the request, as a failed fetch does. The
          // instance reads its stored session only at `load`, so a payment loads it first, as the
          // core actions do.
          fetch: async (input, init) => {
            if (!overrides.session) await context.session.load()
            return payer(overrides).fetch(input, init)
          },
          session: (parameters) => payer(overrides).session(parameters),
        }
      }

      const current = bind()

      return {
        fetch: current.fetch,
        mpp: Object.assign(bind, { session: current.session }) as mpp.Namespace,
      }
    },
    id: 'mpp',
    setup(value) {
      contexts.set(value.config, value)
    },
  })
}

export declare namespace mpp {
  type Options = Settings & {
    /** Sends each request to an endpoint, and its paid retry. Defaults to the global `fetch`. */
    fetch?: typeof globalThis.fetch | undefined
  }

  /** The settings of the payments, which the plugin's options set and a call overrides. */
  type Settings = {
    /**
     * The most that a charge may cost, in the units of its token, such as `'0.1'`, with at most 6
     * decimals. A larger charge throws `mpp.MaxAmountError` before the access key signs, and a finer
     * `maxAmount` throws `mpp.MaxAmountPrecisionError`. Defaults to no maximum, within the access
     * key's token limits.
     */
    maxAmount?: string | undefined
    /**
     * The most that a session's channel holds, in the units of its token, such as `'0.05'`. It
     * caps the deposit that an endpoint suggests and each automatic top-up. A manager's own
     * `topUp(amount)` adds `amount` as given. Defaults to the deposit that the endpoint suggests,
     * within the access key's token limits.
     */
    maxDeposit?: string | undefined
    /**
     * Who broadcasts a charge's transaction: the endpoint (`'pull'`) or the app (`'push'`).
     * Defaults to `'pull'`.
     */
    mode?: 'pull' | 'push' | undefined
  }

  /** The overrides of a payer, for one call. */
  type Overrides = Settings & {
    /**
     * The access key that the app supplied to the sign-in, which signs for a session's access key
     * without material. Absent, a session's access key without material throws
     * `AccessKey.AccessKeyRequiredError` at each payment.
     */
    accessKey?: Account.Account | undefined
    /**
     * A fixed session, such as one that `tempoId.backend.get` returns, whose access key pays.
     * Defaults to the instance's session, read at each payment.
     */
    session?: Session.Session | undefined
  }

  /** The payments of one access key. */
  type Payer = {
    /**
     * Sends a request, and pays a 402 charge challenge with the access key, then returns the
     * endpoint's response to the paid retry. Without a fixed `session`, it loads the instance's
     * stored session first. Throws `Accounts.SignedOutError` without a session, and
     * `Accounts.KeyRequiredError` for a session without an access key.
     */
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    /**
     * Returns a session manager of mppx, which opens a channel on the first request of a session
     * endpoint, pays each request with a voucher of the access key, and closes the channel at
     * `close()`. The manager holds the channel in memory, so close it before it is discarded. It
     * reads the instance's session without loading it, so read the session first, such as with
     * `tempoId.session.get()`, after a reload or a restart.
     */
    session: (
      parameters?: Omit<
        Parameters<typeof tempo.session.manager>[0],
        'account' | 'client' | 'getClient'
      >,
    ) => ReturnType<typeof tempo.session.manager>
  }

  /**
   * `tempoId.mpp`: the session manager of the instance's session, and a call that returns a payer
   * with overrides, such as another session.
   */
  type Namespace = Pick<Payer, 'session'> & ((overrides?: Overrides) => Payer)
}

/** Creates the payer of `account`. */
function create(options: {
  account: Account.AccessKeyAccount
  fetch: typeof globalThis.fetch | undefined
  getClient: (parameters: { chainId?: number | undefined }) => Client
  maxAmount: string | undefined
  maxDeposit: string | undefined
  mode: 'pull' | 'push' | undefined
}): mpp.Payer {
  const { account, fetch, getClient, maxAmount, maxDeposit, mode } = options
  const mppx = Mppx.create({
    ...(fetch ? { fetch } : {}),
    methods: [tempo.charge({ account, getClient, ...(mode ? { mode } : {}) })],
    // The payer reads each charge's amount before the access key signs. A TIP-20 token has 6
    // decimals.
    onChallenge: (challenge) => {
      if (maxAmount === undefined) return Promise.resolve(undefined)
      // `parseUnits` rounds a finer fraction, which could raise the maximum by a base unit.
      const [, fraction = ''] = maxAmount.split('.')
      if (fraction.replace(/0+$/, '').length > 6)
        throw new MaxAmountPrecisionError({ maxAmount })
      const amount = BigInt(String(challenge.request.amount ?? 0))
      if (amount > parseUnits(maxAmount, 6))
        throw new MaxAmountError({ amount: formatUnits(amount, 6), maxAmount })
      return Promise.resolve(undefined)
    },
    // The payer pays only through its own `fetch`, so the app's other requests stay unchanged.
    polyfill: false,
  })
  return {
    fetch: (input, init) => mppx.fetch(input, init),
    session: (parameters = {}) =>
      tempo.session.manager({
        ...(fetch ? { fetch } : {}),
        ...(maxDeposit ? { maxDeposit } : {}),
        ...parameters,
        account,
        getClient,
      }),
  }
}
