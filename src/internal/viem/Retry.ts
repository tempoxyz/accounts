/**
 * The retry of a client's actions, and of the `mpp` plugin's payments, after the node refuses a
 * transaction that the session's access key sends, once a screen fixes the failure: a balance below the transaction's need, a spent limit, or
 * an access key that the chain does not hold. A failure counts only when the node refused the
 * transaction before it took it, so a retry never sends one transaction twice. A transaction that
 * the account cannot sign, without an access key on the chain, counts too, since none left the page.
 * An action that sends several transactions retries only before the node takes its first one.
 * @module
 */
import { Address, Value } from 'ox'
import { decodeFunctionData, formatUnits, type Hex, type Transport } from 'viem'
import { Abis, ExecutionError } from 'viem/tempo'
import * as FeeAllowance from '../FeeAllowance.js'

/** What a failure needs before its transaction can send again. */
export type Failure =
  | {
      /** The chain does not hold the access key: absent, expired, or revoked. */
      kind: 'accessKey'
      /**
       * Whether the account signed no transaction, since it holds no signer on the chain. Absent for
       * a refusal of the node.
       */
      unsigned?: true | undefined
    }
  | {
      /** The balance of a token is below the transaction's need. */
      kind: 'balance'
      /** The amount that the account lacks, as a decimal string. Absent when the error names none. */
      amount?: string | undefined
      /**
       * The balance that the transaction needs, as a decimal string. Absent when the error names
       * only the amount that the account lacks, or none.
       */
      required?: string | undefined
      /** The token's address. Absent when the error names none, such as for the fee token. */
      token?: `0x${string}` | undefined
    }
  | {
      /** The access key's spending limit is below the transaction's amount. */
      kind: 'limit'
      /**
       * The address of the access key that a read of the refusal found on the chain with part of a
       * limit spent, so the retry reads the chain no more for that access key. Absent before a read.
       */
      spent?: `0x${string}` | undefined
    }

/** The kind of a failure. */
export type Kind = Failure['kind']

/** The spend of a call that a spending limit refused. */
export type Spend = {
  /** The amount, in the base units of the token. */
  amount: bigint
  /** The token's address. */
  token: Address.Address
}

/** The transactions that one transport of a retry sent, which the calls of its clients read. */
type Sent = {
  /** The transactions that wait for the node's answer. */
  pending: ReadonlySet<Promise<unknown>>
  /** Returns the count of the transactions that the node took, or may have taken. */
  taken: () => number
}

/**
 * The network fees that a limit of the fee token pays besides a call: a fee allowance, in the base
 * units of a TIP-20 token, which holds 6 decimals.
 */
export const fees = Value.from(FeeAllowance.amount, 6)

/** The prefix of every TIP-20 token's address. */
const tip20Prefix = '0x20c000000000000000000000'

/** The requests whose refusal means that the node took no transaction. */
const sends = new Set([
  'eth_estimateGas',
  'eth_fillTransaction',
  'eth_sendRawTransaction',
  'eth_sendRawTransactionSync',
])

/** The requests that hand the node a signed transaction, which it takes unless it refuses them. */
const takes = new Set(['eth_sendRawTransaction', 'eth_sendRawTransactionSync'])

/** The kind of each recognized error name. */
const kinds = {
  InsufficientBalance: 'balance',
  InsufficientFeeTokenBalance: 'balance',
  KeyAlreadyRevoked: 'accessKey',
  KeyExpired: 'accessKey',
  KeyNotFound: 'accessKey',
  SpendingLimitExceeded: 'limit',
} as const satisfies Record<string, Kind>

/**
 * The actions that send no transaction, such as a preflight `estimateGas` or `fillTransaction`,
 * whose refusals reject as they are.
 */
const reads = /^(call|createAccessList|estimate|fill|prepare|simulate)/

