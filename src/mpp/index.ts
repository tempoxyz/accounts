/**
 * The entry for MPP: `mpp`, a plugin that adds `accounts.fetch` and `accounts.mpp`, which pay the
 * 402 challenges of Machine Payments Protocol (MPP) endpoints with the session's access key,
 * through mppx.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { mpp } from 'accounts/mpp'
 * import { dialog } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ accessKey, plugins: [dialog(), mpp()] })
 *
 * await accounts.dialog.signIn()
 * const response = await accounts.fetch('https://api.example.com/fortune')
 * ```
 * @module
 */
import { type Challenge, Credential, Expires, Receipt } from 'mppx'
import { Mppx, Transport as MppxTransport, tempo } from 'mppx/client'
import * as TempoId from 'mppx/extensions/identity/tempo'
import { McpClient } from 'mppx/mcp/client'
import { Address, Hash, Hex } from 'ox'
import { KeyAuthorization, TempoAddress, TxEnvelopeTempo } from 'ox/tempo'
import type { Chain, Client, TransactionReceipt, Transport } from 'viem'
import {
  BaseError,
  createClient,
  custom,
  formatUnits,
  parseUnits,
  TransactionReceiptNotFoundError,
  UnknownRpcError,
} from 'viem'
import { getTransactionReceipt } from 'viem/actions'
import { tempoModerato } from 'viem/chains'
import { type Account, Actions, ExecutionError } from 'viem/tempo'
import * as AccountActions from '../actions/account.js'
import * as AccessKey from '../internal/AccessKey.js'
import * as Api from '../internal/Api.js'
import * as FeeAllowance from '../internal/FeeAllowance.js'
import * as Charge from '../internal/mpp/Charge.js'
import * as Retry from '../internal/viem/Retry.js'
import * as Token from '../internal/viem/Token.js'
import * as Accounts from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import { RetryClosedError, settings, viem } from '../plugins/viem.js'
import type * as Session from '../Session.js'

/**
 * The Tempo Account holds less of a subscription's token than its first period costs, so no dialog
 * opens. On a page, the payer shows the deposit page first, then sends the request again, whose
 * subscription opens the dialog. Only a subscription whose request already sent a credential of
 * another payment, which cannot send again after the deposit page, rejects with this error. Outside
 * a page, and with `retry` or its `balance` off, the payer reads no balance, and never throws it.
 */
export class BalanceError extends Error {
  override readonly name = 'mpp.BalanceError'
  /** The amount that the account lacks, in the units of the token. */
  readonly amount: string
  /** The token's address. */
  readonly token: Address.Address

  constructor(options: BalanceError.Options) {
    super(
      `The Tempo Account holds ${options.amount} less of the token ${options.token} than the subscription's first period costs. Deposit ${options.amount} of the token, then subscribe again.`,
    )
    this.amount = options.amount
    this.token = options.token
  }
}

export declare namespace BalanceError {
  type Options = {
    /** The amount that the account lacks, in the units of the token. */
    amount: string
    /** The token's address. */
    token: Address.Address
  }
}

/**
 * A challenge names another chain than the payer's, so the payer signs nothing and no dialog opens:
 * a session or subscription challenge on another chain, or a 402 response whose every Tempo charge is on
 * another chain. The payer's chain is the chain of the session's access key, or the instance's
 * chain for a named `account`. Without a chain, charge and subscription challenges name Tempo
 * testnet; session challenges use the payer chain.
 */
export class ChainError extends Error {
  override readonly name = 'mpp.ChainError'

  constructor(options: ChainError.Options) {
    const { chainId, intent = 'subscription', requested } = options
    super(
      intent === 'session'
        ? `The session is on chain ${requested}, but the payer acts on chain ${chainId}. Use a session on chain ${chainId}.`
        : intent === 'charge'
          ? `The charge is on chain ${requested}, but the payer acts on chain ${chainId}. Pay on chain ${chainId}.`
          : `The subscription is on chain ${requested}, but the payer acts on chain ${chainId}. Subscribe on chain ${chainId}.`,
    )
  }
}

export declare namespace ChainError {
  type Options = {
    /** The payer's chain: the session's access key's, or the instance's for a named `account`. */
    chainId: number
    /** The intent of the challenge. Defaults to `'subscription'`. */
    intent?: 'charge' | 'session' | 'subscription' | undefined
    /** The chain that the challenge names. */
    requested: number
  }
}

/**
 * A configurable Tempo Account approved a subscription. mppx verifies only a primitive signature of
 * the key authorization, so the payer sends no credential. The merchant never receives the key
 * authorization, so its access key cannot charge.
 */
export class ConfigurableAccountError extends Error {
  override readonly name = 'mpp.ConfigurableAccountError'

  constructor() {
    super(
      'The subscription needs a primitive signature, but a configurable Tempo Account signed it. Subscribe with an account that is not configurable.',
    )
  }
}

/**
 * A charge is outside the access key's signed limits, in a token that they do not name or above the
 * whole limit of its token, and the chain's limits refuse it too, so the payer signs nothing. A
 * limit whose token no scope calls, such as the fee allowance that `Permissions.resolve` returns as
 * `fees`, pays only network fees, so its token counts as one that the limits do not name. Only such
 * a charge reads the chain's limits, since `updateLimit` can raise them.
 * In a browser, Tempo ID's payment page pays such a charge of the instance's session, so only a
 * charge that the page does not pay throws it.
 */
export class LimitError extends Error {
  override readonly name = 'mpp.LimitError'

  constructor(options: LimitError.Options) {
    super(
      options.limit === undefined
        ? `The charge is in token ${options.token}, which the access key's limits do not name. Sign in with an access key whose limits name the token.`
        : `The charge of ${options.amount} exceeds the access key's limit of ${options.limit} left for token ${options.token}. Sign in with an access key whose limit covers the charge.`,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
  }
}

export declare namespace LimitError {
  type Options = {
    /** The charge's amount, in the units of its token. */
    amount: string
    /** The chain's refusal of the charge. Absent for a charge that the payer refuses before it signs. */
    cause?: unknown
    /** The access key's limit of the token that is left, in its units. Absent for a token that the limits do not name. */
    limit?: string | undefined
    /** The charge's token. */
    token: string
  }
}

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

/** `maxAmount` is not a decimal amount of 0 or more, such as `''` or `'-1'`, so the payer sends nothing. */
export class MaxAmountInvalidError extends Error {
  override readonly name = 'mpp.MaxAmountInvalidError'

  constructor(options: MaxAmountInvalidError.Options) {
    super(
      `Invalid \`maxAmount\`: "${String(options.maxAmount)}" is not a decimal amount of 0 or more. Pass a decimal string, such as \`'0.1'\`.`,
    )
  }
}

export declare namespace MaxAmountInvalidError {
  type Options = {
    /** The most that a charge may cost, as the payer received it. */
    maxAmount: string
  }
}

/** `maxAmount` names a fraction finer than a TIP-20 token's 6 decimals, so the payer sends nothing. */
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
 * A payer of a named `account` holds no access key, so it pays only subscriptions, which Tempo ID's
 * dialog approves in a page. Its `session()`, and its `fetch` outside a browser, throw before any
 * request.
 */
export class SubscriptionOnlyError extends Error {
  override readonly name = 'mpp.SubscriptionOnlyError'

  constructor() {
    super(
      'The payer names a Tempo Account without a session, so it pays only subscriptions, in a page. Pay charges and sessions with a session, and subscriptions from a page.',
    )
  }
}

/**
 * The property of a request's `init` whose callback the payer runs before the request sends a
 * credential. mppx names no request in `onChallenge`, and passes a copy of `init` to its events.
 */
const credentialCreated = Symbol('credentialCreated')

/**
 * The property of a request's `init` that holds its charge's turn, which the payer takes once the
 * challenge arrives. mppx passes a copy of `init` to its events.
 */
const turnOf = Symbol('turn')

/**
 * The property of a request's `init` that marks its second send, after the chain refused the key
 * authorization of the first send for good. Each request sends once more at most.
 */
const resent = Symbol('resent')

/** The turn of one request of a payer, which `viem.Registrations['turn']` returns. */
type Turn = {
  /** The IDs of the challenges whose signals the request recorded in the payer's `signals`. */
  challenges?: string[] | undefined
  /** The amount and token of the latest charge that the access key pays. Absent before one. */
  charge?: { amount: bigint; token: Address.Address } | undefined
  /** The latest credential that the request sent. Absent before its signature. */
  credential?: string | undefined
  /**
   * The number of credentials that the request sent. An endpoint can answer several 402 responses
   * in turn, and an earlier payment can settle before a later one fails.
   */
  credentials?: number | undefined
  /** Ends the turn. Absent before the charge's challenge, and once the chain holds the access key. */
  end?: (() => void) | undefined
  /**
   * The offers of the request's latest 402 response while mppx selects none of them. Absent
   * once mppx selects one, such as a subscription.
   */
  offers?: readonly Challenge.Challenge[] | undefined
  /** Whether the request sent a credential, whose transaction can land after a failed request. */
  sent?: boolean | undefined
}

/**
 * Returns the plugin of MPP payments, from `accounts/mpp`, which adds `accounts.fetch` and
 * `accounts.mpp`. They pay the 402 challenges of Machine Payments Protocol (MPP) endpoints through
 * [mppx](https://github.com/wevm/mppx). The access key of the instance's session signs every
 * charge, proof, and voucher, so none reaches the account's owner. Each member reads the instance's
 * session at each payment, and `fetch` loads the stored session first, such as after a reload.
 * An abort of the request's signal rejects a charge also while its read of the store stalls.
 *
 * - `accounts.fetch`: `fetch` that pays each charge an endpoint challenges for, with the access key
 *   of the instance's session, and in a browser each subscription.
 * - `accounts.mpp.session()`: A session manager, which pays each request of a channel with a
 *   voucher.
 * - `accounts.mpp({ … })`: A payer with overrides, such as a `maxAmount`, a named `account`, or a
 *   fixed `session`, whose access key pays, such as one that `accounts.backend.get` returns.
 * - `accounts.mpp().mcp(client)`: A caller of an MCP server's tools, which pays each tool's charge
 *   in the JSON-RPC messages, through an MCP SDK client.
 *
 * In a browser, `accounts.fetch` also pays an MPP subscription, the exception to the access key's
 * signature. The user approves the merchant's access key once in Tempo ID's dialog, and the
 * merchant charges each period with it. The session's own access key stays unchanged. A page
 * without a session, whose backend holds the user's session, pays a subscription with
 * `accounts.mpp({ account })`, for the account that its backend names.
 *
 * The plugin reads the chain and transport of each chain ID from the `viem` plugin. Without a
 * `viem` plugin in `plugins`, it uses a `viem` plugin of its own, with Tempo's chains and their own
 * RPC. `mppx` is an optional peer dependency of `accounts`, so an app that pays MPP endpoints
 * installs it beside the package.
 *
 * The plugin shares the `viem` plugin's record of the access keys that the chain registered, which
 * the instance's `store` keeps across runs. A charge that registers an access key adds it to the
 * record, also when the endpoint broadcasts the transaction. Later charges and transactions of that
 * access key attach no key authorization, which the chain refuses, so each sends one RPC request in
 * `pull` mode. This holds in a new instance on the same `store`, such as a new run of a CLI on
 * `Store.file`.
 * Concurrent charges of one instance for an access key that the chain does not hold attach its key
 * authorization once: each later charge waits until the earlier one settles, then signs without it. A turn lasts
 * at most 5 seconds, then one waiting charge takes it, so an endpoint that stalls blocks no other
 * charge for longer. Instances on one `store`, such as the processes of a server, take no shared
 * turn. If another instance registers the access key first, the endpoint refuses the charge. The
 * payer then reads the chain, and sends the request once more without the key authorization.
 *
 * On a page, a payment that fails for a low balance shows Tempo ID's deposit page in a frame, and
 * pays again once a deposit arrives, as `retry` describes. A charge also signs in for a new access
 * key after a spent limit, or for an access key that the chain does not hold. Outside a page, a
 * charge of an instance whose `device` plugin has `onCode` retries a low balance and a spent limit
 * through a device code.
 *
 * In a browser, Tempo ID's payment page pays a charge of the instance's session that no access key
 * pays: a charge of a session whose access keys sign no transaction here, or a charge outside the
 * access key's limits. The user approves the charge's transfer on the page, Tempo ID's sponsor pays
 * the fee, and the credential names the transaction's hash, as mppx's `push` mode does. The page
 * sends one transfer, so a charge of zero, a charge with splits, and a charge of an endpoint or a
 * payer that permits only `pull` need the access key.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { mpp } from 'accounts/mpp'
 * import { dialog } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ accessKey, plugins: [dialog(), mpp()] })
 *
 * await accounts.dialog.signIn()
 * const response = await accounts.fetch('https://api.example.com/fortune')
 *
 * // A page whose backend holds the session.
 * await accounts.mpp({ account }).fetch('/api/subscription')
 *
 * // A payer of a fixed session, which sorts the offers by the account's balances.
 * await accounts
 *   .mpp({
 *     orderChallenges: async (candidates) => {
 *       const balances = await balancesOf(connection.accessKey.account)
 *       return [...candidates].sort(
 *         (a, b) => rank(b.challenge, balances) - rank(a.challenge, balances),
 *       )
 *     },
 *     session: connection,
 *   })
 *   .fetch(url)
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
      // The registrations of the viem plugin, which its store keeps, so a charge after an earlier
      // run's charge or transfer attaches no key authorization, which the chain refuses.
      const {
        chain: chainOf,
        registrations,
        retry,
        transport,
      } = namespace[settings as never] as unknown as viem.Settings
      // A client without an account reads the chain and broadcasts. The access key signs.
      const clients = new Map<number, Client<Transport, Chain>>()
      // The payers of each access key, one for each setting of the charges.
      const payers = new WeakMap<AccessKey.AccessKey, Map<string, mpp.Payer>>()
      // The changes that ended the instance's session, or replaced it with one of another user or
      // Tempo Account. One subscription per instance holds it, so a discarded manager holds none.
      let ends = 0
      instance.session.subscribe((next, before) => {
        if (!before || next?.user.id !== before.user.id) ends++
      })

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
        // The retry reads the mark of each refused send, so it retries only a payment that the node
        // did not take.
        const client = createClient({
          chain,
          transport: retry.transport(
            registrations.watch(transport(chainId), chainId),
          ),
        }).extend(() => ({ getChainId: () => Promise.resolve(chain.id) }))
        clients.set(chainId, client)
        return client
      }

      /**
       * Returns the kinds of failure that a payer with `overrides` retries on the chain of
       * `chainId`: the viem plugin's `retry`, with the payer's `retry` over it, or `false` for none.
       */
      function retries(overrides: mpp.Overrides, chainId: number) {
        return retry.kinds(chainId, overrides.retry ?? options.retry)
      }

