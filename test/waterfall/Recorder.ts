/**
 * Records every async call of each public action of the package, for the waterfall. Only the
 * modules that `Plugin.create` transforms import it, so the package never loads it. A call of an
 * action of `Actions` or of a member of an instance from `Accounts.create` opens a trace, and each
 * fetch, store operation, WebAuthn ceremony, and popup round trip that starts inside it records on
 * that trace. An action that another action calls records its calls on the outer trace, with its
 * name in `within`. The arguments and results of the calls stay in memory. A trace holds only their
 * labels, their order, and the indexes of the calls that each one depends on.
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Url from 'node:url'

/** One async call of an action. */
export type Call = {
  /** Whether the call settled after the action did, or opened after it. Absent otherwise. */
  background?: true | undefined
  /** When the call settled, in the trace's sequence of opens and settles. `null` if it never did. */
  closed: number | null
  /**
   * The indexes of the earlier calls that settled before this call opened, and whose results hold a
   * value that its arguments name. Each value is new to the trace at that result.
   */
  dependsOn: readonly number[]
  /** The URL without its query, the store key's prefix, or the ceremony. */
  detail: string
  /** How long the call took, in milliseconds. */
  duration: number
  /** Whether the call rejected. Absent when it resolved. */
  failed?: true | undefined
  /** The service of the call. */
  kind: Call.Kind
  /** A label of the call's shape, such as `chain.eth_call` or `http.POST id.test/oauth2/token`. */
  name: string
  /** When the call opened, in the trace's sequence of opens and settles. */
  opened: number
  /**
   * The index of an earlier call of the trace with the same label and arguments. Absent for a first
   * call.
   */
  same?: number | undefined
  /** When the call started, in milliseconds after the action did. */
  start: number
  /** The innermost action of the package that made the call, if not the trace's own. */
  within?: string | undefined
}

export declare namespace Call {
  /** The service of a call. */
  type Kind = 'fetch' | 'popup' | 'store' | 'webauthn'
}

/** The record of one call of a public action, as one line of a trace file. */
export type Trace = {
  /** The action, such as `Actions.refresh` or `accounts.session.get`. */
  action: string
  /** The calls, in the order that they opened. */
  calls: readonly Call[]
  /** Whether the action rejected. Absent when it resolved. */
  failed?: true | undefined
  /** The position in the sequence of opens and settles when the action settled, or `null`. */
  settled: number | null
  /** How long the action took, in milliseconds. */
  total: number
}

/** A call in memory, with the values that its arguments and result hold. */
type Entry = {
  /** The text of the call's arguments, with the values that they hold, one per line. */
  args: string
  /** The call's record. */
  call: Call
  /** A comparable key of the call's service, label, and arguments. */
  key: string
  /** The store entry that the call reads or writes. */
  resource?: Resource | undefined
  /** The values that the call's result holds, once read. */
  result?: Set<string> | undefined
  /** Reads the values of the result, such as from a clone of a response's body. */
  reading?: Promise<void> | undefined
}

/** The trace of one action call in memory. */
type Running = {
  /** The action. */
  action: string
  /** Whether the trace is written. A call after that records nothing. */
  done: boolean
  /** The calls. */
  entries: Entry[]
  /** How many calls opened or settled so far. */
  events: number
  /** Whether the action rejected. */
  failed: boolean
  /** The index of each call's key, for {@link Call.same}. */
  keys: Map<string, number>
  /** How many calls are open. */
  pending: number
  /** The position when the action settled. */
  settled?: number | undefined
  /** When the action started, from `performance.now()`. */
  start: number
  /** Whether the action returned without a promise. */
  sync: boolean
  /** How long the action took. */
  total: number
  /** How many writes each store entry received, so a read after a write is no duplicate. */
  versions: Map<string, number>
}

/** A store entry that a call reads or writes. */
type Resource = {
  /** The store's kind and the entry's key. */
  key: string
  /** Whether the call writes the entry. */
  write: boolean
}

