import { Hex } from 'ox'
import * as Provider from 'ox/Provider'
import * as RpcResponse from 'ox/RpcResponse'
import { createStore } from 'zustand/vanilla'

import type * as CoreProvider from '../Provider.js'
import * as Schema from '../Schema.js'
import * as Rpc from '../zod/rpc.js'
import * as channel from './channel.js'
import type { Host, State } from './types.js'

export type {
  Host,
  Meta,
  ReadyOptions,
  Request,
  State,
  Sync,
  Theme,
  onUserRequest,
  ready,
  respond,
} from './types.js'

/** Creates a dialog host runtime. */
export function create(options: create.Options): Host {
  const { channel, provider, trustedHosts } = options
  const ready =
    typeof window !== 'undefined' && !new URLSearchParams(window.location.search).get('mode')
  const store = createStore<State>(() => ({
    mode: undefined,
    origin: undefined,
    ready,
    requests: [],
  }))

  return {
    channel,
    provider,
    store,
    trustedHosts: trustedHosts ?? [],

    onUserRequest(cb) {
      return this.onRequests(async (requests, meta, { account }) => {
        if (account) {
          const state = provider.store.getState()
          const index = state.accounts.findIndex(
            (a) => a.address.toLowerCase() === account.address.toLowerCase(),
          )
          if (index < 0) {
            for (const r of requests) if (r.status === 'pending') this.reject(r.request)
            return
          }
          if (index !== state.activeAccount) provider.store.setState({ activeAccount: index })
        }

        const pending = requests.find((r) => r.status === 'pending')
        store.setState({
          origin: meta.origin,
          ready: false,
        })
        await cb({
          account,
          origin: meta.origin,
          request: pending?.request ?? null,
        })
        if (pending) store.setState({ ready: true })
      })
    },

    onRequests(cb) {
      return channel.onRequests(async (payload, meta) => {
        const { account, chainId, requests } = payload

        await provider.store.persist?.rehydrate()

        store.setState({ requests })

        if (provider.store.getState().chainId !== chainId)
          void provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(chainId) }],
          })

        cb(requests, meta, { account })
      })
    },

    ready(options) {
      const { accounts, ...readyOptions } = options ?? {}

      if (accounts)
        channel.onValidateAccounts(({ addresses }) => {
          if (!addresses) return {}
          const valid = addresses.some((a) =>
            accounts.some((b) => a.toLowerCase() === b.toLowerCase()),
          )
          return { valid }
        })

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const mode = params.get('mode') as State['mode']

        if (mode) store.setState({ mode })
      }

      void channel.ready({ ...readyOptions, trustedHosts })
    },

    reject(request, error) {
      const error_ = error ?? new Provider.UserRejectedRequestError()
      void channel.sendResponse(
        Object.assign(
          RpcResponse.from({
            error: { code: error_.code, message: error_.message },
            id: request.id,
            jsonrpc: '2.0',
          }),
          { _request: request },
        ),
      )
    },

    rejectAll(error) {
      store.setState({ ready: false })
      const requests = store.getState().requests
      for (const queued of requests) this.reject(queued.request, error)
    },

    async respond(request, options = {}) {
      const { defer, error, onError, selector } = options
      const shared = { id: request.id, jsonrpc: '2.0' } as const

      if (error) {
        void channel.sendResponse(
          Object.assign(RpcResponse.from({ ...shared, error, status: 'error' }), {
            _request: request,
          }),
        )
        return
      }

      try {
        let result = 'result' in options ? options.result : await provider.request(request as never)
        if (selector) result = selector(result)
        if (defer) return result
        void channel.sendResponse(
          Object.assign(RpcResponse.from({ ...shared, result }), { _request: request }),
        )
        return result
      } catch (e) {
        if (e instanceof Error && e.message.includes('sameOriginWithAncestors')) {
          void channel.switchMode({ mode: 'popup' })
          return
        }

        if (e instanceof Error && onError?.(e)) throw e

        const err = e as RpcResponse.BaseError
        void channel.sendResponse(
          Object.assign(RpcResponse.from({ ...shared, error: err, status: 'error' }), {
            _request: request,
          }),
        )
        throw err
      }
    },
  }
}