      /**
       * Returns whether a payer with `overrides` shows the deposit page for a balance below a
       * payment on the chain of `chainId`.
       */
      function funds(overrides: mpp.Overrides, chainId: number) {
        const enabled = retries(overrides, chainId)
        return enabled !== false && enabled.balance !== false
      }

      /**
       * Calls `send`, and after a failure that a screen of Tempo ID resolves, shows the screen, then
       * calls `send` again: the deposit page for a balance below a payment, and a sign-in for a new
       * access key for a spent limit or an access key that the chain does not hold. Each kind
       * retries once. A failure of a kind outside `options.kinds` rejects as it is.
       */
      function retried<value>(
        send: () => Promise<value>,
        options: {
          /**
           * The access key that pays, for a payment that keeps its own, such as a session manager's.
           * Its Tempo Account receives a deposit, on its chain. Defaults to the session's active
           * access key at each payment.
           */
          accessKey?:
            | Pick<AccessKey.AccessKey, 'account' | 'chainId'>
            | undefined
          /** The kinds of failure that the payment can send again after. */
          kinds: readonly Retry.Kind[]
          overrides: mpp.Overrides
          /** Returns whether `send` can run again. Defaults to `true`. */
          replayable?: (() => boolean) | undefined
          /**
           * The signal of the payment's request. Its abort rejects the payment with its reason, and
           * closes a screen of the retry that no other call waits on, as the `retry` option's signal
           * does.
           */
          signal?: AbortSignal | undefined
        },
      ) {
        const { kinds, overrides, replayable = () => true } = options
        // A payer of a named account holds no session.
        const session = () =>
          overrides.account ? undefined : context.session.get()
        // The session that the first payment started with, whose user and Tempo Account each retry
        // pays for.
        const started = session()
        // The session that the latest payment started with, which its fix reads.
        let state = started
        // A fix adds an access key only on the payment's chain, so each retry pays on the same one.
        // A chain switch changes the session's active access key, not the one that a manager keeps.
        const accessKey = options.accessKey ?? state?.accessKey
        const chainId = accessKey
          ? Number(accessKey.chainId)
          : instance.config.chainId
        const enabled = retries(overrides, chainId)
        // Outside a page, a deposit signs in for a new access key, which a manager that keeps its
        // own access key does not pay with.
        if (
          enabled === false ||
          (options.accessKey && typeof document === 'undefined')
        )
          return send()
        const signals = [enabled.signal, options.signal].filter(
          (value) => value !== undefined,
        )
        const signal =
          signals.length > 1 ? AbortSignal.any(signals) : signals[0]

        return Retry.attempt(
          async () => {
            state = session()
            // A screen stays open while the session can change, such as through another tab's
            // sign-in. A session of another user, or one without the Tempo Account that the payment
            // started with, pays nothing for it. A manager's own access key runs its own check.
            if (
              !options.accessKey &&
              started?.accessKey &&
              !owns(state, {
                account: started.accessKey.account,
                session: started,
              })
            )
              throw new Accounts.SignedOutError()
            return send()
          },
          {
            classify: (error) => {
              // A spent limit that the chain refused carries the chain's error, which a page retries.
              const failure =
                shortfall(error) ??
                retry.classify(
                  error instanceof LimitError && error.cause !== undefined
                    ? error.cause
                    : error,
                )
              return failure && kinds.includes(failure.kind) && replayable()
                ? failure
                : undefined
            },
            enabled: (kind) => enabled[kind] !== false,
            fix: async (failure, error) => {
              const address =
                overrides.account ??
                options.accessKey?.account ??
                state?.accessKey?.account
              // A payment without an account, such as one after a sign-out, shows no screen.
              if (!address) throw error
              try {
                await retry.fix(failure, {
                  address,
                  chainId,
                  error,
                  signal,
                  state,
                })
              } catch (reason) {
                // A subscription's balance read predicts a charge that only the merchant decides,
                // such as none for a period that is already paid. So after a deposit page that the
                // user closes, the request sends again, and its subscription opens the dialog.
                if (!(shortfall(error) && reason instanceof RetryClosedError))
                  throw reason
              }
            },
            signal,
          },
        )
      }

      /**
       * Sends `transfer`, which pays a charge, through Tempo ID's payment page, from the session's
       * Tempo Account on the chain of `options.chainId`. The page resolves once the chain includes
       * the transaction, whose receipt the endpoint reads. An abort of `options.signal` closes the
       * page.
       */
      async function pay(
        transfer: Charge.Transfer,
        options: { chainId: number; signal: AbortSignal | undefined },
      ) {
        const { chainId, signal } = options
        const account = await Token.payer(context, { chainId })
        if (!account) throw new Accounts.SignedOutError()

        const { transaction } = await AccountActions.pay(instance.config, {
          account,
          amount: formatUnits(transfer.amount, 6),
          chainId,
          memo: transfer.memo,
          signal,
          to: transfer.to,
          token: transfer.token,
        })
        return { account, hash: transaction }
      }

      /**
       * Returns the amount that the Tempo Account of a subscription lacks for its first period, of
       * the first token whose balance is below its limit. Returns `undefined` for an account that
       * holds each amount, and for a failed read, which leaves the decision to the merchant.
       */
      async function lacking(parameters: mpp.Subscription) {
        const client = getClient({ chainId: parameters.chainId })
        const balances = await Promise.all(
          parameters.limits.map((entry) =>
            // A TIP-20 token holds 6 decimals, so the read asks for none.
            Actions.token.getBalance(client, {
              account: parameters.account,
              decimals: 6,
              token: entry.token,
            }),
          ),
        ).catch(() => undefined)
        if (!balances) return undefined
        for (const [index, entry] of parameters.limits.entries()) {
          const missing = Hex.toBigInt(entry.limit) - balances[index]!.amount
          if (missing > 0n)
            return { amount: formatUnits(missing, 6), token: entry.token }
        }
        return undefined
      }

      /**
       * Requests Tempo ID's signature of a subscription's access key, which the merchant holds, in
       * a dialog. The sign-in authorizes that access key only, so the instance's session keeps its
       * own. With `options.balance`, a balance below the first period, which a merchant charges at
       * the start of a subscription, throws `mpp.BalanceError` before the dialog opens, so the payer
       * shows the deposit page.
       */
      async function subscribe(
        parameters: mpp.Subscription,
        options: {
          /** Whether a balance below the subscription's first period rejects before the dialog. */
          balance: boolean
        },
      ): Promise<mpp.Subscription.ReturnType> {
        // The dialog loads from a chunk of its own, so a backend's bundle holds it only if it pays a
        // subscription, which only a page does. The balance read runs beside the load.
        const [Dialog, missing] = await Promise.all([
          import('../actions/dialog.js'),
          options.balance ? lacking(parameters) : undefined,
        ])
        if (missing) throw new BalanceError(missing)
        const authorization = await Dialog.signIn(context.config, {
          accessKey: {
            access: parameters.account,
            address: parameters.address,
            chainId: parameters.chainId,
            expiry: parameters.expiry,
            limits: parameters.limits.map((entry) => ({
              limit: Hex.toBigInt(entry.limit),
              period: entry.period,
              token: entry.token,
            })),
            scopes: parameters.scopes,
            type: parameters.keyType,
            witness: parameters.witness,
          },
        })
        // mppx refuses a configurable signature with a generic error, so the payer names the fault.
        const { signature } = KeyAuthorization.fromRpc(
          authorization.accessKey.keyAuthorization,
        )
        if (signature?.type === 'configurable')
          throw new ConfigurableAccountError()
        return {
          keyAuthorization: authorization.accessKey.keyAuthorization,
          rootAddress: authorization.accessKey.account,
        }
      }

      /**
       * Returns the payer of the access key of `overrides.session`, or of the instance's session,
       * with the plugin's settings under `overrides`. With `signing.check`, the access key runs it
       * before each signature, and the payer is not cached. With `signing.balance` off, a
       * subscription reads no balance before its dialog. With `signing.page`, Tempo ID's payment page
       * pays a charge of the instance's session that no access key pays, in a page, and an abort of
       * `signing.signal` closes it. A payer with a signal is not cached.
       */
      /**
       * Returns the prover of the instance's session for `options.identity`, or `undefined` without
       * it. Each request reads the session's current tokens, and none once `ended` returns true.
       */
      function prover(ended: () => boolean) {
        if (!options.identity) return undefined
        const { scope } = options.identity
        const read = async () => {
          if (ended()) throw new Accounts.SignedOutError()
          const accessToken = await instance.session.accessToken()
          if (ended()) throw new Accounts.SignedOutError()
          return accessToken
        }
        // Only a DPoP token takes the `DPoP` scheme and a proof. A Bearer token, such as one that the
        // store saved before the app set its `dpop` key, goes as `Bearer`, as `session.fetch` sends
        // it, since an API refuses a scheme that does not match the token's binding.
        const from = (accessToken: string) =>
          TempoId.Client.prover({
            accessToken: () => accessToken,
            dpop: Api.bound(accessToken) ? instance.config.dpop : undefined,
            idToken: () =>
              ended() ? undefined : context.session.get()?.idToken,
            scope,
          })
        return {
          ...from(''),
          async prove(request, attempt) {
            const accessToken = await read().catch((error: unknown) => {
              // A request with a credential, such as the paid retry of a pushed transfer or a
              // session manager's close, still goes out, without the tokens it can no longer read.
              if (attempt.challenge || paid(request)) return undefined
              throw error
            })
            if (accessToken === undefined) return request
            return from(accessToken).prove(request, attempt)
          },
        } satisfies ReturnType<typeof TempoId.Client.prover>
      }

