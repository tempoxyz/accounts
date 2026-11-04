/**
 * The retry of a client's actions after the node refuses a transaction that the session's access key
 * sends, once a screen fixes the failure: a balance below the transaction's need, a spent limit, or
 * an access key that the chain does not hold. A failure counts only when the node refused the
 * transaction before it took it, so a retry never sends one transaction twice.
 * @module
 */
import { formatUnits, type Transport } from 'viem'
import { ExecutionError } from 'viem/tempo'

/** What a failure needs before its transaction can send again. */
export type Failure =
  | {
      /** The balance of a token is below the transaction's need. */
      kind: 'balance'
      /** The amount that the account lacks, as a decimal string. Absent when the error names none. */
      amount?: string | undefined
      /** The token's address. Absent when the error names none, such as for the fee token. */
      token?: `0x${string}` | undefined
    }
  | {
      /** The chain does not hold the access key: absent, expired, or revoked. */
      kind: 'key'
    }
  | {
      /** The access key's spending limit is below the transaction's amount. */
      kind: 'limit'
    }

/** The kind of a failure. */
export type Kind = Failure['kind']

/** The requests whose refusal means that the node took no transaction. */
const sends = new Set([
  'eth_estimateGas',
  'eth_fillTransaction',
  'eth_sendRawTransaction',
  'eth_sendRawTransactionSync',
])

/** The kind of each recognized error name. */
const kinds = {
  InsufficientBalance: 'balance',
  InsufficientFeeTokenBalance: 'balance',
  KeyAlreadyRevoked: 'key',
  KeyExpired: 'key',
  KeyNotFound: 'key',
  SpendingLimitExceeded: 'limit',
} as const satisfies Record<string, Kind>

/**
 * The actions that send no transaction, such as a preflight `estimateGas` or `fillTransaction`,
 * whose refusals reject as they are.
 */
const reads = /^(call|createAccessList|estimate|fill|prepare|simulate)/

/**
 * Creates the retry of one plugin instance, whose transport marks the refusals that its wrapped
 * clients retry.
 */
export function create(): create.ReturnType {
  // The errors of refused sends, which the transport marks.
  const refused = new WeakSet<object>()

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

  function classify(error: unknown): Failure | undefined {
    if (!marked(error)) return undefined
    const decoded = ExecutionError.from(error as Error)
    if (!(decoded.errorName in kinds)) return undefined
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
      token: token as `0x${string}`,
    }
  }

  function transport(value: Transport): Transport {
    return (parameters) => {
      const instance = value(parameters)
      return {
        ...instance,
        async request(args, options) {
          try {
            return await instance.request(args, options)
          } catch (error) {
            if (
              sends.has(args.method) &&
              typeof (error as { code?: unknown } | null)?.code === 'number'
            )
              refused.add(error as object)
            throw error
          }
        },
      } as ReturnType<Transport>
    }
  }

  function wrap<target extends object>(
    target: target,
    options: wrap.Options,
  ): target {
    const { enabled, fix, signal, skip } = options
    const cache = new WeakMap<object, unknown>()

    /** Calls `fn` with `args`, and retries after a failure of a kind outside `tried`. */
    function call(
      fn: (...args: readonly unknown[]) => unknown,
      self: unknown,
      args: readonly unknown[],
      tried: ReadonlySet<Kind>,
    ): unknown {
      const result = Reflect.apply(fn, self, args)
      if (!(result instanceof Promise)) return result
      return result.catch(async (error: unknown) => {
        const failure = classify(error)
        if (!failure || tried.has(failure.kind) || !enabled(failure.kind))
          throw error
        // A fix that another call started serves this one too, so this call's signal ends its own
        // wait, and stops its own send.
        await abortable(fix(failure, error), { signal })
        signal?.throwIfAborted()
        return call(fn, self, args, new Set([...tried, failure.kind]))
      })
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
          if ((root && skip.has(key)) || reads.test(key)) return member
          if (typeof member === 'function')
            // The proxy keeps the action's own members, such as `transfer.estimateGas`, which send
            // nothing and reject as they are.
            return new Proxy(member, {
              apply: (fn, _, args: readonly unknown[]) =>
                follows(args)
                  ? call(fn as never, object, args, new Set())
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

  return { classify, transport, wrap }
}

export declare namespace create {
  type ReturnType = {
    /**
     * Returns the failure of `error`, or `undefined` for an error that no retry handles, or one
     * that the node may have taken a transaction for.
     */
    classify: (error: unknown) => Failure | undefined
    /**
     * Returns `transport`, whose refusals of a send carry a mark that `classify` reads. A refusal is
     * an error response of the node, with a JSON-RPC `code`. A failure to reach the node carries no
     * mark, since the node may have taken the transaction.
     */
    transport: (transport: Transport) => Transport
    /**
     * Returns `target` with each action, also in its action groups and in the clients that `extend`
     * returns, wrapped so that a rejection with a failure of an enabled kind runs `options.fix`,
     * then calls the action again. Each kind retries once for each call. Actions that send no
     * transaction, calls that name their own `account`, and the keys of `options.skip` return as
     * they are.
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
     * Rejects when the user closes it.
     */
    fix: (failure: Failure, error: unknown) => Promise<void>
    /** Rejects a call that waits for a fix with the signal's reason, before it sends again. */
    signal: AbortSignal | undefined
    /** The members of the target that are its settings, not its actions. */
    skip: ReadonlySet<string>
  }
}

/**
 * Returns whether a call with `args` signs with the client's account, which the session's access key
 * follows. A call that names its own `account`, such as the account's root key, does not.
 */
function follows(args: readonly unknown[]) {
  const [parameters] = args
  return !(
    parameters &&
    typeof parameters === 'object' &&
    (parameters as { account?: unknown }).account !== undefined
  )
}

/** Resolves `value`, or rejects with the reason of `options.signal` once it aborts. */
async function abortable<value>(
  value: Promise<value>,
  options: { signal: AbortSignal | undefined },
): Promise<value> {
  const { signal } = options
  if (!signal) return await value
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}