/** The trace that a call belongs to, and the action of the package that runs. */
type Scope = {
  /** Whether an outer recorded call runs, such as a custom store over `Store.memory`. */
  inside?: boolean | undefined
  /** The trace. */
  trace: Running
  /** The innermost action that runs inside the trace's own. */
  within?: string | undefined
}

/** The folder of the trace files, which `scripts/waterfall.ts` empties first. */
export const directory =
  process.env.ACCOUNTS_WATERFALL_DIRECTORY ??
  Path.resolve(
    Path.dirname(Url.fileURLToPath(import.meta.url)),
    '..',
    '..',
    'waterfall',
    '.traces',
  )

/** The most values that one call's arguments or result hold. */
const limit = 2_000

/** The deepest nesting that a walk of a value reads. */
const depth = 8

/** The shortest string that counts as a value. Shorter ones match too often by chance. */
const minimum = 6

/** Milliseconds that the write of a trace waits for the reads of its results. */
const readTimeout = 1_000

/** The trace of the running action. */
const storage = new AsyncLocalStorage<Scope>()

/** The stores that record already, so a store over another records once. */
const recorded = new WeakSet<object>()

/** The traces that are not written yet. */
const unwritten = new Set<Running>()

/**
 * The member and its wrapper of each instance's object and property, so each read of the same member
 * returns the same wrapper.
 */
const wrapped = new WeakMap<object, Map<string, [unknown, unknown]>>()

/** The global `fetch`, before the hook. */
const globalFetch = globalThis.fetch

// Viem's transports call the global `fetch` at each request. The hook records only inside a trace,
// and outside another recorded call, such as an instance's own `fetch` over the global one.
globalThis.fetch = (input, init) => {
  const scope = storage.getStore()
  if (!scope || scope.inside || scope.trace.done)
    return globalFetch(input, init)
  return fetchCall(scope, globalFetch, input, init)
}

// A worker that exits with traces still open writes them as they are.
process.on('exit', () => {
  for (const trace of unwritten) write(trace)
})

/**
 * Returns `fn` as an action named `name`. A call outside any trace opens one. A call inside another
 * action's trace records there, with `name` as its `within`.
 */
export function action<fn extends (...args: never[]) => unknown>(
  name: string,
  fn: fn,
): fn {
  return function (this: unknown, ...args: Parameters<fn>) {
    const scope = storage.getStore()
    if (scope?.inside) return fn.apply(this, args)
    if (scope && !scope.trace.done)
      return storage.run({ trace: scope.trace, within: name }, () =>
        fn.apply(this, args),
      )

    const trace: Running = {
      action: name,
      done: false,
      entries: [],
      events: 0,
      failed: false,
      keys: new Map(),
      pending: 0,
      start: performance.now(),
      sync: false,
      total: 0,
      versions: new Map(),
    }
    unwritten.add(trace)
    const settle = (failed: boolean) => {
      trace.failed = failed
      trace.settled = trace.events
      trace.total = performance.now() - trace.start
      finish(trace)
    }
    const result = (() => {
      try {
        return storage.run({ trace }, () => fn.apply(this, args))
      } catch (error) {
        settle(true)
        throw error
      }
    })()
    if (!isPromise(result)) {
      trace.sync = true
      settle(false)
      return result
    }
    return Promise.resolve(result).then(
      (value) => {
        settle(false)
        return value
      },
      (error: unknown) => {
        settle(true)
        throw error
      },
    )
  } as fn
}

/** Returns `fn` with each call recorded as a call of `kind` named `name`, such as a WebAuthn ceremony. */
export function call<fn extends (...args: never[]) => Promise<unknown>>(
  name: string,
  kind: Call.Kind,
  fn: fn,
): fn {
  return ((...args: Parameters<fn>) => {
    const scope = storage.getStore()
    if (!scope || scope.inside || scope.trace.done) return fn(...args)
    return record(scope, () => fn(...args), {
      args,
      detail: name,
      key: safeKey(args),
      kind,
      name,
      result: (value) => values(value),
    })
  }) as fn
}