/**
 * The actions that sign a message or typed data, and send no transaction, so a missing access key
 * rejects them as it is, without a sign-in for an access key.
 */
const messages = /^sign(Message|TypedData)$/

/**
 * Creates the retry of one plugin instance, whose transport marks the refusals that its wrapped
 * clients retry.
 */
export function create(): create.ReturnType {
  // The errors of refused sends, which each transport marks.
  const refused = new WeakSet<object>()
  // The transactions that each transport sent, by the transport that `transport` returned.
  const transports = new WeakMap<Transport, Sent>()

  /** Returns whether `error`, or an error in its causes, is a refusal that the transport marked. */
  function marked(error: unknown): boolean {
    const seen = new Set<unknown>()
    let current = error
    while (current && typeof current === 'object' && !seen.has(current)) {
      if (refused.has(current)) return true
      seen.add(current)
      current = (current as { cause?: unknown }).cause
    }
    return false
  }

  /** Returns the node's error of a refusal that the transport marked, or `undefined` without one. */
  function refusal(error: unknown) {
    if (!marked(error)) return undefined
    return ExecutionError.from(error as Error)
  }

  function classify(error: unknown): Failure | undefined {
    // The client's account refuses to sign a transaction without an access key on the chain, so
    // no transaction left the page.
    if (unsigned(error)) return { kind: 'accessKey', unsigned: true }
    // The page refuses a transaction of an expired access key before the request, so no node answered.
    if (named(error, { name: 'Plugins.viem.AccessKeyExpiredError' }))
      return { kind: 'accessKey' }
    const decoded = refusal(error)
    if (!decoded || !(decoded.errorName in kinds)) return undefined
    const kind = kinds[decoded.errorName as keyof typeof kinds]
    if (kind !== 'balance') return { kind }
    // `InsufficientBalance(available, required, token)`. TIP-20 tokens hold 6 decimals.
    const args = (decoded as { args?: readonly unknown[] | undefined }).args
    const [available, required, token] = args ?? []
    if (typeof available !== 'bigint' || typeof required !== 'bigint')
      return { kind }
    return {
      amount: formatUnits(required - available, 6),
      kind,
      required: formatUnits(required, 6),
      token: token as `0x${string}`,
    }
  }

  function transport(value: Transport): Transport {
    // The count of the transactions that the node took, or may have taken, through the transport. A
    // wrapped call reads it at its start and at its failure, so it retries only without a change.
    let taken = 0
    // The transactions that the transport sent, and that wait for the node's answer.
    const pending = new Set<Promise<unknown>>()

    const wrapped: Transport = (parameters) => {
      const instance = value(parameters)

      /** Sends a request to the node, marks a refusal, and counts a transaction that it took. */
      async function send(
        ...request: Parameters<typeof instance.request>
      ): Promise<unknown> {
        const [args] = request
        try {
          const result = await instance.request(...request)
          if (takes.has(args.method)) taken++
          return result
        } catch (error) {
          const refusal =
            sends.has(args.method) &&
            typeof (error as { code?: unknown } | null)?.code === 'number' &&
            !(args.method === 'eth_sendRawTransactionSync' && timeout(error))
          if (refusal) refused.add(error as object)
          // A transaction whose request fails without a refusal, such as one whose answer did not
          // arrive, can be one that the node took.
          if (!refusal && takes.has(args.method)) taken++
          throw error
        }
      }

      return {
        ...instance,
        request(args, options) {
          const answer = send(args, options)
          if (!takes.has(args.method)) return answer
          // The count holds the transaction before `pending` drops it, so a call that waits for
          // the answer reads a count with it.
          pending.add(answer)
          return answer.finally(() => pending.delete(answer))
        },
      } as ReturnType<Transport>
    }
    transports.set(wrapped, { pending, taken: () => taken })
    return wrapped
  }

  function wrap<target extends object>(
    target: target,
    options: wrap.Options,
  ): target {
    const { enabled, fix, signal, skip, snapshot, surface } = options
    // The transactions of the transport that the target sends through. Without them, nothing
    // shows that the node took no transaction of a call, so no call retries.
    const sent = options.transport && transports.get(options.transport)
    const cache = new WeakMap<object, unknown>()

    /** Calls `fn` with `args`, and retries after a failure, as {@link attempt} does. */
    function call(
      fn: (...args: readonly unknown[]) => unknown,
      self: unknown,
      args: readonly unknown[],
    ): unknown {
      // The state that the latest send started with, which its fix reads.
      let state: unknown
      // The count of taken transactions that the latest send started with.
      let started = sent?.taken()
      return attempt(
        () => {
          state = snapshot()
          started = sent?.taken()
          const result: unknown = Reflect.apply(fn, self, args)
          if (!(result instanceof Promise)) return result
          return result.catch(async (error: unknown) => {
            // An action can send its transactions at once, so a failure of one can arrive before
            // the answer of another. The count holds a transaction only after its answer.
            if (sent && classify(error)) await Promise.allSettled(sent.pending)
            throw error
          })
        },
        {
          // An action can send several transactions, and a retry calls the whole action again. So a
          // failure after the node took a transaction rejects as it is, and no transaction that
          // settled sends twice.
          classify: (error) =>
            sent && sent.taken() === started ? classify(error) : undefined,
          enabled,
          fix: (failure, error) => fix(failure, error, args[0], state),
          signal,
          surface,
        },
      )
    }

    function proxy(value: object, root: boolean): object {
      const cached = cache.get(value)
      if (cached) return cached as object
      const wrapped = new Proxy(value, {
        get(object, key, receiver) {
          const member = Reflect.get(object, key, receiver)
          if (typeof key !== 'string') return member
          // A client that `extend` returns holds the same actions, which retry as this client's do.
          if (root && key === 'extend' && typeof member === 'function')
            return (...args: readonly unknown[]) =>
              wrap(Reflect.apply(member, object, args) as object, options)
          if ((root && skip.has(key)) || reads.test(key) || messages.test(key))
            return member
          if (typeof member === 'function')
            // The proxy keeps the action's own members, such as `transfer.estimateGas`, which send
            // nothing and reject as they are.
            return new Proxy(member, {
              apply: (fn, _, args: readonly unknown[]) =>
                follows(args, { account: Reflect.get(target, 'account') })
                  ? call(fn as never, object, args)
                  : Reflect.apply(fn, object, args),
            })
          // An action group, such as `token`, holds the actions.
          if (member && typeof member === 'object') return proxy(member, false)
          return member
        },
      })
      cache.set(value, wrapped)
      return wrapped
    }

    return proxy(target, true) as target
  }

  return {
    classify,
    errorName: (error) => refusal(error)?.errorName,
    transport,
    wrap,
  }
}