      function payer(
        overrides: mpp.Overrides,
        signing: {
          balance?: boolean | undefined
          check?: (() => void) | undefined
          page?: boolean | undefined
          signal?: AbortSignal | undefined
        } = {},
      ) {
        const settings = {
          autoSwap: overrides.autoSwap ?? options.autoSwap,
          clientId: overrides.clientId ?? options.clientId,
          // An untyped `null` is a malformed `maxAmount`, so only `undefined` falls back.
          maxAmount:
            overrides.maxAmount !== undefined
              ? overrides.maxAmount
              : options.maxAmount,
          maxDeposit: overrides.maxDeposit ?? options.maxDeposit,
          mode: overrides.mode ?? options.mode,
          orderChallenges: overrides.orderChallenges ?? options.orderChallenges,
        }
        // A named Tempo Account without a session, such as a backend session's, holds no access
        // key, so only the dialog's approval of a subscription pays for it.
        if (!overrides.session && overrides.account) {
          if (typeof document === 'undefined') throw new SubscriptionOnlyError()
          const chainId = instance.config.chainId
          const balance = signing.balance !== false && funds(overrides, chainId)
          return create({
            ...settings,
            account: undefined,
            address: overrides.account,
            chainId,
            fees: [],
            fetch,
            getClient,
            identity: undefined,
            landed: registrations.landed,
            limits: undefined,
            pay: undefined,
            subscribe: (parameters) => subscribe(parameters, { balance }),
            turn: registrations.turn,
            verify: undefined,
          })
        }

        const current = overrides.session ?? context.session.get()
        if (!current) throw new Accounts.SignedOutError()
        // Only a page shows the payment page, and only for the instance's own session.
        const paged =
          signing.page === true &&
          !overrides.session &&
          typeof document !== 'undefined'
        // No access key of the session signs here, and no sign-in adds one, so the payment page
        // pays each charge. The payer holds no access key, so it is the same for each session.
        if (
          paged &&
          Token.ownerSends(current, { chainId: instance.config.chainId })
        ) {
          const chainId = instance.config.chainId
          // The instance's session sends its identity while it holds the same user, as the access
          // key's payer below does.
          const started = ends
          const user = context.session.get()?.user.id
          const identity = prover(
            () => ends !== started || context.session.get()?.user.id !== user,
          )
          return create({
            ...settings,
            account: undefined,
            address: undefined,
            chainId,
            fees: [],
            fetch,
            getClient,
            identity,
            landed: registrations.landed,
            limits: undefined,
            pay: (transfer) =>
              pay(transfer, { chainId, signal: signing.signal }),
            subscribe: undefined,
            turn: registrations.turn,
            verify: undefined,
          })
        }
        if (!current.accessKey) throw new Accounts.AccessKeyRequiredError()
        // The chain refuses an expired access key, so the payer sends no request. A payment of the
        // instance's session refuses it too, since `load` empties an expired session.
        if (AccessKey.expired(current.accessKey))
          throw new Accounts.SignedOutError()
        const { clientId, maxAmount, maxDeposit, mode } = settings
        const accessKey = AccessKey.from(current.accessKey)
        // The store read of the access key's registration runs beside the request, and the access
        // key's fill waits for it. A connection lists every access key that the API holds in
        // `accessKeys`, so only the mark of its `accessKey` is read.
        registrations.hydrate(
          'resource' in current ? { accessKey: current.accessKey } : current,
        )
        // Another instance on the store, such as another process of a server, signs out without a
        // message to this one, so a charge of the instance's session reads the store before the
        // access key signs. A failed read, such as a store's timeout, keeps the held session, as
        // the core actions' reloads do. A browser's tabs receive each sign-out as a message, whose
        // handler also runs the plugins' hooks, so a tab reads nothing.
        const held = overrides.session ? undefined : context.session.get()
        const reads = held !== undefined && !messaged()
        // A sign-out ends the payer for good, so a later sign-in of the same user does not resume
        // its access key for a request that started before the sign-out.
        const started = ends
        // Whether the instance's session ended, or no longer holds this payer's user and Tempo
        // Account, such as after a sign-out or a sign-in of another user, in this tab or in another
        // one. A sign-out does not revoke the access key, so the chain would still accept its
        // signature.
        const ended = () => {
          if (!held) return false
          return (
            ends !== started ||
            !owns(context.session.get(), {
              account: accessKey.account,
              session: held,
            })
          )
        }
        // A fixed session's tokens may belong to another context, so only the instance's session
        // sends its identity, and each request reads its current tokens. They go only with this
        // payer's user: once the session ends or holds another user, the request carries none of
        // that user's tokens beside this payer's payment.
        const identity = held ? prover(ended) : undefined
        // The access key can expire, and the session can end, while the request waits for its 402,
        // so the charge checks both again before the access key signs. The payer signs nothing
        // that the chain refuses, and nothing for a session that ended.
        // A store that stalls, such as one that queues commands while it reconnects, answers no
        // read, so an abort of the request's signal rejects the charge during the read.
        const verify = async (options: {
          signal?: AbortSignal | undefined
        }) => {
          if (AccessKey.expired(accessKey)) throw new Accounts.SignedOutError()
          if (reads)
            await Retry.abortable(
              context.session.reload().catch(() => undefined),
              { signal: options.signal },
            )
          if (ended()) throw new Accounts.SignedOutError()
          // The access key can also expire while the store read runs, such as a store's timeout.
          if (AccessKey.expired(accessKey)) throw new Accounts.SignedOutError()
        }
        // Only a page shows the dialog where the user approves a subscription, and only for the
        // instance's own session. The tab may sign out or switch accounts before the challenge
        // arrives, so the dialog opens only while the session still holds this payer's account.
        // An access key authorizes one chain, so the payer skips a charge offer on any other chain.
        const chainId = Number(accessKey.chainId)
        // Whether a subscription of a balance below its first period shows the deposit page first.
        const balance = signing.balance !== false && funds(overrides, chainId)
        const subscriber =
          held && typeof document !== 'undefined'
            ? (parameters: mpp.Subscription) => {
                if (ended()) throw new Accounts.SignedOutError()
                return subscribe(parameters, { balance })
              }
            : undefined
        const tracked = registrations.track(
          AccessKey.toAccount(accessKey, {
            signer: overrides.signer,
          }),
        )
        // A charge prepares its transaction after `onChallenge`, such as with RPC reads, so the
        // access key can expire, and the session can end, before it signs. A session manager's own
        // check lets `close` sign after the expiry, so only a charge's access key checks both at
        // each signature.
        const account = checked(tracked, {
          check:
            signing.check ??
            (() => {
              if (AccessKey.expired(accessKey) || ended())
                throw new Accounts.SignedOutError()
            }),
        })
        const { limits } = current.accessKey.keyAuthorization
        const fees = FeeAllowance.of(current.accessKey.keyAuthorization)
        // The payment page pays a charge outside the access key's limits.
        const remote = paged
          ? (transfer: Charge.Transfer) =>
              pay(transfer, { chainId, signal: signing.signal })
          : undefined
        // A payer of an app's own access key is not cached, since the session's access key does not
        // name it. Nor is a payer of a call's own `autoSwap` or `orderChallenges`, which no name
        // holds, a payer whose access key runs a check, a payer whose payment page closes at a
        // request's abort, or a payer of an untyped `maxAmount` that is not a string, whose name
        // could match a valid payer's.
        if (
          overrides.signer ||
          overrides.autoSwap !== undefined ||
          overrides.orderChallenges ||
          signing.check ||
          (paged && signing.signal) ||
          (maxAmount !== undefined && typeof maxAmount !== 'string')
        )
          return create({
            ...settings,
            account,
            address: account.address,
            chainId,
            fees,
            fetch,
            getClient,
            identity,
            landed: registrations.landed,
            limits,
            pay: remote,
            subscribe: subscriber,
            turn: registrations.turn,
            verify,
          })
        let byAccessKey = payers.get(current.accessKey)
        if (!byAccessKey)
          payers.set(current.accessKey, (byAccessKey = new Map()))
        // JSON keeps an absent setting apart from an empty one, so an empty `maxAmount` still fails.
        // A payer of the instance's session ends with the session, so a later session that holds
        // the same access key takes a new payer.
        const name = JSON.stringify([
          clientId ?? null,
          maxAmount ?? null,
          maxDeposit ?? null,
          mode ?? null,
          reads,
          subscriber !== undefined,
          balance,
          held ? started : null,
          paged,
        ])
        const existing = byAccessKey.get(name)
        if (existing) return existing

        const created = create({
          ...settings,
          account,
          address: account.address,
          chainId,
          fees,
          fetch,
          getClient,
          identity,
          landed: registrations.landed,
          limits,
          pay: remote,
          subscribe: subscriber,
          turn: registrations.turn,
          verify,
        })
        byAccessKey.set(name, created)
        return created
      }

      /** Returns the payer that resolves its access key at each call, as `payer` does. */
      function bind(overrides: mpp.Overrides = {}): mpp.Payer {
        return {
          // A missing session or access key rejects the request, as a failed fetch does. The
          // instance reads its stored session only at `load`, so a payment loads it first, as the
          // core actions do.
          fetch: async (input, init) => {
            if (!overrides.session && !overrides.account)
              await context.session.load()
            // A fixed session signs for a backend, which shows no screen.
            if (overrides.session) return payer(overrides).fetch(input, init)
            // mppx pays each 402 response of one request in turn, so a payment can fail after an
            // earlier one of the same request settled. The request sends again only before its
            // first credential, so no retry pays a settled charge again.
            let sent = false
            const tracked = {
              ...init,
              [credentialCreated]: () => {
                sent = true
              },
            }
            // A subscription reads the balance once for each request, and only for a request that
            // can send again after the deposit page. The read predicts a charge that only the
            // merchant decides, so the request that follows the page reads none, and its
            // subscription opens the dialog, also for a balance that is still too low.
            let balance = resendable(input, init)
            const send = async () => {
              try {
                return await payer(overrides, {
                  balance,
                  page: true,
                  signal: signalOf(input, init),
                }).fetch(input, tracked)
              } catch (error) {
                if (shortfall(error)) balance = false
                throw error
              }
            }
            return retried(send, {
              // A named account holds no access key, so only a deposit resolves its failure.
              kinds: overrides.account
                ? ['balance']
                : ['accessKey', 'balance', 'limit'],
              overrides,
              replayable: () => !sent && resendable(input, init),
              signal: signalOf(input, init),
            })
          },
          // Each call resolves the payer, as `fetch` does, so a call after a load, a renewal, or a
          // sign-out pays with the session that holds then.
          mcp: (client) => ({
            async callTool(params, resultSchema, options) {
              if (!overrides.session && !overrides.account)
                await context.session.load()
              return payer(overrides)
                .mcp(client)
                .callTool(params, resultSchema, options)
            },
          }),
          session(parameters) {
            if (overrides.session) return expiring({ overrides, parameters })
            if (overrides.account) throw new SubscriptionOnlyError()
            if (context.session.get()) return guarded({ overrides, parameters })
            // The instance reads its stored session only at `load`, such as after a restart, so the
            // manager loads it at its first request, as `fetch` does.
            return deferred(async () => {
              // A session in memory before the load, such as after a read of the session since the
              // manager's creation, returns without a store read, so the first request reads it.
              const loaded = !context.session.get()
              await context.session.load()
              return guarded({ loaded, overrides, parameters })
            })
          },
        }
      }

      /**
       * Returns a session manager of a fixed session, which pays nothing once its access key expires,
       * as the fixed session's `fetch` does. Its requests, streams, and top-ups then throw
       * `Accounts.SignedOutError` before any request, and its access key signs nothing. `close`
       * still settles the channel at the amount that the access key signed for.
       */
      function expiring(options: {
        overrides: mpp.Overrides
        parameters: Parameters<mpp.Payer['session']>[0]
      }) {
        const { overrides, parameters } = options
        const accessKey = overrides.session?.accessKey
        const check = () => {
          if (accessKey && AccessKey.expired(accessKey))
            throw new Accounts.SignedOutError()
        }
        // The calls of `close` in progress, whose final voucher the access key signs.
        const closing = { count: 0 }
        const manager = payer(overrides, {
          check: () => {
            if (closing.count === 0) check()
          },
        }).session(parameters)
        // The manager's getters read its own state, so the guard inherits them.
        return Object.create(manager, {
          close: {
            value: async (...args: Parameters<mpp.SessionManager['close']>) => {
              closing.count += 1
              try {
                return await manager.close(...args)
              } finally {
                closing.count -= 1
              }
            },
          },
          fetch: {
            value: async (...args: Parameters<mpp.SessionManager['fetch']>) => {
              check()
              return manager.fetch(...args)
            },
          },
          sse: {
            value: async (...args: Parameters<mpp.SessionManager['sse']>) => {
              check()
              return manager.sse(...args)
            },
          },
          topUp: {
            value: async (...args: Parameters<mpp.SessionManager['topUp']>) => {
              check()
              return manager.topUp(...args)
            },
          },
          ws: {
            value: async (...args: Parameters<mpp.SessionManager['ws']>) => {
              check()
              return manager.ws(...args)
            },
          },
        }) as mpp.SessionManager
      }