/** Returns `fn`, the instance's `fetch` or the global one, with each call recorded. */
export function fetch(fn: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const scope = storage.getStore()
    if (!scope || scope.inside || scope.trace.done) return fn(input, init)
    return fetchCall(scope, fn, input, init)
  }
}

/**
 * Returns `create`, which returns an instance, with each function member of the instance and of its
 * namespaces, such as `session.get`, as an action named `accounts.<path>`.
 */
export function instance<fn extends (...args: never[]) => object>(
  create: fn,
): fn {
  return function (this: unknown, ...args: Parameters<fn>) {
    return members(create.apply(this, args), {
      level: 0,
      parent: undefined,
      path: 'accounts',
    })
  } as fn
}

/**
 * Returns `watch`, `Popup.watchPopup`, with each popup recorded as one call from its watch until its
 * callback, its close, or its stop.
 */
export function popup<
  fn extends (
    popup: Window,
    options: {
      onCallback: (callback: never) => void
      onClose: () => void
    },
  ) => () => void,
>(watch: fn): fn {
  return ((popup: Window, options: Parameters<fn>[1]) => {
    const scope = storage.getStore()
    if (!scope || scope.inside || scope.trace.done) return watch(popup, options)
    let resolve = () => {}
    const done = new Promise<void>((settle) => {
      resolve = settle
    })
    // The watch returns at once, and the call settles with the popup's callback or close.
    void record(scope, () => done, {
      args: [],
      detail: 'popup',
      key: crypto.randomUUID(),
      kind: 'popup',
      name: 'popup.callback',
    })
    const stop = watch(popup, {
      ...options,
      onCallback: (callback: never) => {
        resolve()
        options.onCallback(callback)
      },
      onClose: () => {
        resolve()
        options.onClose()
      },
    })
    return () => {
      resolve()
      stop()
    }
  }) as fn
}

/**
 * Returns `create`, which returns a store, with each `getItem`, `removeItem`, `setItem`,
 * `takeItem`, and `update` of the store recorded as `store.<name>.<method>`.
 */
export function store<fn extends (...args: never[]) => unknown>(
  name: string,
  create: fn,
): fn {
  return function (this: unknown, ...args: Parameters<fn>) {
    const value = create.apply(this, args)
    if (typeof value !== 'object' || value === null || recorded.has(value))
      return value
    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        const member: unknown = Reflect.get(target, property, receiver)
        if (
          typeof member !== 'function' ||
          (property !== 'getItem' &&
            property !== 'removeItem' &&
            property !== 'setItem' &&
            property !== 'takeItem' &&
            property !== 'update')
        )
          return member
        return (...args: unknown[]) => {
          const scope = storage.getStore()
          const run = () =>
            Reflect.apply(member, target, args) as Promise<unknown>
          if (!scope || scope.inside || scope.trace.done) return run()
          const [key] = args
          return record(scope, run, {
            // A write's value is its argument, and a read's is its result.
            args,
            detail: `${property} ${prefix(key)}`,
            key: `${property}\n${safeKey(args)}`,
            kind: 'store',
            name: `store.${name}.${property}`,
            resource: {
              key: `${name}\n${safeKey(key)}`,
              write: property !== 'getItem',
            },
            result: (value) => values(value),
          })
        }
      },
    })
    recorded.add(proxy)
    return proxy
  } as fn
}