export declare namespace create {
  type ReturnType = {
    /**
     * Returns the failure of `error`, or `undefined` for an error that no retry handles, or one
     * that the node may have taken a transaction for.
     */
    classify: (error: unknown) => Failure | undefined
    /**
     * Returns the name of the node's error of a refusal that the transport marked, such as
     * `CallNotAllowed`, or `undefined` for an error that carries no mark, since the node may have
     * taken its transaction.
     */
    errorName: (error: unknown) => string | undefined
    /**
     * Returns `transport`, whose refusals of a send carry a mark that `classify` reads. A refusal is
     * an error response of the node, with a JSON-RPC `code`. A failure to reach the node carries no
     * mark, since the node may have taken the transaction. The timeout of an
     * `eth_sendRawTransactionSync`, code `4`, carries none either, since the node took it.
     *
     * The transport also counts each transaction that the node takes, or may have taken, and holds
     * each one that waits for its answer. Each returned transport holds its own count. `wrap` reads
     * both, of the transport that its `options.transport` names.
     */
    transport: (transport: Transport) => Transport
    /**
     * Returns `target` with each action, also in its action groups and in the clients that `extend`
     * returns, wrapped so that a rejection with a failure of an enabled kind runs `options.fix`,
     * then calls the action again. Each kind retries once for each call. Actions that send no
     * transaction, calls that name an `account` other than the target's, and the keys of
     * `options.skip` return as they are.
     *
     * A retry calls the whole action again, so it runs only while the node took no transaction
     * since the call started. A failure after that rejects as it is, such as a refusal of the second
     * transaction of an action that sends two. The count is that of `options.transport`, which the
     * target sends through, and it names no call. So a transaction of another call through the same
     * transport that the node takes during the call also ends the call's retry. A transaction
     * through another transport of the retry does not, such as one of another chain's client.
     * Without `options.transport`, no call retries.
     *
     * If a transaction of the transport waits for its answer when the call fails, the call waits
     * for the answer, and then reads the count. So an action that sends two transactions at once
     * retries only if the node refused both. The count misses a transaction that an action sends
     * after it rejects.
     */
    wrap: <target extends object>(
      target: target,
      options: wrap.Options,
    ) => target
  }
}