      /**
       * Returns a session manager of the instance's session, which pays nothing once the session
       * ends, names another user or Tempo Account, or its access key expires. Its requests, streams,
       * and top-ups throw `Accounts.SignedOutError` before any request. Each one reads the store
       * first outside a browser, so a sign-out of another instance on the store also ends the manager. A failed read
       * keeps the instance's session. Its access key also refuses each signature after this
       * instance's sign-out, so a payment that a request started before it, such as a voucher that a
       * stream requests, signs nothing. A new access key of the same user, such as a limit's
       * renewal, keeps the manager paying with its own access key, which the chain still holds.
       * `close` still settles the channel at the amount that the access key signed for.
       */
      function guarded(options: {
        /** The caller read the store just before, so the first request reads it no more. */
        loaded?: boolean | undefined
        overrides: mpp.Overrides
        parameters: Parameters<mpp.Payer['session']>[0]
      }) {
        const { overrides, parameters } = options
        // Whether the next request skips its store read, since the read before it holds the store's
        // latest copy. Only the first request after the caller's read skips it.
        let fresh = options.loaded === true
        const held = context.session.get()
        const accessKey = held?.accessKey
        // A sign-out ends the manager for good, so a later sign-in of the same user does not resume
        // its access key.
        const started = ends
        const check = () => {
          if (
            !held ||
            !accessKey ||
            ends !== started ||
            AccessKey.expired(accessKey)
          )
            throw new Accounts.SignedOutError()
          // A later session can drop the manager's Tempo Account over several changes, such as a
          // switch that parks it and a sign-in of another one, so each request checks it.
          if (
            !owns(context.session.get(), {
              account: accessKey.account,
              session: held,
            })
          )
            throw new Accounts.SignedOutError()
        }
        // Another instance on the store, such as another process of a server, signs out without a
        // message to this one, so each request reads the store first. A sign-out there empties
        // this instance's session, which ends the manager. A failed read, such as a store's
        // timeout, keeps the instance's session, as the core actions' reloads do. A browser's
        // tabs receive each sign-out as a message, whose handler also runs the plugins' hooks, so
        // a tab reads nothing.
        const checkStored = async () => {
          check()
          if (messaged()) return
          if (fresh) {
            fresh = false
            return
          }
          await context.session.reload().catch(() => undefined)
          check()
        }
        // The calls of `close` in progress. Their final voucher signs the amount spent, and the
        // manager refuses new vouchers while it closes, so the access key signs for them.
        const closing = { count: 0 }
        const manager = payer(overrides, {
          check: () => {
            if (closing.count === 0) check()
          },
        }).session(parameters)
        // The manager keeps its access key, so only a deposit resolves a failure of its channel's
        // open or top-up, which the manager signs again at the next call.
        const funded = <value>(
          send: () => Promise<value>,
          request: Pick<
            Parameters<typeof retried>[1],
            'replayable' | 'signal'
          > = {},
        ) =>
          retried(send, {
            ...request,
            accessKey,
            kinds: ['balance'],
            overrides,
          })
        // The manager's getters read its own state, so the guard inherits them.
        return Object.create(manager, {
          close: {
            value: async (...args: Parameters<mpp.SessionManager['close']>) => {
              closing.count += 1
              try {
                return await manager.close(...args)
              } finally {
                closing.count -= 1
              }
            },
          },
          fetch: {
            value: (...args: Parameters<mpp.SessionManager['fetch']>) =>
              funded(
                async () => {
                  await checkStored()
                  return manager.fetch(...args)
                },
                {
                  replayable: () => resendable(...args),
                  signal: signalOf(...args),
                },
              ),
          },
          sse: {
            value: (...args: Parameters<mpp.SessionManager['sse']>) =>
              funded(
                async () => {
                  await checkStored()
                  return manager.sse(...args)
                },
                {
                  replayable: () => resendable(...args),
                  signal: signalOf(...args),
                },
              ),
          },
          topUp: {
            value: (...args: Parameters<mpp.SessionManager['topUp']>) => {
              // mppx resolves the channel of a top-up at each call. A request can select another
              // channel while the deposit page shows, and the retry must not top up that one.
              const channelId = manager.channelId
              return funded(async () => {
                await checkStored()
                if (manager.channelId !== channelId)
                  throw new Error(
                    "Invalid top-up: the session's channel changed while the top-up waited. Call `topUp` again, which tops up the current channel.",
                  )
                return manager.topUp(...args)
              })
            },
          },
          ws: {
            value: (...args: Parameters<mpp.SessionManager['ws']>) =>
              funded(
                async () => {
                  await checkStored()
                  return manager.ws(...args)
                },
                { signal: args[1]?.signal },
              ),
          },
        }) as mpp.SessionManager
      }

      const current = bind()

      return {
        /** The `fetch` of the payer of the instance's session, as `mpp.Payer` describes it. */
        fetch: current.fetch,
        /**
         * The `session` of the payer of the instance's session. A call returns a payer with
         * overrides. Each payer has two members, `fetch` and `session`, as `mpp.Payer` describes
         * them.
         */
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

    /**
     * Sends the session's Tempo ID identity with each request to the origins of `scope`, for an
     * endpoint that verifies it with mppx's Tempo ID extension (`mppx/extensions/identity/tempo`):
     * the access token, with a new proof of the instance's `dpop` key for a DPoP token, and the ID
     * token, which names the user's email address. A token refresh may return no ID token, and then
     * the requests carry none until the next sign-in, so an endpoint that requires the email can
     * refuse a long session. A payer of a fixed `session` or a named
     * `account` sends none. Defaults to no identity.
     *
     * @example
     * ```ts
     * const accounts = Accounts.create({
     *   plugins: [dialog(), mpp({ identity: { scope: ['https://api.example.com'] } })],
     * })
     * ```
     */
    identity?: Identity | undefined
  }

  /** The identity that a payer sends, as {@link Options.identity} describes. */
  type Identity = {
    /**
     * The origins that receive the access token and the ID token, such as
     * `['https://api.example.com']`, or `'*'` for every origin. Each origin receives tokens that
     * act for the user, so name only endpoints that verify Tempo ID.
     */
    scope: readonly string[] | '*'
  }

  /**
   * The settings of the payments, which the plugin's options set for every payer and a call
   * overrides. A call's settings win over the plugin's. The plugin passes `autoSwap` and
   * `orderChallenges` to mppx as they are.
   */
  type Settings = {
    /**
     * Whether a charge or a session's deposit first swaps another stablecoin into the challenged
     * currency, on Tempo's exchange, when the account holds too little of it. `{ tokenIn }` names
     * the tokens to swap from, in priority order, and `slippage` the tolerance in percent, 1 by
     * default. With `fallback: false`, the swap uses only `tokenIn`. The access key's limits and
     * scopes must cover the swap's approval and order, or the payment fails. Defaults to `false`.
     */
    autoSwap?: AutoSwap | undefined
    /**
     * The identifier of the app, such as `'mercator.sh'`, whose fingerprint each charge's transfer
     * memo carries, beside the challenge and the endpoint's realm, so that an endpoint attributes
     * the payment to the app. The fingerprint is the first 10 bytes of the identifier's Keccak-256
     * hash. A proof and a session's voucher carry none. Defaults to no fingerprint.
     */
    clientId?: string | undefined
    /**
     * The most that a charge, or a subscription's period, may cost, in the units of its token, such
     * as `'0.1'`, with at most 6 decimals. A larger charge throws `mpp.MaxAmountError` before the
     * access key signs. Before any request, a `maxAmount` that is no decimal amount of 0 or more,
     * such as `''` or `'-1'`, throws `mpp.MaxAmountInvalidError`, and a finer one
     * `mpp.MaxAmountPrecisionError`. Defaults to no maximum, within the access key's token limits.
     */
    maxAmount?: string | undefined
    /**
     * The most that a session's channel holds, in the units of its token, such as `'0.05'`. It
     * caps the deposit that an endpoint suggests and each automatic top-up. A manager's own
     * `topUp(amount)` adds `amount` as given, so the app bounds it. Defaults to the deposit that
     * the endpoint suggests, within the access key's token limits.
     */
    maxDeposit?: string | undefined
    /**
     * Who broadcasts a charge's transaction: the endpoint (`'pull'`) or the app (`'push'`).
     * Defaults to `'pull'`.
     */
    mode?: 'pull' | 'push' | undefined
    /**
     * Filters and sorts the offers of a 402 response before the access key signs: its charges and,
     * in a browser, for the instance's session or a named `account`, its subscriptions, whose
     * `challenge.intent` is `subscription`. It returns the candidates in preference order, and the
     * payer pays the first. An empty array pays none. A call's override reads the paying account
     * from its own `session`, such as to sort the offers by the account's balances. Defaults to the
     * endpoint's order.
     */
    orderChallenges?: OrderChallenges | undefined
    /**
     * Which failures of a payment show a screen of Tempo ID in a page, then pay again, with no
     * other action from the app: the deposit page in a frame for a balance below the payment, and
     * the embedded sign-in for a new access key for a spent limit or an access key that the chain
     * does not hold. `false` shows none. An object turns on or off the kinds that it names, over
     * the viem plugin's `retry`, and keeps the other kinds. A call's `retry` replaces the plugin's.
     * Defaults to the viem plugin's `retry` of the chain, which defaults to `true`.
     *
     * - A charge of the instance's session retries `accessKey`, `balance`, and `limit`. The whole
     *   request sends again, whose 402 response starts a new payment.
     * - A session manager of the instance's session retries `balance`. The request, stream, or
     *   top-up sends again, which opens or tops up again.
     * - A subscription retries `balance`. The whole request sends again, whose 402 response opens
     *   the dialog.
     *
     * A payer of a fixed `session` never retries. Outside a page, only a charge retries, and only
     * on an instance whose `device` plugin has `onCode`, through a device code, as the viem
     * plugin's `retry` describes. A request whose body
     * is a stream, or a `Request` whose body the app read, cannot send again, so its failure
     * rejects as it is.
     *
     * Each kind shows the screen of the viem plugin's `retry`. A payment and a transaction that
     * fail for one reason share one screen. A charge and a session's deposit retry only when the
     * node refused the transaction before it took it, so a retry never pays twice. A request can
     * pay several 402 responses in turn. A charge whose request already sent a credential rejects
     * as it is, since the earlier payment can have settled. Each kind retries once for each call.
     * A session manager keeps its own access key, so it retries only `balance`. A retry of
     * `topUp(amount)` tops up only the channel that the call started with.
     *
     * A merchant charges the first period at the start of a subscription, and refuses a Tempo
     * Account that cannot pay it with a generic error, after the user's approval. So with `balance`
     * on, the payer reads the account's balance of each token of the subscription before the dialog
     * opens. A balance below the period's amount shows the deposit page first, for the missing
     * amount. The request then sends again, and its subscription opens the dialog.
     *
     * The read predicts a charge that only the merchant decides, such as none for a period that is
     * already paid. So the dialog also opens after a deposit page that the user closes, and for a
     * balance that is still too low. The read compares only the period's amount, so it covers no
     * fee that the merchant does not sponsor. A failed read opens the dialog. A request that cannot
     * send again reads no balance.
     *
     * An abort of a request's `signal`, as of the `signal` of `retry`, rejects the payment with the
     * signal's reason. The screen closes once no payment or transaction waits on it, so a screen
     * that another payment shares stays open. A session manager's `fetch`, `sse`, and `ws` take the
     * `signal` of their `init`.
     *
     * A screen stays open while the instance's session can change, such as through a sign-in in
     * another tab. If the session then names another user, or holds no access key of the Tempo
     * Account that the charge started with, the charge rejects with `Accounts.SignedOutError`, and
     * pays nothing.
     */
    retry?: viem.RetryOptions | undefined
  }

  /** The tokens that a payment swaps from, as mppx's `autoSwap` takes them. */
  type AutoSwap = NonNullable<
    NonNullable<Parameters<typeof tempo.charge>[0]>['autoSwap']
  >

  /** A caller of an MCP server's tools, which `Payer.mcp` returns. */
  type Mcp = {
    /**
     * Calls a tool, as the client's `callTool` does, and pays its charge with the access key. The
     * result holds the charge's `receipt`, or `undefined` for a free tool.
     */
    callTool: (
      params: Parameters<Mcp.Client['callTool']>[0],
      resultSchema?: Parameters<Mcp.Client['callTool']>[1],
      options?: Parameters<Mcp.Client['callTool']>[2],
    ) => Promise<McpClient.CallToolResult>
  }