/** Adds `value` and the values that it holds to `found`. */
function add(value: string, found: Set<string>, level: number) {
  if (value.length < minimum) return
  const hex = /^0x[0-9a-f]+$/i.test(value)
  found.add(hex ? value.toLowerCase() : value)

  // An ABI word that holds an address, as an `eth_call` result or a call's data does.
  if (hex && value.length > 42)
    for (const word of value.slice(2).match(/.{64}/g) ?? [])
      if (word.startsWith('0'.repeat(24)) && !/^0+$/.test(word))
        found.add(`0x${word.slice(24)}`.toLowerCase())

  // A JWT, such as an access token or a DPoP proof, holds its header's and payload's values.
  const jwt = /^[\w-]+\.([\w-]+)\.[\w-]*$/.exec(value)
  if (jwt?.[1])
    try {
      values(
        JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')),
        found,
        level + 1,
      )
    } catch {
      // A dotted string that is no JWT holds nothing more.
    }

  // The parts of a URL, an authorization header, or a list.
  for (const part of value.split(/[\s"&,/;=?#]+/))
    if (part !== value && part.length >= minimum)
      found.add(/^0x[0-9a-f]+$/i.test(part) ? part.toLowerCase() : part)
}

/** Returns the label, key, and values of a fetch, and records it. */
function fetchCall(
  scope: Scope,
  fn: typeof globalThis.fetch,
  input: Parameters<typeof globalThis.fetch>[0],
  init: Parameters<typeof globalThis.fetch>[1],
) {
  const url = (() => {
    try {
      return new URL(input instanceof Request ? input.url : String(input))
    } catch {
      return undefined
    }
  })()
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  const body = text(init?.body)
  const rpc = rpcName(body)
  const name =
    rpc ??
    (url ? `http.${method} ${url.host}${pattern(url.pathname)}` : 'http.?')
  return record(scope, () => fn(input, init), {
    args: [url?.href, parse(body), headers(init?.headers)],
    detail: url ? `${method} ${url.origin}${url.pathname}` : method,
    key: `${method} ${url?.href ?? '?'}\n${body}`,
    kind: 'fetch',
    name,
    // The clone leaves the body to the caller. The read runs beside the caller's.
    result: async (response: Response) => {
      const type = response.headers.get('content-type') ?? ''
      if (!/json|text/.test(type) || response.bodyUsed) return new Set()
      const clone = response.clone()
      const location = response.headers.get('location')
      const nonce = response.headers.get('dpop-nonce')
      const found = values([
        nonce,
        location,
        location ? [...new URL(location, url).searchParams.values()] : [],
      ])
      const content = await clone.text().catch(() => '')
      return values(parse(content), found)
    },
  })
}

/** Writes `trace` once the action settled and each of its calls did. */
function finish(trace: Running) {
  if (trace.settled === undefined || trace.pending > 0 || trace.done) return
  trace.done = true
  // The action settled already, so nothing awaits the write.
  void (async () => {
    const reads = trace.entries.flatMap((entry) =>
      entry.reading ? [entry.reading] : [],
    )
    await Promise.race([
      Promise.allSettled(reads),
      new Promise((resolve) => setTimeout(resolve, readTimeout).unref()),
    ])
    write(trace)
  })()
}

/** Returns the values of `init.headers`. */
function headers(value: HeadersInit | undefined) {
  if (!value) return []
  return [...new Headers(value).values()]
}

/** Returns whether `value` is a promise or another thenable. */
function isPromise(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/** Returns whether `value` is an array or a plain object, which a walk reads. */
function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return true
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Returns `target` with each function member as an action named `<path>.<property>`, and each
 * object or function member, such as `session` or the `viem` plugin's client, wrapped in turn to
 * two levels. A call of a member runs it with the object that holds it as `this`. The instance's
 * configuration and the session's actor stay as they are.
 */
function members<value extends object>(
  target: value,
  options: members.Options,
): value {
  const { level, parent, path } = options
  return new Proxy(target, {
    apply(fn, _, args) {
      return action(path, (...args: never[]) =>
        Reflect.apply(fn as (...args: never[]) => unknown, parent, args),
      )(...(args as never[]))
    },
    get(target, property, receiver) {
      const member: unknown = Reflect.get(target, property, receiver)
      if (
        level >= 2 ||
        typeof property === 'symbol' ||
        property === 'actor' ||
        property === 'config' ||
        property === 'then'
      )
        return member
      if (typeof member !== 'function' && !isPlain(member)) return member

      // A getter, such as the `viem` plugin's client, can return another member at each read.
      const cache = wrapped.get(target) ?? new Map<string, [unknown, unknown]>()
      wrapped.set(target, cache)
      const cached = cache.get(property)
      if (cached && cached[0] === member) return cached[1]
      const value = members(member as object, {
        level: level + 1,
        parent: target,
        path: `${path}.${property}`,
      })
      cache.set(property, [member, value])
      return value
    },
  })
}

declare namespace members {
  type Options = {
    /** How deep `target` is in the instance, which is 0. */
    level: number
    /** The object that holds `target`, which a call of `target` receives as `this`. */
    parent: object | undefined
    /** The name of `target`, such as `accounts.session`. */
    path: string
  }
}

/** Returns `body` as JSON, its form fields, or itself. */
function parse(body: string): unknown {
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    if (!body.includes('=')) return body
    return [...new URLSearchParams(body).values()]
  }
}

/** Returns the path of a URL with each identifier segment, such as an address, as `:id`. */
function pattern(pathname: string) {
  return pathname
    .split('/')
    .map((segment) =>
      /^(0x[0-9a-f]+|\d+|[0-9a-f-]{16,}|[\w-]{24,})$/i.test(segment)
        ? ':id'
        : segment,
    )
    .join('/')
}

/** Returns the first two parts of a store key, such as `tempo-id:session`, which name its kind. */
function prefix(key: unknown) {
  if (typeof key !== 'string') return '?'
  const parts = key.split(':')
  return parts.length > 2 ? `${parts.slice(0, 2).join(':')}:…` : key
}

/**
 * Records the call that `run` starts on the trace of `scope`, and returns a promise of its result.
 * `run` runs as an inside call, so a recorded call within it records nothing more.
 */
async function record<value>(
  scope: Scope,
  run: () => Promise<value>,
  options: {
    args: unknown
    detail: string
    key: string
    kind: Call['kind']
    name: string
    resource?: Resource | undefined
    result?: ((value: value) => Promise<Set<string>> | Set<string>) | undefined
  },
): Promise<value> {
  const { resource } = options
  const trace = scope.trace
  const version = resource ? (trace.versions.get(resource.key) ?? 0) : 0
  if (resource?.write) trace.versions.set(resource.key, version + 1)
  const key = `${options.kind}\n${options.name}\n${version}\n${options.key}`
  const same = trace.keys.get(key)
  const entry: Entry = {
    args: [...values(options.args)].join('\n'),
    call: {
      closed: null,
      dependsOn: [],
      detail: options.detail.slice(0, 500),
      duration: 0,
      kind: options.kind,
      name: options.name,
      opened: trace.events++,
      ...(same === undefined ? {} : { same }),
      start: performance.now() - trace.start,
      ...(scope.within ? { within: scope.within } : {}),
    },
    key,
    resource,
  }
  if (same === undefined) trace.keys.set(key, trace.entries.length)
  trace.entries.push(entry)
  trace.pending++
  try {
    const value = await storage.run({ ...scope, inside: true }, run)
    if (options.result) {
      const result = options.result
      // The result's own read is no call of the trace.
      entry.reading = storage.exit(async () => {
        entry.result = await result(value)
      })
    }
    return value
  } catch (error) {
    entry.call.failed = true
    throw error
  } finally {
    entry.call.closed = trace.events++
    entry.call.duration = performance.now() - trace.start - entry.call.start
    trace.pending--
    finish(trace)
  }
}

/** Returns `chain.<method>` for a JSON-RPC body, joined by `+` for a batch, or `undefined`. */
function rpcName(body: string) {
  if (!body.includes('"jsonrpc"')) return undefined
  try {
    const parsed = JSON.parse(body) as
      | { method?: string }
      | readonly { method?: string }[]
    const methods = (Array.isArray(parsed) ? parsed : [parsed]).map(
      (entry: { method?: string }) => entry.method ?? '?',
    )
    // A batch reads as each run of one method and its count, such as `eth_call×16`.
    const runs: [string, number][] = []
    for (const method of methods) {
      const last = runs.at(-1)
      if (last?.[0] === method) last[1]++
      else runs.push([method, 1])
    }
    return `chain.${runs.map(([method, count]) => (count > 1 ? `${method}×${count}` : method)).join('+')}`
  } catch {
    return undefined
  }
}

/** Returns a comparable key of a call's arguments, which never leaves the process. */
function safeKey(value: unknown) {
  try {
    return JSON.stringify(value, (_, entry: unknown) => {
      if (typeof entry === 'bigint') return entry.toString()
      if (entry instanceof Uint8Array) return Array.from(entry).join(',')
      return entry
    })
  } catch {
    // Arguments that do not serialize never match another call's.
    return crypto.randomUUID()
  }
}

/** Returns a request body as text, or `''` for a body that does not read as text at once. */
function text(body: unknown) {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return ''
}

/**
 * Returns whether a result's value can link two calls: a string of 16 or more characters, or of 8
 * or more with a digit, such as an ID, an address, or a token. A status such as `pending` links
 * nothing.
 */
function token(value: string) {
  return value.length >= 16 || (value.length >= 8 && /\d/.test(value))
}

/**
 * Returns the values that `value` holds: each string of {@link minimum} or more characters, and
 * what it holds in turn. A JWT holds its header's and payload's values, a long hex string the address
 * in each ABI word, and a URL or a header its parts.
 */
function values(value: unknown, found = new Set<string>(), level = 0) {
  if (found.size >= limit || level > depth) return found
  if (typeof value === 'string') {
    add(value, found, level)
    return found
  }
  if (typeof value === 'bigint') {
    add(value.toString(), found, level)
    return found
  }
  if (value instanceof Uint8Array) {
    add(
      `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
      found,
      level,
    )
    return found
  }
  if (value instanceof URL) {
    add(value.href, found, level)
    return found
  }
  if (!isPlain(value)) return found
  for (const entry of Object.values(value)) values(entry, found, level + 1)
  return found
}

/**
 * Writes `trace` to this process's trace file, with the dependencies of each call. A call depends on
 * an earlier settled call whose result holds a {@link token} that its arguments' text holds, and that
 * the earlier call's own arguments do not hold.
 */
function write(trace: Running) {
  unwritten.delete(trace)
  // A synchronous member, such as `session.subscribe`, without a call is no action to report.
  if (trace.sync && trace.entries.length === 0) return

  // A result's own arguments name no new value, such as an echoed client ID.
  const fresh = trace.entries.map((entry) => {
    if (!entry.result || entry.call.closed === null) return []
    return [...entry.result].filter(
      (value) => token(value) && !entry.args.includes(value),
    )
  })
  const calls = trace.entries.map((entry): Call => {
    const opened = entry.call.opened
    const dependsOn = trace.entries.flatMap((other, index) => {
      if (other.call.closed === null || other.call.closed >= opened) return []
      // A store entry's read or write waits for the entry's earlier write, and a write for its read.
      const resource = entry.resource
      if (
        resource &&
        other.resource?.key === resource.key &&
        (resource.write || other.resource.write)
      )
        return [index]
      // A transaction's fields, such as its nonce and gas, encode the chain's earlier reads.
      if (
        entry.call.name.startsWith('chain.eth_send') &&
        other.call.name.startsWith('chain.')
      )
        return [index]
      for (const value of fresh[index]!)
        if (entry.args.includes(value)) return [index]
      return []
    })
    const background =
      trace.settled === undefined ||
      entry.call.closed === null ||
      entry.call.closed > trace.settled
    return {
      ...entry.call,
      ...(background ? { background: true as const } : {}),
      dependsOn,
    }
  })
  const line: Trace = {
    action: trace.action,
    calls,
    ...(trace.failed ? { failed: true } : {}),
    settled: trace.settled ?? null,
    total: trace.total,
  }
  Fs.mkdirSync(directory, { recursive: true })
  Fs.appendFileSync(
    Path.join(directory, `${process.pid}.jsonl`),
    `${JSON.stringify(line)}\n`,
  )
}