export declare namespace wrap {
  type Options = {
    /** Returns whether a failure of `kind` retries. */
    enabled: (kind: Kind) => boolean
    /**
     * Shows the screen that resolves `failure`, and resolves once the transaction can send again.
     * Rejects when the user closes it. `parameters` is the call's first argument, such as a
     * transfer's `amount` and `token`, and `state` is what `snapshot` returned when the call started.
     */
    fix: (
      failure: Failure,
      error: unknown,
      parameters: unknown,
      state: unknown,
    ) => Promise<void>
    /** Rejects a call that waits for a fix with the signal's reason, before it sends again. */
    signal: AbortSignal | undefined
    /** The members of the target that are its settings, not its actions. */
    skip: ReadonlySet<string>
    /** Returns the state that a call starts with, such as the session that signs it. */
    snapshot: () => unknown
    /**
     * Returns the error that a rejection that no retry handles rejects with, such as the instance's
     * error among the causes of Viem's. Absent, the call rejects with its own error.
     */
    surface?: ((error: unknown) => unknown) | undefined
    /**
     * The transport that the target sends through, as `transport` of the same retry returned it.
     * The calls read its count of taken transactions. Without it, no call retries.
     */
    transport: Transport | undefined
  }
}

/**
 * Calls `send`, and after a rejection with a failure of an enabled kind, runs `options.fix`, then
 * calls `send` again. Each kind retries once, so a second failure of the kind rejects. A result that
 * is no promise returns as it is.
 *
 * @example
 * ```ts
 * const response = await Retry.attempt(() => pay(), { classify, enabled, fix, signal })
 * ```
 */
export function attempt<value>(
  send: () => value,
  options: attempt.Options,
): value {
  const { classify, enabled, fix, signal, surface } = options

  /** Calls `send`, and retries after a failure of a kind outside `tried`. */
  function call(tried: ReadonlySet<Kind>): unknown {
    const result = send()
    if (!(result instanceof Promise)) return result
    return result.catch(async (error: unknown) => {
      const failure = classify(error)
      if (!failure || tried.has(failure.kind) || !enabled(failure.kind))
        throw surface ? surface(error) : error
      // A fix that another call started serves this one too, so this call's signal ends its own
      // wait, and stops its own send.
      await abortable(fix(failure, error), { signal })
      if (signal?.aborted) throw aborted(signal)
      return call(new Set([...tried, failure.kind]))
    })
  }

  return call(new Set()) as value
}