  namespace Mcp {
    /** An MCP SDK client, or any value with its `callTool`. */
    type Client = Parameters<typeof McpClient.wrap>[0]
  }

  /** The order of a 402 response's charge and subscription offers, as mppx's `orderChallenges` takes it. */
  type OrderChallenges = NonNullable<
    Mppx.create.Config<
      readonly [
        readonly ReturnType<typeof tempo.charge>[],
        readonly ReturnType<typeof tempo.subscription>[],
      ]
    >['orderChallenges']
  >

  /** The overrides of a payer, for one call. */
  type Overrides = Settings & {
    /**
     * A Tempo Account that pays without a session, such as the account of a backend's session,
     * which the page reads from its backend. The payer holds no access key, so in a page it pays
     * only subscriptions, on the instance's chain, and the user approves each one in Tempo ID's
     * dialog. It loads no session. Its charges and session managers throw
     * `mpp.SubscriptionOnlyError`, and so does `fetch` outside a page. `session` takes precedence.
     * Defaults to the instance's session.
     */
    account?: Address.Address | undefined
    /**
     * A fixed session, such as one that `accounts.backend.get` returns, or an API's connection from
     * `accounts.connections.connect`, whose access key pays. Defaults to the instance's session, read at
     * each payment.
     */
    session?: Pick<Session.Session, 'accessKey'> | undefined
    /**
     * The account that the app supplied to the sign-in as its access key, which signs for a
     * session's access key without material. Absent, a session's access key without material throws
     * `AccessKey.SignerRequiredError` at each payment.
     */
    signer?: Account.Account | undefined
  }

  /** The payments of one access key. */
  type Payer = {
    /**
     * Sends a request, and pays a 402 charge challenge with the access key, then returns the
     * endpoint's response to the paid retry. An access key authorizes one chain, so the payer skips
     * each charge offer on another chain, and pays the first offer on the access key's chain. A 402
     * response without such an offer rejects before the access key signs. Without a fixed
     * `session`, it loads the instance's stored session first, and, outside a browser, reads the
     * store again before the access key signs a charge. A browser's tabs receive each sign-out as a
     * message. If the session ends while the request waits for its 402 challenge, the access key
     * signs nothing, also if this instance signs the same user in again. If another instance signs
     * out and signs the same user in again before this one reads the store, such as at the message
     * of the sign-out, the change counts as a renewal, as for `session`.
     *
     * In a browser, the `fetch` of the instance's session also pays a 402 subscription challenge. A
     * subscription's credential is the Tempo Account's own signature of the merchant's access key.
     * So the payer opens Tempo ID's dialog, where the user approves the access key once. The access
     * key may send the challenge's amount each period, with `transferWithMemo`, to the challenge's
     * recipient, until the subscription expires. Its key authorization binds the challenge's ID as
     * its witness, as [Witnesses](https://github.com/tempoxyz/id/blob/main/docs/witnesses.md)
     * describes. The merchant holds the access key and charges each period. The instance's session
     * keeps its own access key. A refusal in the dialog rejects once, with the dialog's own error.
     * A payer of a fixed `session`, and any payer outside a browser, pays no subscription. The
     * `fetch` of a named `account` pays only a subscription, in a browser, for that account on the
     * instance's chain.
     *
     * @throws {Accounts.SignedOutError} Without a session, or for a session whose access key
     *   expired, before any request. Before the access key signs a charge, when the access key
     *   expires while the request waits for its 402 challenge. Before the access key signs a
     *   charge, when the instance, another tab of a browser, or another instance on the store, such
     *   as another process of a server, signed out or signed in another user or Tempo Account.
     *   Before the dialog opens, for a subscription challenge after the tab signed out or switched
     *   accounts.
     * @throws {Accounts.AccessKeyRequiredError} For a session without an access key. In a browser,
     *   Tempo ID's payment page pays a charge of such an instance's session, if one transfer in
     *   `push` mode pays the charge. The error is then thrown only once a challenge needs an access
     *   key.
     * @throws {AccessKey.SignerRequiredError} For an access key without material, and no `signer`
     *   override.
     * @throws {AccessKey.KeyTypeError} With the `signer` override, for a session whose
     *   authorization is a configurable account's.
     * @throws {LimitError} For a charge in a token that the access key's limits do not name, or
     *   above the whole limit of its token, before the access key signs, once a read of the chain's
     *   limits confirms it. In a browser, Tempo ID's payment page pays such a charge of the
     *   instance's session in place of the error, if one transfer in `push` mode pays the charge. A
     *   charge within the signed limits that the spent limit refuses throws it once the chain
     *   refuses it, after one read of the limit that is left. A charge that can swap from another
     *   token, through `autoSwap` or the endpoint's machine-token route, receives the chain's own
     *   error.
     * @throws {MaxAmountError} For a charge that costs more than `maxAmount`.
     * @throws {MaxAmountInvalidError} For a `maxAmount` that is no decimal amount of 0 or more.
     * @throws {MaxAmountPrecisionError} For a `maxAmount` of more than 6 decimals.
     * @throws {BalanceError} For a subscription whose first period the Tempo Account cannot pay,
     *   when the request cannot send again after the deposit page.
     * @throws {ChainError} For a subscription challenge on another chain than the payer's, before
     *   the dialog opens, and for a 402 response whose every Tempo charge is on another chain than
     *   the payer's, before the access key signs.
     * @throws {ConfigurableAccountError} For a subscription of a configurable Tempo Account, after
     *   the dialog.
     * @throws {SubscriptionOnlyError} For a payer of a named `account` outside a browser, before
     *   any request.
     * @throws {Accounts.RequestError} For a subscription that the user denies in Tempo ID's dialog,
     *   or that Tempo ID refuses. `access_denied` for a charge that the user rejects on the payment
     *   page.
     * @throws {Plugins.viem.RetryAccountError} For a charge whose retry signed in for a new access
     *   key, when the sign-in returned another user or Tempo Account. The instance keeps its
     *   session, and the charge paid nothing. Its `kind` is `accessKey` or `limit`, and its `cause`
     *   is the charge's error.
     * @throws {RetryClosedError} For a payment whose retry the user ended: a close of the deposit
     *   page before a deposit, or a close of the sign-in for a new access key. Its `kind` is
     *   `accessKey`, `balance`, or `limit`, and its `cause` is the payment's error. The payment
     *   paid nothing. A new call of `fetch` retries.
     * @throws {Error} For a payment on a chain that is not a Tempo chain, when the `viem` plugin's
     *   options name no `chain` of that ID.
     */
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    /**
     * Returns a caller of the tools of an MCP server, through `client`, an MCP SDK client. A paid
     * tool answers its call with a charge, as a `-32042` error or a result with the charge in
     * `_meta`. The access key pays the charge, and the caller calls the tool again with the
     * credential in `_meta`. The caller leaves `client` unchanged. Its `callTool` takes the
     * arguments of the client's own `callTool`, and returns its result with the charge's `receipt`.
     *
     * Each call loads and checks the session as `fetch` does, and refuses a charge above
     * `maxAmount` or the access key's limit before the access key signs. A server can charge a call
     * again after its payment, and one call pays at most three charges. The client's transport
     * sends the access token, such as through `accounts.session.fetch`. A refused charge signs in
     * for no new access key, and shows no deposit page, so `retry` does not apply.
     *
     * @throws {Accounts.SignedOutError} As for `fetch`.
     * @throws {Accounts.AccessKeyRequiredError} For a session without an access key.
     * @throws {LimitError} As for `fetch`.
     * @throws {MaxAmountError} For a charge that costs more than `maxAmount`.
     * @throws {MaxAmountInvalidError} For a `maxAmount` that is no decimal amount of 0 or more.
     * @throws {MaxAmountPrecisionError} For a `maxAmount` of more than 6 decimals.
     * @throws {SubscriptionOnlyError} For a payer of a named `account`.
     *
     * @example
     * ```ts
     * import { Client } from '@modelcontextprotocol/sdk/client/index.js'
     * import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
     *
     * const client = new Client({ name: 'agent', version: '1.0.0' })
     * await client.connect(
     *   new StreamableHTTPClientTransport(url, {
     *     fetch: (input, init) => accounts.session.fetch({ init, url: input }),
     *   }),
     * )
     * const { content, receipt } = await accounts
     *   .mpp({ maxAmount: '0.1' })
     *   .mcp(client)
     *   .callTool({ arguments: {}, name: 'fortune' })
     * ```
     */
    mcp: (client: Mcp.Client) => Mcp
    /**
     * Returns a session manager of mppx. Its first request opens a channel on the TIP-1034 channel
     * reserve, each request pays with a voucher of the access key, and `close()` closes the
     * channel. The manager holds the channel in memory, so close it before it is discarded.
     * `parameters` takes the options of mppx's `tempo.session.manager` but the account and the
     * client, such as `maxDeposit`. If the instance holds no session yet, such as after a reload or
     * a restart, the manager loads the stored session at its first request, as `fetch` does.
     *
     * Once the instance's session ends, such as at a sign-out, names another user or Tempo Account,
     * or the manager's access key expires, each request, stream, and top-up of a manager of the
     * instance's session throws `Accounts.SignedOutError` before any request. The manager stays
     * ended after a later sign-in, also of the same user. Outside a browser, each one reads the
     * store first, so a sign-out of another instance on the store, such as another process of a
     * server, also ends the manager. A browser's tabs receive each sign-out as a message. If the
     * other instance signs the same user in again before the next request, the store holds a new
     * access key of the same user, which counts as a renewal. A payment that a request started
     * before then, such as a challenge that arrives later or a voucher that a stream requests,
     * throws `Accounts.SignedOutError` before the access key signs. A new access key of the same
     * user without a sign-out, such as a limit's renewal, keeps the manager paying with its own
     * access key.
     *
     * If the access key of a fixed `session` expires, each request, stream, and top-up of its
     * manager throws `Accounts.SignedOutError` before any request, and the access key signs
     * nothing. `close()` still settles the channel, at the amount that the access key signed for.
     *
     * The manager pays only on the payer's chain. `allowedChainIds` may narrow that policy;
     * it must include the payer's chain. HTTP and SSE select a matching-chain offer. A session
     * offer without a chain uses the payer chain. `close()` preserves dependency errors, including
     * a plain `Error` for a replacement challenge on another chain.
     *
     * @throws {ChainError} For a session challenge on another chain than the payer's, except during `close()`.
     * @throws {RangeError} If `allowedChainIds` excludes the payer's chain.
     * @throws {TypeError} If every session offer names a malformed chain ID.
     * @throws {SubscriptionOnlyError} For a payer of a named `account`, before any request.
     * @throws {Error} For a retry of the manager's `topUp(amount)`, when a request of the manager
     *   selected another channel while the deposit page showed. The manager tops up no channel. A
     *   new call tops up the current channel.
     *
     * @example
     * ```ts
     * import { Accounts } from 'accounts'
     * import { mpp } from 'accounts/mpp'
     * import { dialog } from 'accounts/plugins'
     *
     * const accounts = Accounts.create({ accessKey, plugins: [dialog(), mpp()] })
     *
     * const session = accounts.mpp.session()
     * try {
     *   await session.fetch('https://api.example.com/content')
     * } finally {
     *   await session.close()
     * }
     * ```
     */
    session: (
      parameters?: Omit<
        Parameters<typeof tempo.session.manager>[0],
        'account' | 'client' | 'getClient'
      >,
    ) => SessionManager
  }

  /**
   * A subscription's access key, as mppx requests its signature with `wallet_authorizeAccessKey`,
   * for the Tempo Account that pays.
   */
  type Subscription = {
    /** The Tempo Account that pays. */
    account: Address.Address
    /** The merchant's access key. */
    address: Address.Address
    /** The chain of the challenge. */
    chainId: number
    /** When the subscription ends, in Unix seconds. */
    expiry: number
    /** The signature type of the merchant's access key. */
    keyType: 'p256' | 'secp256k1' | 'webAuthn'
    /** The amount of the token for each period, in base units as hex, and the period in seconds. */
    limits: readonly {
      limit: Hex.Hex
      period: number
      token: Address.Address
    }[]
    /** The `transferWithMemo` call to the merchant's recipient. */
    scopes: KeyAuthorization.KeyAuthorization['scopes']
    /** The challenge's ID, as 32 bytes, which the key authorization binds. */
    witness: Hex.Hex
  }

  namespace Subscription {
    /** The signed key authorization and its Tempo Account, as mppx reads them. */
    type ReturnType = {
      /** The signed key authorization, in the node's RPC format. */
      keyAuthorization: KeyAuthorization.Rpc
      /** The Tempo Account that signed it. */
      rootAddress: Address.Address
    }
  }

