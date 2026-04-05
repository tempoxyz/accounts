import { Hex } from 'ox'
import * as Provider from 'ox/Provider'
import * as RpcResponse from 'ox/RpcResponse'
import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'

import type * as Messenger from '../core/Messenger.js'
import type * as CoreProvider from '../core/Provider.js'
import * as Schema from '../core/Schema.js'
import type * as Store from '../core/Store.js'
import * as Rpc from '../core/zod/rpc.js'

/** State managed by the remote (dialog) side. */
export type State = {
  /** Whether the dialog is rendered in an iframe or popup. */
  mode: 'iframe' | 'popup' | undefined
  /** Trusted host origin from MessageEvent. */
  origin: string | undefined
  /** Whether the dialog is ready to display content. */
  ready: boolean
  /** Queued RPC requests received from the host. */
  requests: readonly Store.QueuedRequest[]
}

/** Remote context — bundles messenger, provider, and remote store. */
export type Remote = {
  /**
   * Messenger for remote communication.
   */
  messenger: Messenger.Bridge
  /**
   * Provider instance for executing RPC methods.
   */
  provider: CoreProvider.Provider
  /**
   * Remote context store.
   */
  store: StoreApi<State>
  /**
   * Hostnames trusted to render the embed in an iframe.
   */
  trustedHosts: readonly string[]
  /**
   * Subscribes to user-facing RPC requests from the parent context.
   *
   * Syncs the host's active chain, updates the remote store, and invokes
   * the callback with the first pending request (or `null` when the queue
   * is cleared, signalling the UI should close).
   *
   * @param cb - Callback receiving the request payload.
   * @returns Unsubscribe function.
   */
  onUserRequest: (cb: (payload: onUserRequest.Payload) => void | Promise<void>) => () => void
  /**
   * Subscribes to incoming RPC requests from the parent context.
   * Updates the remote store with the received requests and syncs the
   * host's active chain to the remote provider.
   *
   * @param cb - Callback receiving the full queued request list.
   * @returns Unsubscribe function.
   */
  onRequests: (
    cb: (
      requests: readonly Store.QueuedRequest[],
      event: MessageEvent,
      extra: { account: { address: string } | undefined },
    ) => void,
  ) => () => void
  /**
   * Signals readiness to the host and begins accepting requests.
   * Call this after the remote context is fully initialized.
   */
  ready: () => void
  /**
   * Reject an RPC request.
   */
  reject: (
    request: Store.QueuedRequest['request'],
    error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined,
  ) => void
  /** Reject all pending RPC requests. */
  rejectAll: (error?: Provider.ProviderRpcError | RpcResponse.BaseError | undefined) => void
  /**
   * Respond to an RPC request.
   *
   * When `options.result` is provided, sends it directly.
   * When `options.error` is provided, sends an error response.
   * Otherwise, executes `provider.request(request)` and sends the result.
   */
  respond: (request: Store.QueuedRequest['request'], options?: respond.Options) => Promise<unknown>
}

export declare namespace onUserRequest {
  type Payload = {
    /** Active account on the host side. */
    account: { address: string } | undefined
    /** Origin of the host that opened this dialog. */
    origin: string
    /** The pending request to display, or `null` when the dialog should close. */
    request: Store.QueuedRequest['request'] | null
  }
}

export declare namespace respond {
  type Options = {
    /** Error to respond with (takes precedence over result). */
    error?: { code: number; message: string } | undefined
    /** Explicit result — if omitted, calls `provider.request(request)`. */
    result?: unknown | undefined
    /** Transform the result before sending. */
    selector?: ((result: any) => unknown) | undefined
  }
}