export declare namespace attempt {
  type Options = {
    /** Returns the failure of an error, or `undefined` for an error that no retry handles. */
    classify: (error: unknown) => Failure | undefined
    /** Returns whether a failure of `kind` retries. */
    enabled: (kind: Kind) => boolean
    /**
     * Shows the screen that resolves `failure`, and resolves once `send` can run again. Rejects when
     * the user closes it.
     */
    fix: (failure: Failure, error: unknown) => Promise<void>
    /** Rejects a call that waits for a fix with the signal's reason, before it sends again. */
    signal: AbortSignal | undefined
    /**
     * Returns the error that a rejection that no retry handles rejects with, such as the instance's
     * error among the causes of Viem's. Absent, the call rejects with its own error.
     */
    surface?: ((error: unknown) => unknown) | undefined
  }
}

/**
 * Returns the amount and token of the call that `error` refused for a spent limit, which Viem's
 * `AccessKeySpendingLimitExceededError` holds in the error or its causes. Returns `null` for that
 * error without both, such as a refusal of the fee payment.
 *
 * Without that error, returns the TIP-20 `transfer` or `transferWithMemo` of `options.parameters`,
 * a transaction request of one call, or `undefined` for another request. Viem adds its error only
 * around an action, so a tree-shakable action, such as `transferSync` of `wagmi/tempo`, reaches the
 * client's `sendTransactionSync` with its call's `to` and `data`, and a refusal without that error.
 *
 * @example
 * ```ts
 * const named = Retry.refused(error, { parameters }) // { amount: 101000000n, token: '0x20c0…' }
 * ```
 */
export function refused(
  error: unknown,
  options: refused.Options = {},
): Spend | null | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const entry = current as {
      amount?: unknown
      cause?: unknown
      fee?: unknown
      name?: unknown
      token?: unknown
    }
    // Several copies of Viem can load, so the error's name identifies it.
    if (entry.name === 'AccessKeySpendingLimitExceededError')
      return entry.fee !== true &&
        typeof entry.amount === 'bigint' &&
        typeof entry.token === 'string' &&
        Address.validate(entry.token, { strict: false })
        ? { amount: entry.amount, token: entry.token }
        : null
    current = entry.cause
  }
  return transferred(options.parameters)
}

export declare namespace refused {
  type Options = {
    /**
     * The first argument of the refused call, such as the `to` and `data` of a transaction
     * request, or its `calls`. Absent, only Viem's error names the spend.
     */
    parameters?: unknown
  }
}

/**
 * Returns the amount and token of the TIP-20 `transfer` or `transferWithMemo` that a transaction
 * request of one call sends, encoded or in its ABI form, or `undefined` for another request. A transfer from another account,
 * such as `transferFrom`, spends none of the access key's limit, so it returns `undefined`.
 */
function transferred(parameters: unknown): Spend | undefined {
  if (!parameters || typeof parameters !== 'object') return undefined
  const { calls } = parameters as { calls?: unknown }
  const call = (() => {
    if (calls === undefined) return parameters as Call
    if (!Array.isArray(calls) || calls.length !== 1) return undefined
    return calls[0] as Call | undefined
  })()
  // A call in its ABI form, such as one of wagmi's `writeContractSync`, names `address` and
  // `args` in place of `to` and `data`.
  const { address, args, data, functionName, to = address } = call ?? {}
  if (typeof to !== 'string') return undefined
  if (!Address.validate(to, { strict: false })) return undefined
  if (!to.toLowerCase().startsWith(tip20Prefix)) return undefined

  const decoded = (() => {
    if (typeof data !== 'string') return { args, functionName }
    try {
      return decodeFunctionData({ abi: Abis.tip20, data: data as Hex })
    } catch {
      return undefined
    }
  })()
  if (
    decoded?.functionName !== 'transfer' &&
    decoded?.functionName !== 'transferWithMemo'
  )
    return undefined
  const amount = Array.isArray(decoded.args) ? decoded.args[1] : undefined
  if (typeof amount !== 'bigint') return undefined
  return { amount, token: to }
}