  /** A session manager of mppx, as `Payer.session` returns it. */
  type SessionManager = ReturnType<typeof tempo.session.manager>

  /**
   * `accounts.mpp`: the session manager of the instance's session, and a call that returns a payer
   * with overrides, such as another session.
   */
  type Namespace = Pick<Payer, 'session'> & ((overrides?: Overrides) => Payer)
}

/**
 * Returns a session manager that creates its manager with `start` at its first request, stream, or
 * top-up, and forwards each call to it. Before then, it reads as a manager without a channel, and
 * `close` settles nothing. A failed `start`, such as without a session, rejects that call, and the
 * next call starts again.
 */
function deferred(
  start: () => Promise<mpp.SessionManager>,
): mpp.SessionManager {
  // One value of three cases: no start yet, the start in progress, or the manager that it created.
  // A failed start returns to none, so the next call starts again.
  let current:
    | { manager: mpp.SessionManager; status: 'ready' }
    | { promise: Promise<mpp.SessionManager>; status: 'starting' }
    | undefined
  const manager = () =>
    current?.status === 'ready' ? current.manager : undefined
  const resolve = () => {
    if (current?.status === 'ready') return Promise.resolve(current.manager)
    if (current?.status === 'starting') return current.promise
    const promise = start().then(
      (value) => {
        current = { manager: value, status: 'ready' }
        return value
      },
      (error: unknown) => {
        current = undefined
        throw error
      },
    )
    current = { promise, status: 'starting' }
    return promise
  }
  return {
    get channelId() {
      return manager()?.channelId
    },
    async close() {
      if (!current) return undefined
      const started = await resolve().catch(() => undefined)
      return started?.close()
    },
    get cumulative() {
      return manager()?.cumulative ?? 0n
    },
    async fetch(...args) {
      return (await resolve()).fetch(...args)
    },
    get opened() {
      return manager()?.opened ?? false
    },
    async sse(...args) {
      return (await resolve()).sse(...args)
    },
    get state() {
      return manager()?.state ?? { status: 'idle' }
    },
    async topUp(...args) {
      return (await resolve()).topUp(...args)
    },
    async ws(...args) {
      return (await resolve()).ws(...args)
    },
  }
}

/**
 * Returns whether `current` is a session of the user of `options.session` that holds an access key,
 * active or parked on another chain, of `options.account`, whose access key thus still pays for it.
 */
function owns(
  current: Session.Session | undefined,
  options: { account: Address.Address; session: Session.Session },
) {
  const { account, session } = options
  if (!current || current.user.id !== session.user.id) return false
  return [current.accessKey, ...(current.accessKeys ?? [])].some(
    (held) => held && Address.isEqual(held.account, account),
  )
}

/** Returns whether a header of `request` carries a Payment credential. */
function paid(request: Request) {
  for (const [, value] of request.headers)
    if (Credential.extractPaymentScheme(value) !== null) return true
  return false
}

/**
 * Returns whether the instance's session receives the changes of the store's other contexts as
 * messages, as a browser's tabs do. A read of the store before the message would apply another
 * tab's sign-out without the plugins' hooks, which the message's handler runs.
 */
function messaged() {
  return (
    typeof document !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  )
}

/**
 * Returns `account`, which runs `options.check` before each signature, so a check that throws keeps
 * the access key from signing.
 */
function checked(
  account: Account.AccessKeyAccount,
  options: { check: () => void },
): Account.AccessKeyAccount {
  const { check } = options
  const { sign } = account
  return {
    ...account,
    // Viem reads `sign` to choose how an account signs a hash, so it stays absent without one.
    ...(sign
      ? {
          async sign(...args: Parameters<typeof sign>) {
            check()
            return sign(...args)
          },
        }
      : {}),
    async signMessage(
      ...args: Parameters<Account.AccessKeyAccount['signMessage']>
    ) {
      check()
      return account.signMessage(...args)
    },
    async signTransaction(
      ...args: Parameters<Account.AccessKeyAccount['signTransaction']>
    ) {
      check()
      return account.signTransaction(...args)
    },
    async signTypedData(
      ...args: Parameters<Account.AccessKeyAccount['signTypedData']>
    ) {
      check()
      return account.signTypedData(...args)
    },
  } as Account.AccessKeyAccount
}

/**
 * Throws {@link MaxAmountInvalidError} for a `maxAmount` that is no decimal amount of 0 or more, and
 * {@link MaxAmountPrecisionError} for one with more than a TIP-20 token's 6 decimals.
 */
function assertMaxAmount(maxAmount: string) {
  // An untyped caller, or a parsed config, can pass a number, which has no `split`.
  if (typeof maxAmount !== 'string' || !/^(\d+(\.\d*)?|\.\d+)$/.test(maxAmount))
    throw new MaxAmountInvalidError({ maxAmount })
  // `parseUnits` rounds a finer fraction, which could raise the maximum by a base unit.
  const [, fraction = ''] = maxAmount.split('.')
  // The fraction holds only digits, so a nonzero digit after the sixth decimal is a finer one.
  if (/[1-9]/.test(fraction.slice(6)))
    throw new MaxAmountPrecisionError({ maxAmount })
}

/**
 * Throws {@link LimitError} for a charge outside the access key's signed limits, once a read of the
 * chain in one round confirms it. The chain registers an access key that it does not hold yet with
 * the signed limits. For an access key that it holds, its remaining limit decides, since
 * `updateLimit` can raise it. A limit of `options.fee` pays only network fees, so it covers no
 * charge, unless the chain holds more than the signed limit. A failed read, or a revoked access
 * key, throws nothing, so the charge reports the chain's own refusal.
 */
async function assertLimit(options: {
  account: Account.AccessKeyAccount
  amount: bigint
  client: Client
  /**
   * The signed limit of the token that pays only network fees, as `FeeAllowance.of` returns it.
   * Absent for a token without one.
   */
  fee: bigint | undefined
  /**
   * The signed limit of the token that the access key sends. Absent for a token that the signed
   * limits do not name, or whose limit pays only fees.
   */
  limit: bigint | undefined
  token: Address.Address
}) {
  const { account, amount, client, fee, limit, token } = options
  const parameters = {
    accessKey: account.accessKeyAddress,
    account: account.address,
  }

  const read = await Promise.all([
    Actions.accessKey.getMetadata(client, parameters),
    Actions.accessKey.getRemainingLimit(client, { ...parameters, token }),
  ]).catch(() => undefined)
  if (!read) return
  const [metadata, { remaining }] = read

  const held = Address.isEqual(metadata.address, account.accessKeyAddress)
  // No scope calls the token of a limit that pays only fees, so what is left of the signed limit
  // sends nothing. More than the signed limit is a limit that the chain raised.
  const sends = fee === undefined || remaining > fee
  if (held && (metadata.isRevoked || (sends && amount <= remaining))) return
  const left = held && sends ? remaining : limit
  throw new LimitError({
    amount: formatUnits(amount, 6),
    limit: left === undefined ? undefined : formatUnits(left, 6),
    token,
  })
}