export declare namespace create {
  type Options = {
    /** Dialog channel for consumer/host communication. */
    channel: channel.Host
    /** Provider to execute RPC requests against. */
    provider: CoreProvider.Provider
    /** Hostnames trusted to render the embed in an iframe. */
    trustedHosts?: readonly string[] | undefined
  }
}

/** Returns an inert dialog host runtime for SSR environments. */
export function noop(): Host {
  const store = createStore<State>(() => ({
    mode: undefined,
    origin: undefined,
    ready: false,
    requests: [],
  }))
  const off = () => () => {}
  return {
    channel: channel.noopHost(),
    provider: {} as CoreProvider.Provider,
    store,
    trustedHosts: [],
    onUserRequest: off,
    onRequests: off,
    ready: () => {},
    reject: () => {},
    rejectAll: () => {},
    respond: async () => {},
  }
}

/**
 * Validates an RPC request from search params.
 *
 * Parses against the `Schema.Request` discriminated union, checks the
 * method matches, and enforces strict parameter schemas unless `strict` is
 * false. On failure, rejects all pending requests so the consumer is notified
 * before the router error boundary renders.
 */
export function validateSearch<const method extends Schema.Request['method']>(
  host: Host,
  search: Record<string, unknown>,
  parameters: validateSearch.Options<method>,
): validateSearch.ReturnType<method> {
  const { method } = parameters
  try {
    const result = Schema.Request.safeParse(search)
    if (!result.success)
      throw new RpcResponse.InvalidParamsError({
        message: formatZodErrors(method, result.error),
      })
    if (result.data.method !== method)
      throw new RpcResponse.InvalidParamsError({
        message: `Method mismatch: expected "${method}" but got "${result.data.method}".`,
      })
    const strict = parameters.strict ?? true
    const schema_strict = Rpc.strictParameters[method as keyof typeof Rpc.strictParameters]
    const params = (search.params as readonly unknown[] | undefined)?.[0]
    if (strict && schema_strict && params !== undefined) {
      const result_strict = schema_strict.safeParse(params)
      if (!result_strict.success)
        throw new RpcResponse.InvalidParamsError({
          message: formatZodErrors(method, result_strict.error),
        })
    }
    return {
      ...search,
      _decoded: result.data,
      id: Number(search.id),
      jsonrpc: '2.0',
    } as never
  } catch (error) {
    if (error instanceof RpcResponse.BaseError) void host.rejectAll(error)
    throw error
  }
}

export declare namespace validateSearch {
  type Options<method extends Schema.Request['method']> = {
    /** Expected RPC method for this route. */
    method: method
    /** Whether to apply strict parameter policy validation. */
    strict?: boolean | undefined
  }

  type ReturnType<method extends Schema.Request['method']> = Extract<
    Schema.Request,
    { method: method }
  > & {
    id: number
    jsonrpc: '2.0'
    _decoded: Extract<Schema.Request, { method: method }>
    _returnType: unknown
  }
}

type ZodIssue = {
  path: readonly PropertyKey[]
  code: string
  message: string
  expected?: string | undefined
  errors?: readonly (readonly ZodIssue[])[] | undefined
}

function formatZodErrors(method: string, error: { issues: readonly ZodIssue[] }) {
  const issues = flattenIssues(error.issues)
    .map((i) => `  - ${i.path.map(String).join('.')}: ${i.message}`)
    .join('\n')
  return `Invalid params for "${method}":\n${issues}`
}

function flattenIssues(
  issues: readonly ZodIssue[],
): { path: readonly PropertyKey[]; message: string }[] {
  const result: { path: readonly PropertyKey[]; message: string }[] = []
  for (const issue of issues) {
    if (issue.errors?.length) {
      const best = issue.errors.reduce((a, b) => (a.length <= b.length ? a : b))
      for (const nested of flattenIssues(best))
        result.push({ path: [...issue.path, ...nested.path], message: nested.message })
    } else {
      let message = issue.message
      if (issue.code === 'invalid_type' && issue.expected) message = `Expected ${issue.expected}`
      else if (issue.code === 'invalid_value') message = 'Invalid value'
      result.push({ path: issue.path, message })
    }
  }
  return result
}