/** A call of a transaction request, as Viem's actions pass it. */
type Call = {
  /** The called contract of a call in its ABI form. */
  address?: unknown
  /** The arguments of a call in its ABI form. */
  args?: unknown
  /** The call's data. */
  data?: unknown
  /** The function of a call in its ABI form. */
  functionName?: unknown
  /** The called contract. */
  to?: unknown
}

/**
 * Returns the limits of `authorization` whose spending counts toward the refusal of
 * `options.refused`. Each transaction spends part of a limit that pays only network fees, so such a
 * limit counts for no refusal that names a spend. It counts for a refusal of the fee payment, and
 * for a refusal without Viem's error, which can be one of the fee payment.
 *
 * @example
 * ```ts
 * const limits = Retry.counted(session.accessKey.keyAuthorization, {
 *   refused: Retry.refused(error),
 * })
 * ```
 */
export function counted(
  authorization: counted.Authorization,
  options: counted.Options,
): counted.ReturnType {
  const { limits = [] } = authorization
  if (!options.refused) return limits

  const fees = FeeAllowance.of(authorization)
  return limits.filter((entry) => !fees.includes(entry))
}

export declare namespace counted {
  type Authorization = Parameters<typeof FeeAllowance.of>[0]

  type Options = {
    /** The spend that the refusal names, as {@link refused} returns it. */
    refused: object | null | undefined
  }

  type ReturnType = globalThis.ReturnType<typeof FeeAllowance.of>
}

/**
 * Returns whether the call of `options.parameters` sends at most the whole limit of its token in
 * `limits`, with `options.fees` on top, which a new access key with the same limits can send.
 * Returns `undefined` for a call without a `bigint` `amount` and the address of a limited token.
 *
 * @example
 * ```ts
 * const sends = Retry.within(limits, { parameters: { amount: 1n, token } }) // true
 * ```
 */
export function within(
  limits:
    | readonly { limit: bigint | `0x${string}`; token: `0x${string}` }[]
    | undefined,
  options: within.Options,
) {
  const { fees = 0n, parameters } = options
  if (!parameters || typeof parameters !== 'object') return undefined
  const { amount, token } = parameters as { amount?: unknown; token?: unknown }
  if (typeof amount !== 'bigint' || typeof token !== 'string') return undefined
  if (!Address.validate(token, { strict: false })) return undefined
  const entry = limits?.find((limit) => Address.isEqual(limit.token, token))
  if (!entry) return undefined
  return amount + fees <= BigInt(entry.limit)
}

export declare namespace within {
  type Options = {
    /**
     * The amount that the limit also pays besides the call, such as network fees, in the token's
     * base units. Defaults to `0n`.
     */
    fees?: bigint | undefined
    /** The call's first argument, or the amount and token that {@link refused} returns. */
    parameters: unknown
  }
}

/**
 * Returns what a retry does with the headless renewal of an expired access key, and whether the retry
 * revokes the renewal's refresh token. A sign-in or a sign-out that replaced the chain's access key
 * during the renewal supersedes it, and the renewal's own change ends its tokens. Another retry's
 * commit on another chain keeps the chain's access key, so it supersedes nothing. A renewal that the
 * retry neither keeps nor supersedes sets no session, so its refresh token ends.
 *
 * | `overtaken` and `replaced` | `kept`  | `aborted` | `action`    |
 * | ------------------------ | ------- | --------- | ----------- |
 * | `true`                   | any     | any       | `supersede` |
 * | `false`                  | `false` | any       | `fallback`  |
 * | `false`                  | `true`  | `true`    | `abort`     |
 * | `false`                  | `true`  | `false`   | `commit`    |
 *
 * @example
 * ```ts
 * const { action, revoke } = Retry.renewal({
 *   aborted: false,
 *   issued: true,
 *   kept: true,
 *   overtaken: false,
 *   replaced: false,
 * })
 * // { action: 'commit', revoke: false }
 * ```
 */