/** Creates the payer of `account`, or of `address` alone, which pays only subscriptions. */
function create(options: {
  /** The access key that signs each charge and voucher. Absent, the payer pays only subscriptions. */
  account: Account.AccessKeyAccount | undefined
  /** The Tempo Account that pays. Absent, the payer pays no subscription. */
  address: Address.Address | undefined
  autoSwap: mpp.AutoSwap | undefined
  chainId: number
  clientId: string | undefined
  /**
   * The limits of the access key that pay only network fees, as `FeeAllowance.of` returns them. A
   * charge in the token of one needs a limit that the chain raised.
   */
  fees: NonNullable<KeyAuthorization.Rpc['limits']>
  fetch: typeof globalThis.fetch | undefined
  getClient: (parameters: { chainId?: number | undefined }) => Client
  /** Sends the session's Tempo ID identity with each request. Absent, the payer sends none. */
  identity: ReturnType<typeof TempoId.Client.prover> | undefined
  /**
   * Records the registration that a signed transaction attached, once the chain confirms it, after
   * the endpoint reports that the transaction landed.
   */
  landed: (signed: string, confirm: () => Promise<boolean>) => void
  /**
   * The token limits of the access key, in the node's RPC format. Absent, the access key spends any
   * token, and a payer without an access key pays no charge.
   */
  limits: KeyAuthorization.Rpc['limits']
  maxAmount: string | undefined
  maxDeposit: string | undefined
  mode: 'pull' | 'push' | undefined
  orderChallenges: mpp.OrderChallenges | undefined
  /**
   * Sends a charge's transfer through Tempo ID's payment page, and returns the Tempo Account that
   * paid and the hash of its transaction. Absent, the payer shows no payment page.
   */
  pay:
    | ((
        transfer: Charge.Transfer,
      ) => Promise<{ account: Address.Address; hash: Hex.Hex }>)
    | undefined
  /** Signs a subscription's access key for the Tempo Account. Absent, the payer pays no subscription. */
  subscribe:
    | ((parameters: mpp.Subscription) => Promise<mpp.Subscription.ReturnType>)
    | undefined
  /**
   * Waits until no other charge carries the key authorization of the access key, and returns the
   * end of the charge's turn, as `viem.Registrations['turn']` describes.
   */
  turn: viem.Registrations['turn']
  /**
   * Rejects a charge before the access key signs, such as once the session ended. An abort of
   * `options.signal`, the request's signal, rejects it with the signal's reason.
   */
  verify:
    | ((options: { signal?: AbortSignal | undefined }) => Promise<void>)
    | undefined
}): mpp.Payer {
  const {
    account,
    address,
    autoSwap,
    chainId,
    clientId,
    fees,
    fetch,
    getClient,
    identity,
    landed,
    limits,
    maxAmount,
    maxDeposit,
    mode,
    orderChallenges,
    pay,
    subscribe,
    turn,
    verify,
  } = options
  // A payer of the payment page alone holds no access key. `check` pays each of its charges or
  // refuses it, so the method signs nothing.
  const charge =
    account || pay
      ? ([
          tempo.charge({
            ...(account ? { account } : {}),
            expectedChainId: chainId,
            getClient,
            ...(autoSwap !== undefined ? { autoSwap } : {}),
            ...(clientId !== undefined ? { clientId } : {}),
            ...(mode ? { mode } : {}),
          }),
        ] as const)
      : ([] as readonly ReturnType<typeof tempo.charge>[])

  /**
   * Reads each charge's amount and limit before the access key signs, for `fetch` and `mcp`. A
   * TIP-20 token has 6 decimals. Returns the credential of a charge that the payment page paid, or
   * `undefined` for a charge that the access key pays.
   */
  async function check(
    challenge: Challenge.Challenge,
    options: { signal?: AbortSignal | undefined } = {},
  ): Promise<string | undefined> {
    if (maxAmount !== undefined) {
      const amount = BigInt(String(challenge.request.amount ?? 0))
      if (amount > parseUnits(maxAmount, 6))
        throw new MaxAmountError({
          amount: formatUnits(amount, 6),
          maxAmount,
        })
    }
    // The store read of `verify` runs first, so another instance's sign-out refuses the charge with
    // `Accounts.SignedOutError`, and the instance adopts the stored session.
    await verify?.({ signal: options.signal })
    // A charge in a token that the signed limits do not name, or above a whole limit, needs a
    // limit that the chain raised since the sign-in, such as through `updateLimit`. So does a
    // charge in a token whose limit pays only network fees, which no scope sends. A proof spends
    // nothing, so any token's proof passes, and a charge within the signed limits reads nothing.
    // A swap, such as through `autoSwap` or the endpoint's machine-token route, spends another
    // token than the currency, whose limit the payer does not know, so the chain decides.
    const amount = BigInt(String(challenge.request.amount ?? 0))
    const swaps =
      !!autoSwap ||
      (
        challenge.request.methodDetails as
          | { machineTokenEnabled?: boolean | undefined }
          | undefined
      )?.machineTokenEnabled === true
    // The method's schema accepts any currency string, in either address format. A currency that
    // is no address leaves the charge to mppx, which refuses it.
    const token = (() => {
      try {
        return TempoAddress.resolve(
          String(challenge.request.currency) as TempoAddress.Address,
        )
      } catch {
        return undefined
      }
    })()
    // The payment page sends one transfer, which pays a charge in `push` mode.
    const transfer = pay
      ? Charge.transfer(challenge, {
          chainId,
          ...(clientId !== undefined ? { clientId } : {}),
          ...(mode ? { mode } : {}),
        })
      : undefined
    const remote =
      pay && transfer
        ? async () =>
            Charge.credential(challenge, {
              chainId,
              ...(await pay(transfer)),
            })
        : undefined
    // A payer without an access key signs nothing, so it pays only a charge that the payment page
    // pays. Any other charge, such as a proof, needs an access key.
    if (!account && challenge.intent === 'charge') {
      if (!remote) throw new Accounts.AccessKeyRequiredError()
      return await remote()
    }
    if (
      account &&
      limits &&
      token &&
      challenge.intent === 'charge' &&
      amount > 0n &&
      !swaps
    ) {
      const fee = fees.find((entry) => Address.isEqual(entry.token, token))
      const entry = fee
        ? undefined
        : limits.find((entry) => Address.isEqual(entry.token, token))
      if (!entry || amount > BigInt(entry.limit))
        try {
          await assertLimit({
            account,
            amount,
            client: getClient({ chainId }),
            fee: fee ? BigInt(fee.limit) : undefined,
            limit: entry ? BigInt(entry.limit) : undefined,
            token,
          })
        } catch (error) {
          // The access key cannot pay the charge, so the payment page pays it from the account.
          if (!(error instanceof LimitError) || !remote) throw error
          return await remote()
        }
    }
    // mppx checks the expiry only before `challenge.received`, and the turn of an earlier charge
    // can outlast the challenge, so the access key signs no charge of an expired challenge.
    if (challenge.expires) Expires.assert(challenge.expires, challenge.id)
    return undefined
  }

  // The signal of the request of each challenge in progress, by the challenge's ID, which
  // `onChallenge` reads.
  const signals = new Map<string, AbortSignal>()
  const http = MppxTransport.http()
  const mppx = Mppx.create({
    ...(fetch ? { fetch } : {}),
    ...(identity ? { identity: [identity] } : {}),
    // mppx flattens the nested arrays. Each type holds its method without the method too, so the
    // type of `orderChallenges` admits both offers.
    methods: [
      charge,
      // A subscription's credential is the Tempo Account's own signature of the merchant's access
      // key. The account names no signer, so mppx requests it with `wallet_authorizeAccessKey`,
      // which the client's transport answers with Tempo ID's dialog.
      subscribe && address
        ? ([
            tempo.subscription({
              account: address,
              getClient: (parameters) => {
                const client = getClient(parameters)
                return createClient({
                  chain: client.chain,
                  // A refusal in the dialog, such as a denial, is final, so Viem retries nothing.
                  transport: custom(
                    {
                      async request(request) {
                        if (request.method !== 'wallet_authorizeAccessKey')
                          return client.request(request as never)
                        const [parameters_] = request.params as [
                          Omit<mpp.Subscription, 'account' | 'chainId'>,
                        ]
                        return subscribe({
                          ...parameters_,
                          account: address,
                          chainId: client.chain?.id ?? chainId,
                        })
                      },
                    },
                    { retryCount: 0 },
                  ),
                })
              },
              // A subscription acts on the session's chain only, as a charge does, so a challenge
              // on another chain opens no dialog. mppx reads an absent chain as Tempo testnet.
              validateRequest: (request) => {
                const requested =
                  request.methodDetails?.chainId ?? tempoModerato.id
                if (requested !== chainId)
                  throw new ChainError({ chainId, requested })
              },
            }),
          ] as const)
        : ([] as readonly ReturnType<typeof tempo.subscription>[]),
    ],
    // mppx passes no signal to `onChallenge`, so each request's signal comes from its event.
    onChallenge: (challenge) => {
      const signal = signals.get(challenge.id)
      signals.delete(challenge.id)
      return check(challenge, { signal })
    },
    ...(orderChallenges !== undefined ? { orderChallenges } : {}),
    // The payer pays only through its own `fetch`, so the app's other requests stay unchanged.
    polyfill: false,
    // The turn of each request keeps the offers of its 402 response, so a request whose every
    // charge is on another chain fails with `ChainError`. The transport receives the request's own
    // `init`, also through an identity or a wrapped fetch.
    transport: MppxTransport.from({
      ...http,
      async getChallenges(response, request) {
        const offers = await http.getChallenges(response, request)
        const call = (request as { [turnOf]?: Turn | undefined } | undefined)?.[
          turnOf
        ]
        if (call) call.offers = offers
        return offers
      },
    }),
  })
  // Each concurrent charge of an access key that the chain does not hold would attach its key
  // authorization, and the chain registers it only once, so the node keeps the other transactions.
  // So a charge waits for the turn of its access key before `onChallenge` and the signature, and
  // the request ends the turn once it settles. A proof sends no transaction. An abort of the request
  // ends its wait.
  mppx.onChallengeReceived(async (payload) => {
    const call = (
      payload.init as { [turnOf]?: Turn | undefined } | undefined
    )?.[turnOf]
    const signal = signalOf(payload.input, payload.init)
    // A selected offer's failure keeps its own error, so the request reads no other chain.
    if (call) call.offers = undefined
    if (call && signal) {
      signals.set(payload.challenge.id, signal)
      ;(call.challenges ??= []).push(payload.challenge.id)
    }
    if (!account || !call) return undefined
    const { intent, request } = payload.challenge
    if (intent !== 'charge' || BigInt(String(request.amount ?? 0)) === 0n)
      return undefined
    call.charge = charged(payload.challenge)
    if (call.end) return undefined
    call.end = await turn(
      {
        accessKey: account.accessKeyAddress,
        address: account.address,
        chainId,
      },
      {
        keyAuthorizationManager: account.keyAuthorizationManager,
        signal: signalOf(payload.input, payload.init),
      },
    )
    return undefined
  })
  // In `pull` mode, the endpoint broadcasts the charge's transaction, and returns a paid response only
  // once it landed. The endpoint's receipt is unverified, so the chain's keychain confirms the access
  // key before it counts as registered.
  // mppx passes a copy of the request's `init` to its events, with the callback of the payer's retry.
  mppx.onCredentialCreated((payload) => {
    const init = payload.init as
      | {
          [credentialCreated]?: (() => void) | undefined
          [turnOf]?: Turn | undefined
        }
      | undefined
    init?.[credentialCreated]?.()
    const call = init?.[turnOf]
    if (!call) return
    call.credential = payload.credential
    call.credentials = (call.credentials ?? 0) + 1
    call.sent = true
  })
  mppx.onPaymentResponse((payload) => {
    // mppx passes a clone of an instance of the global Response, which tees its body. The observer
    // reads only headers, so it cancels its branch, which then buffers none of the body, and a
    // cancellation of the app's branch reaches the endpoint. The cancellation settles only once the
    // app's branch ends, so nothing awaits it. mppx passes any other response itself, whose body is
    // the app's, so it stays open.
    if (typeof Response !== 'undefined' && payload.response instanceof Response)
      void payload.response.body?.cancel().catch(() => undefined)
    // Only a receipt of a successful payment shows that the transaction landed. A missing or invalid
    // receipt records nothing.
    const receipt = (() => {
      try {
        return Receipt.fromResponse(payload.response)
      } catch {
        return undefined
      }
    })()
    if (receipt?.status !== 'success') return
    record(payload.credential)
  })

  /**
   * Records the registration that the transaction of a paid credential attached, once the chain
   * confirms it. A subscription's credential is a key authorization, which no access key of the
   * payer signs, so it records nothing.
   */
  function record(serialized: string) {
    const credential = Credential.deserialize<{
      signature?: string | undefined
      type: string
    }>(serialized)
    if (
      !account ||
      credential.payload.type !== 'transaction' ||
      !credential.payload.signature
    )
      return
    const { accessKeyAddress } = account
    landed(credential.payload.signature, async () => {
      const metadata = await Actions.accessKey.getMetadata(
        getClient({ chainId }),
        { accessKey: accessKeyAddress, account: account.address },
      )
      return (
        !metadata.isRevoked &&
        Address.isEqual(metadata.address, accessKeyAddress)
      )
    })
  }

  /**
   * Returns the receipt read of the transaction of a charge's credential, which reads the chain at
   * most once, so `superseded` and `reverted` share one read. Returns `undefined` for a
   * credential that names no transaction.
   */
  function receiptOf(serialized: string): Inclusion | undefined {
    const signed = transaction(serialized)
    if (!signed) return undefined
    const client = getClient({ chainId })
    let pending: Promise<Inclusion.Settled> | undefined
    const receipt: Inclusion = {
      read() {
        pending ??= getTransactionReceipt(client, { hash: signed.hash }).then(
          (value) => (receipt.settled = { receipt: value }),
          (error: unknown) => (receipt.settled = { error }),
        )
        return pending
      },
      settled: undefined,
    }
    return receipt
  }

  /**
   * Returns whether the chain refuses the signed transaction of `serialized` for good, since it
   * attaches the key authorization of an access key that another sender registered, such as a
   * charge of another instance on the same `store`. Records the registration then, so the next
   * charge attaches no key authorization. Returns `false` after a failed read.
   */
  async function superseded(serialized: string, receipt: Inclusion) {
    if (!account) return false
    const signed = transaction(serialized)
    if (!signed?.keyAuthorization) return false

    const client = getClient({ chainId })
    const { accessKeyAddress } = account
    const registered = await Actions.accessKey
      .getMetadata(client, {
        accessKey: accessKeyAddress,
        account: account.address,
      })
      .then(
        (metadata) =>
          !metadata.isRevoked &&
          Address.isEqual(metadata.address, accessKeyAddress),
        () => false,
      )
    if (!registered) return false
    // The receipt read follows the registration read, so a transaction of this request that
    // registered the access key shows its receipt. Once the chain holds the access key, a
    // transaction that attaches its key authorization never lands.
    const read = await receipt.read()
    const included =
      'receipt' in read ||
      !(read.error instanceof TransactionReceiptNotFoundError)
    if (included) return false
    landed(signed.serialized, () => Promise.resolve(true))
    return true
  }

  /**
   * Returns {@link LimitError} for a charge whose transaction landed and reverted since the limit
   * that remains no longer covers it, such as after a concurrent charge of the same access key
   * spent the limit between the fill and the broadcast. Only a failed response reads the receipt and
   * the limit, in parallel. A receipt that `superseded` read is not read again, and a successful one
   * reads no limit. Returns `undefined` for a transaction that succeeded or that the chain
   * holds no receipt of, for another credential, and after a failed read.
   */
  async function reverted(
    receipt: Inclusion,
    charge: { amount: bigint; token: Address.Address } | undefined,
  ) {
    // Without signed limits, the access key spends any amount, so a revert is not of a limit.
    if (!account || !charge || !limits) return undefined
    if (receipt.settled && !failed(receipt.settled)) return undefined
    const client = getClient({ chainId })
    const [settled, read] = await Promise.all([
      receipt.read(),
      Actions.accessKey
        .getRemainingLimit(client, {
          accessKey: account.accessKeyAddress,
          account: account.address,
          token: charge.token,
        })
        .catch(() => undefined),
    ])
    if (!failed(settled)) return undefined
    if (!read || read.remaining >= charge.amount) return undefined
    return new LimitError({
      amount: formatUnits(charge.amount, 6),
      limit: formatUnits(read.remaining, 6),
      token: charge.token,
    })
  }

  /**
   * Returns the amount and token of a charge that the access key pays from its currency. Returns
   * `undefined` for another challenge, and for a charge that can swap, which spends another token
   * whose limit the chain refuses, so the chain's error stands.
   */
  function charged(challenge: Parameters<typeof check>[0]) {
    const { intent, request } = challenge
    if (intent !== 'charge') return undefined
    const swaps =
      !!autoSwap ||
      (
        request.methodDetails as
          | { machineTokenEnabled?: boolean | undefined }
          | undefined
      )?.machineTokenEnabled === true
    if (swaps) return undefined
    try {
      return {
        amount: BigInt(String(request.amount ?? 0)),
        token: TempoAddress.resolve(
          String(request.currency) as TempoAddress.Address,
        ),
      }
    } catch {
      return undefined
    }
  }

  /**
   * Returns {@link ChainError} for a request whose 402 response offers Tempo charges only on other
   * chains, so mppx selected no offer. Returns `undefined` for any other request, such as one whose
   * selected subscription failed, so its own error stays.
   */
  function elsewhere(call: Turn) {
    // A payer of the payment page alone also pays charges, so it reads the offers too.
    if (!(account || pay) || !call.offers) return undefined
    // An offer whose chain is not a number names no chain that the payer can compare.
    const chains = call.offers
      .filter((offer) => offer.method === 'tempo' && offer.intent === 'charge')
      .map((offer) => {
        const details = offer.request.methodDetails as
          | { chainId?: unknown }
          | undefined
        if (details?.chainId === undefined) return tempoModerato.id
        return typeof details.chainId === 'number' ? details.chainId : undefined
      })
    if (chains.includes(undefined)) return undefined
    const requested = chains.find((id) => id !== chainId)
    if (requested === undefined || chains.includes(chainId)) return undefined
    return new ChainError({ chainId, intent: 'charge', requested })
  }

  /**
   * Returns {@link LimitError} for the chain's refusal of a charge within the signed limits that the
   * spent limit does not cover, with the limit that is left. Only a refusal reads the limit, so a
   * charge that the chain takes sends no more requests. Returns `undefined` for any other error,
   * and after a failed read.
   */
  async function spent(
    error: unknown,
    charge: { amount: bigint; token: Address.Address } | undefined,
  ) {
    if (!account || !charge || !(error instanceof Error)) return undefined
    if (ExecutionError.from(error).errorName !== 'SpendingLimitExceeded')
      return undefined
    // A refusal of the fee payment, or of a spend in another token, is not the charge's.
    const named = Retry.refused(error)
    if (named === null) return undefined
    if (named && !Address.isEqual(named.token, charge.token)) return undefined

    const read = await Actions.accessKey
      .getRemainingLimit(getClient({ chainId }), {
        accessKey: account.accessKeyAddress,
        account: account.address,
        token: charge.token,
      })
      .catch(() => undefined)
    // A limit that covers the charge refused another spend, such as network fees in the token.
    if (!read || read.remaining >= charge.amount) return undefined
    return new LimitError({
      amount: formatUnits(charge.amount, 6),
      cause: error,
      limit: formatUnits(read.remaining, 6),
      token: charge.token,
    })
  }

  const created: mpp.Payer = {
    async fetch(input, init) {
      // No charge makes a malformed `maxAmount` valid, so the payer refuses it before any request.
      if (maxAmount !== undefined) assertMaxAmount(maxAmount)
      const call: Turn = {}
      const tracked = { ...init, [turnOf]: call }
      // A credential that the endpoint did not answer with success can still land, such as a
      // transaction that the endpoint broadcast before it failed. So its turn lasts until it expires,
      // and the next charge then finds the registration on the chain.
      const response = await mppx
        .fetch(input, tracked)
        .catch(async (error: unknown) => {
          if (!call.sent) call.end?.()
          throw (
            elsewhere(call) ??
            (await spent(error, call.charge)) ??
            refusal(error)
          )
        })
        .finally(() => {
          // A request that fails before `onChallenge` leaves its signal.
          for (const id of call.challenges ?? []) signals.delete(id)
        })
      if (response.ok || !call.sent) {
        call.end?.()
        return response
      }
      const receipt = call.credential ? receiptOf(call.credential) : undefined
      // Another instance on the store can register the access key while this charge carries its
      // key authorization, so the endpoint's broadcast fails. The first transaction never lands
      // then, so the charge sends once more, without the key authorization.
      if (
        !(init as { [resent]?: boolean | undefined } | undefined)?.[resent] &&
        call.credential &&
        // A resend replays each payment of the request, so only a request that sent one credential
        // sends again.
        call.credentials === 1 &&
        resendable(input, init) &&
        receipt &&
        (await superseded(call.credential, receipt))
      ) {
        // The failed response is not the app's, so its body buffers nothing.
        void response.body?.cancel().catch(() => undefined)
        return created.fetch(input, { ...init, [resent]: true } as RequestInit)
      }
      // A concurrent charge of the access key can spend the limit after this charge's fill, so its
      // transaction lands and reverts, and the endpoint fails. The charge then rejects as one above
      // the limit that remains does before its signature.
      const limited = receipt && (await reverted(receipt, call.charge))
      if (limited) {
        // The failed response is not the app's, so its body buffers nothing.
        void response.body?.cancel().catch(() => undefined)
        throw limited
      }
      return response
    },
    mcp(client) {
      if (!account) throw new SubscriptionOnlyError()
      // No charge makes a malformed `maxAmount` valid, so the payer refuses it before any call.
      if (maxAmount !== undefined) assertMaxAmount(maxAmount)
      return {
        async callTool(params, resultSchema, options) {
          // The credential of the call's payment, whose transaction the receipt reports.
          let credential: string | undefined
          // The charge of the call, which a spent limit's refusal names.
          let current: ReturnType<typeof charged>
          // mppx replaces the `callTool` of the client that it wraps, so it wraps a copy of the
          // method, and the app's client stays unchanged.
          const paid = McpClient.wrap(
            { callTool: client.callTool.bind(client) },
            {
              methods: charge.map((method) => ({
                ...method,
                createCredential: async (
                  parameters: Parameters<typeof method.createCredential>[0],
                ) => (credential = await method.createCredential(parameters)),
              })),
              // A tool offers only charges, which the payer's order takes as for `fetch`, so an empty
              // order pays nothing.
              ...(orderChallenges !== undefined
                ? {
                    orderChallenges: async (candidates) =>
                      (await orderChallenges(candidates)) as typeof candidates,
                  }
                : {}),
            },
          )
          const result = await paid
            .callTool(params, resultSchema, {
              ...options,
              onPaymentRequired: async (challenge) => {
                await check(challenge, { signal: options?.signal })
                current = charged(challenge)
                return true
              },
            })
            .catch(async (error: unknown) => {
              throw (await spent(error, current)) ?? refusal(error)
            })
          if (credential && result.receipt?.status === 'success')
            record(credential)
          return result
        },
      }
    },
    session: (parameters = {}) => {
      if (!account) throw new SubscriptionOnlyError()
      if (
        parameters.allowedChainIds &&
        !parameters.allowedChainIds.includes(chainId)
      )
        throw new RangeError(
          `The session excludes payer chain ${chainId}. Include chain ${chainId} in allowedChainIds.`,
        )
      const order: NonNullable<
        Mppx.create.Config<
          readonly [ReturnType<typeof tempo.session>]
        >['orderChallenges']
      > = (candidates) => {
        const chains = candidates.map(
          ({ challenge }) =>
            (
              challenge.request.methodDetails as
                | { chainId?: unknown }
                | undefined
            )?.chainId,
        )
        const matching = candidates.filter(
          (_, index) =>
            chains[index] === undefined || chains[index] === chainId,
        )
        if (matching.length || !candidates.length) return matching
        const requested = chains.find(
          (value) =>
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value > 0,
        )
        if (typeof requested !== 'number')
          throw new TypeError(
            'Invalid session chain ID. Supply a positive integer chain ID.',
          )
        throw new ChainError({ chainId, intent: 'session', requested })
      }
      function withOrder(init?: RequestInit): typeof order {
        const select = (
          init as (RequestInit & { orderChallenges?: typeof order }) | undefined
        )?.orderChallenges
        return async (candidates) =>
          order(select ? await select(candidates) : candidates)
      }
      function orderedInit<init extends RequestInit | undefined>(init: init) {
        return new Proxy(
          { ...init, orderChallenges: withOrder(init) },
          {
            get(target, property, receiver) {
              return Object.hasOwn(target, property)
                ? Reflect.get(target, property, receiver)
                : init && Reflect.get(init, property, init)
            },
          },
        )
      }
      // mppx exposes chain-policy failures as plain errors; preserve all other failures.
      const refused = (error: unknown): never => {
        const requested =
          error instanceof Error &&
          /^Chain ID not allowed: (\d+)\.$/.exec(error.message)?.[1]
        if (requested)
          throw new ChainError({
            chainId,
            intent: 'session',
            requested: Number(requested),
          })
        throw error
      }
      const manager = tempo.session.manager({
        ...(autoSwap !== undefined ? { autoSwap } : {}),
        // The manager inherits the identity provers of the payer's mppx fetch.
        ...(identity ? { fetch: mppx.fetch } : fetch ? { fetch } : {}),
        ...(maxDeposit ? { maxDeposit } : {}),
        ...parameters,
        account,
        allowedChainIds: [chainId],
        getClient,
      })
      return Object.create(manager, {
        fetch: {
          value: (input: RequestInfo | URL, init?: RequestInit) => {
            const options = orderedInit(init)
            return manager.fetch(input, options).catch(refused)
          },
        },
        sse: {
          value: (
            input: Parameters<mpp.SessionManager['sse']>[0],
            init?: Parameters<mpp.SessionManager['sse']>[1],
          ) => {
            const options = orderedInit(init)
            return manager
              .sse(input, options)
              .then((stream) =>
                (async function* () {
                  try {
                    yield* stream
                  } catch (error) {
                    refused(error)
                  }
                })(),
              )
              .catch(refused)
          },
        },
        topUp: {
          value: (amount: string | bigint) =>
            manager.topUp(amount).catch(refused),
        },
        ws: {
          value: (...args: Parameters<mpp.SessionManager['ws']>) =>
            manager.ws(...args).catch(refused),
        },
      }) as mpp.SessionManager
    },
  }
  return created
}