/** Creates a remote context for the dialog app. */
export function create(options: create.Options): Remote {
  const { messenger, provider, trustedHosts } = options
  const ready =
    typeof window !== 'undefined' && !new URLSearchParams(window.location.search).get('mode')
  const store = createStore<State>(() => ({
    mode: undefined,
    origin: undefined,
    ready,
    requests: [],
  }))

  return {
    messenger,
    provider,
    store,
    trustedHosts: trustedHosts ?? [],

    onUserRequest(cb) {
      return this.onRequests(async (requests, event, { account }) => {
        // Sync the active account with the host.
        if (account) {
          const state = provider.store.getState()
          const index = state.accounts.findIndex(
            (a) => a.address.toLowerCase() === account.address.toLowerCase(),
          )
          if (index >= 0 && index !== state.activeAccount)
            provider.store.setState({ activeAccount: index })
        }

        const pending = requests.find((r) => r.status === 'pending')
        store.setState({
          origin: event.origin,
          ready: false,
        })
        await cb({
          account,
          origin: event.origin,
          request: pending?.request ?? null,
        })
        if (pending) store.setState({ ready: true })
      })
    },

    onRequests(cb) {
      return messenger.on('rpc-requests', async (payload, event) => {
        const { account, chainId, requests } = payload

        // Rehydrate persisted state so the iframe picks up accounts
        // created in a popup (e.g. Safari WebAuthn fallback).
        await provider.store.persist?.rehydrate()

        store.setState({ requests })

        if (provider.store.getState().chainId !== chainId)
          provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(chainId) }],
          })

        cb(requests, event, { account })
      })
    },

    ready() {
      messenger.ready({ trustedHosts })

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const mode = params.get('mode') as State['mode']
        const chainId = Number(params.get('chainId'))

        if (mode) store.setState({ mode })

        if (chainId && provider.store.getState().chainId !== chainId)
          provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(chainId) }],
          })
      }
    },

    reject(request, error) {
      const error_ = error ?? new Provider.UserRejectedRequestError()
      messenger.send(
        'rpc-response',
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
      const { error, selector } = options
      const shared = { id: request.id, jsonrpc: '2.0' } as const

      if (error) {
        messenger.send(
          'rpc-response',
          Object.assign(RpcResponse.from({ ...shared, error, status: 'error' }), {
            _request: request,
          }),
        )
        return
      }

      try {
        let result = 'result' in options ? options.result : (await provider?.request(request as never))
        if (selector) result = selector(result)
        messenger.send(
          'rpc-response',
          Object.assign(RpcResponse.from({ ...shared, result }), { _request: request }),
        )
        return result
      } catch (e) {
        // Browser extensions (e.g. Bitwarden) monkey-patch navigator.credentials
        // and reject WebAuthn calls in cross-origin iframes. Fall back to popup
        // so the credential ceremony runs in a top-level browsing context.
        if (e instanceof Error && e.message.includes('sameOriginWithAncestors')) {
          messenger.send('switch-mode', { mode: 'popup' })
          return
        }

        const err = e as RpcResponse.BaseError
        messenger.send(
          'rpc-response',
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
    /** Bridge messenger for cross-frame communication. */
    messenger: Messenger.Bridge
    /** Provider to execute RPC requests against. */
    provider: CoreProvider.Provider
    /** Hostnames trusted to render the embed in an iframe. */
    trustedHosts?: readonly string[] | undefined
  }
}

/** Returns an inert remote context for SSR environments. */
export function noop(): Remote {
  const store = createStore<State>(() => ({
    mode: undefined,
    origin: undefined,
    ready: false,
    requests: [],
  }))
  const off = () => () => {}
  return {
    messenger: {
      destroy: () => {},
      on: () => () => {},
      ready: () => {},
      send: () => {},
      waitForReady: () => Promise.resolve({}),
    } as unknown as Messenger.Bridge,
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
 * method matches, and enforces strict parameter schemas (e.g. required
 * `limits`). On failure, rejects all pending requests via the messenger
 * and re-throws so the router can handle the error boundary.
 */
export function validateSearch<const method extends Schema.Request['method']>(
  remote: Remote,
  search: Record<string, unknown>,
  parameters: { method: method },
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
    const strict = Rpc.strictParameters[method as keyof typeof Rpc.strictParameters]
    const params = (search.params as readonly unknown[] | undefined)?.[0]
    if (strict && params !== undefined) {
      const strictResult = strict.safeParse(params)
      if (!strictResult.success)
        throw new RpcResponse.InvalidParamsError({
          message: formatZodErrors(method, strictResult.error),
        })
    }
    return {
      ...search,
      _decoded: result.data,
      id: Number(search.id),
      jsonrpc: '2.0',
    } as never
  } catch (error) {
    if (error instanceof RpcResponse.BaseError) void remote.rejectAll(error)
    throw error
  }
}

export declare namespace validateSearch {
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