export function renewal(options: renewal.Options): renewal.ReturnType {
  const { aborted, issued, kept, overtaken, replaced } = options
  const action = (() => {
    if (overtaken && replaced) return 'supersede'
    if (!kept) return 'fallback'
    if (aborted) return 'abort'
    return 'commit'
  })()
  return {
    action,
    revoke: issued && (action === 'abort' || action === 'fallback'),
  }
}

export declare namespace renewal {
  type Options = {
    /** Whether the retry's `signal` aborted. */
    aborted: boolean
    /** Whether the renewal returned a refresh token. */
    issued: boolean
    /** Whether the renewal returned an access key for the session's user and account. */
    kept: boolean
    /** Whether a sign-in, a sign-out, or another retry's commit completed during the renewal. */
    overtaken: boolean
    /** Whether the session no longer holds the expired access key on the retry's chain. */
    replaced: boolean
  }

  type ReturnType = {
    /**
     * `commit` sets the renewal as the session, `abort` rejects with the signal's reason,
     * `supersede` ends the renewal through its change and rejects with `Accounts.SupersededError`,
     * and `fallback` shows the sign-in.
     */
    action: 'abort' | 'commit' | 'fallback' | 'supersede'
    /** Whether the retry revokes the renewal's refresh token itself. */
    revoke: boolean
  }
}

/**
 * Returns whether `error`, or an error in its causes, is the timeout of an
 * `eth_sendRawTransactionSync`, which is code `4` of EIP-7966. The node took the transaction, and
 * ended its wait for the receipt, so the error is no refusal.
 */
function timeout(error: unknown) {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const entry = current as { cause?: unknown; code?: unknown }
    if (entry.code === 4) return true
    current = entry.cause
  }
  return false
}

/**
 * Returns whether `error`, or an error in its causes, is the account's refusal to sign a transaction
 * without an access key on the client's chain. Several copies of the package can load, so the
 * error's name identifies it.
 */
function unsigned(error: unknown) {
  return named(error, { name: 'Accounts.AccessKeyRequiredError' })
}

/**
 * Returns whether `error`, or an error in its causes, has `options.name`. The module loads no
 * error class of the plugin, so the name identifies it.
 */
function named(error: unknown, options: { name: string }) {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const entry = current as { cause?: unknown; name?: unknown }
    if (entry.name === options.name) return true
    current = entry.cause
  }
  return false
}

/**
 * Returns whether a call with `args` signs with the client's account, which the session's access key
 * follows. A call that names the client's own account, as Viem's contract actions and wagmi's
 * actions do, follows it too. A call that names another `account`, such as the account's root key,
 * does not, nor does an approval by `hash` of a stored operation, which names its own account.
 */
function follows(args: readonly unknown[], options: follows.Options) {
  const [parameters] = args
  if (!parameters || typeof parameters !== 'object') return true
  const { account, hash } = parameters as { account?: unknown; hash?: unknown }
  if (hash !== undefined) return false
  return account === undefined || account === options.account
}

declare namespace follows {
  type Options = {
    /** The client's own account, which follows the session. */
    account: unknown
  }
}

/**
 * Returns the reason of the aborted `signal`, or an `AbortError` for React Native's `AbortSignal`,
 * which has neither `reason` nor `throwIfAborted`.
 *
 * @example
 * ```ts
 * if (signal.aborted) throw Retry.aborted(signal)
 * ```
 */
export function aborted(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  return Object.assign(new Error('The operation was aborted.'), {
    name: 'AbortError',
  })
}

/** Resolves `value`, or rejects with the reason of `options.signal` once it aborts. */
export async function abortable<value>(
  value: Promise<value>,
  options: { signal: AbortSignal | undefined },
): Promise<value> {
  const { signal } = options
  if (!signal) return await value
  if (signal.aborted) throw aborted(signal)
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        abort = () => reject(aborted(signal))
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}