/** The receipt read of a charge's transaction, which settles once. */
type Inclusion = {
  /** Reads the receipt, once. A later call returns the same read. */
  read: () => Promise<Inclusion.Settled>
  /** The settled read. Absent before the read settles. */
  settled: Inclusion.Settled | undefined
}

declare namespace Inclusion {
  /** The receipt, or the read's error, such as `TransactionReceiptNotFoundError`. */
  type Settled = { error: unknown } | { receipt: TransactionReceipt }
}

/** Returns whether a settled receipt read shows a transaction that landed and reverted. */
function failed(settled: Inclusion.Settled) {
  return 'receipt' in settled && settled.receipt.status === 'reverted'
}

/**
 * Returns the signed transaction of a charge's credential, with the hash of the transaction that
 * lands and its key authorization. Only a canonical, sender-signed 0x76 envelope that awaits no fee
 * payer names the hash of the transaction that lands, as mppx derives it. A fee payer's signature,
 * such as of a 0x78 envelope, gives the transaction that lands another hash. Returns `undefined`
 * for any other credential, and for a malformed one.
 */
function transaction(serialized: string) {
  try {
    const { payload } = Credential.deserialize<{
      signature?: string | undefined
      type: string
    }>(serialized)
    if (payload.type !== 'transaction' || !payload.signature) return undefined
    const signed = payload.signature as TxEnvelopeTempo.Serialized
    if (!signed.startsWith(TxEnvelopeTempo.serializedType)) return undefined
    const envelope = TxEnvelopeTempo.deserialize(signed)
    if (!envelope.signature) return undefined
    if (envelope.feePayerSignature === null) return undefined
    if (TxEnvelopeTempo.serialize(envelope) !== signed) return undefined
    return {
      hash: Hash.keccak256(signed),
      keyAuthorization: envelope.keyAuthorization,
      serialized: signed,
    }
  } catch {
    return undefined
  }
}

/**
 * Returns whether a request can send again. mppx sends a copy of a `Request`, so only a stream that
 * a request read, or a `Request` that the app read, cannot.
 */
function resendable(input: RequestInfo | URL, init?: { body?: unknown }) {
  return (
    !(init?.body instanceof ReadableStream) &&
    !(input instanceof Request && input.bodyUsed)
  )
}

/** Returns the abort signal of a request: the one of its `init`, or else of its `Request`. */
function signalOf(
  input: RequestInfo | URL | undefined,
  init?: { signal?: AbortSignal | null | undefined },
) {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined)
}

/**
 * Returns the balance failure of {@link BalanceError} in `error` or its causes, which names the
 * amount and token that the deposit page asks for. Returns `undefined` without it.
 */
function shortfall(error: unknown): Retry.Failure | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (current instanceof BalanceError)
      return { amount: current.amount, kind: 'balance', token: current.token }
    seen.add(current)
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Returns the error that a subscription's dialog threw, such as `Accounts.RequestError` for a denial,
 * in place of Viem's `UnknownRpcError`, which wraps it in the transport. Returns the
 * `Accounts.SignedOutError` of the charge account's check in place of Viem's error of the action that
 * signs, such as `TransactionExecutionError` in push mode. Returns any other error as it is.
 */
function refusal(error: unknown) {
  if (!(error instanceof BaseError)) return error
  const signedOut = error.walk(
    (cause) => cause instanceof Accounts.SignedOutError,
  )
  if (signedOut instanceof Accounts.SignedOutError) return signedOut
  const wrapped = error.walk((cause) => cause instanceof UnknownRpcError)
  if (!(wrapped instanceof UnknownRpcError)) return error
  if (wrapped.cause instanceof Error && !(wrapped.cause instanceof BaseError))
    return wrapped.cause
  return error
}
