import type { RpcRequest, RpcResponse } from 'ox'
import { postMessage as wataConsumerPostMessage, Wata } from 'wata'
import { postMessage as wataHostPostMessage, Wata as HostWata } from 'wata/host'

import type { Meta, ReadyOptions, RequestContext, Theme } from './types.js'

/** Channel used by the app/SDK side of the dialog protocol. */
export type Consumer = {
  /** Close the underlying Wata session. */
  close: () => Promise<void>
  /** Cancel pending dialog requests. */
  cancelRequests: (payload: CancelRequests) => Promise<void>
  /** Subscribe to host info from the dialog host. */
  onReady: (listener: (options: ReadyOptions) => void) => () => void
  /** Subscribe to iframe-to-popup switch requests from the dialog host. */
  onSwitchMode: (listener: (payload: SwitchMode) => void) => () => void
  /** Send a dialog request to the dialog host and wait for its response. */
  request: (payload: RequestContext) => Promise<unknown>
  /** Send the current theme to the dialog host. */
  sendTheme: (theme: Theme) => Promise<void>
  /** Start the underlying Wata session after handlers are registered. */
  start: () => Promise<void>
  /** Ask the dialog host to validate cached local account addresses. */
  validateCachedAccounts: (
    payload: ValidateCachedAccountsRequest,
  ) => Promise<ValidateCachedAccountsResponse>
  /** Resolves when the dialog host sends host info. */
  waitForReady: () => Promise<ReadyOptions>
}

/** Channel used by the wallet/dialog host side of the dialog protocol. */
export type Host = {
  /** Close the underlying Wata session. */
  close: () => Promise<void>
  /** Subscribe to cancellation requests from the consumer. */
  onCancelRequests: (listener: (payload: CancelRequests, meta: Meta) => void) => () => void
  /** Subscribe to requests from the consumer. */
  onRequest: (listener: (payload: RequestContext, meta: Meta) => void) => () => void
  /** Handle cached-account validation requests from the consumer. */
  onValidateCachedAccounts: (
    listener: (
      payload: ValidateCachedAccountsRequest,
      meta: Meta,
    ) => ValidateCachedAccountsResponse | Promise<ValidateCachedAccountsResponse> | void,
  ) => () => void
  /** Subscribe to live theme updates from the consumer. */
  onTheme: (listener: (theme: Theme, meta: Meta) => void) => () => void
  /** Send host metadata to the consumer. */
  ready: (options?: ReadyOptions | undefined) => Promise<void>
  /** Send an RPC response to the consumer. */
  sendResponse: (response: Response) => Promise<void>
  /** Request that the consumer switch an iframe flow to popup mode. */
  switchMode: (payload: SwitchMode) => Promise<void>
  /** Start the underlying Wata session after handlers are registered. */
  start: () => Promise<void>
}

/** RPC response sent from the dialog host back to the consumer. */
export type Response = RpcResponse.RpcResponse & {
  /** Original JSON-RPC request that produced this response. */
  _request: RpcRequest.RpcRequest
}

/** Dialog request cancellation payload. */
export type CancelRequests = { ids?: readonly RequestId[] | undefined }

/** Consumer-to-host cached-account validation request. */
export type ValidateCachedAccountsRequest = { addresses?: readonly string[] | undefined }

/** Host-to-consumer cached-account validation response. */
export type ValidateCachedAccountsResponse = { valid?: boolean | undefined }

/** Dialog mode switch request. */
export type SwitchMode = { mode: 'popup' }

type DialogRequestPayload = {
  account: RequestContext['account']
  chainId: RequestContext['chainId']
  request: RpcRequest.RpcRequest
}

/** JSON-RPC request identifier used for dialog request routing. */
export type RequestId = string | number
type PostMessageTarget = Window | MessagePort

/** Creates the app/SDK side of a Wata-backed dialog channel. */
export function consumerPostMessage(options: consumerPostMessage.Options): Consumer {
  const source = options.source ?? window
  const wata = Wata.create({
    transports: [
      wataConsumerPostMessage({
        close: () => {},
        host: options.host,
        source,
        target: options.target,
      }),
    ],
  })
  const ready = withResolvers<ReadyOptions>()
  void ready.promise.catch(() => {})
  const readyListeners = new Set<(options: ReadyOptions) => void>()
  const switchModeListeners = new Set<(payload: SwitchMode) => void>()
  let error: Error | undefined
  let readyPromise: Promise<ReadyOptions> | undefined

  wata.on('error', (error_) => {
    error = error_
    ready.reject(error_)
  })
  wata.on('notification', (event) => {
    if (event.method !== 'dialog.mode.switch') return
    const payload = firstParam(event.params) as SwitchMode
    for (const listener of switchModeListeners) listener(payload)
  })

  return {
    async close() {
      await wata.close()
      readyListeners.clear()
      switchModeListeners.clear()
    },
    cancelRequests(payload) {
      return wata.notify({
        method: 'dialog.requests.cancel',
        params: [normalizeValue(payload)] as const,
      })
    },
    onReady(listener) {
      readyListeners.add(listener)
      return () => {
        readyListeners.delete(listener)
      }
    },
    onSwitchMode(listener) {
      switchModeListeners.add(listener)
      return () => {
        switchModeListeners.delete(listener)
      }
    },
    async request(payload) {
      await start()
      const { result } = await wata.send({
        id: payload.request.request.id,
        method: 'dialog.request',
        params: [
          normalizeValue({
            account: payload.account,
            chainId: payload.chainId,
            request: payload.request.request,
          }),
        ] as const,
      })
      return result
    },
    async validateCachedAccounts(payload) {
      if (!payload.addresses) return {}
      const { result } = await wata.send({
        method: 'dialog.cachedAccounts.validate',
        params: [normalizeValue(payload)] as const,
      })
      return result as ValidateCachedAccountsResponse
    },
    async sendTheme(theme) {
      await wata.notify({
        method: 'dialog.theme.update',
        params: [normalizeValue(theme)] as const,
      })
    },
    start,
    waitForReady() {
      return hostInfo()
    },
  }

  function hostInfo() {
    if (error) return Promise.reject(error)
    readyPromise ??= wata
      .send({ method: 'dialog.hostInfo', params: [] })
      .then(({ result }) => {
        const options = (result ?? {}) as ReadyOptions
        ready.resolve(options)
        for (const listener of readyListeners) listener(options)
        return options
      })
      .catch((error) => {
        ready.reject(error)
        throw error
      })
    return readyPromise
  }

  async function start() {
    try {
      if (options.open) await options.open
      await wata.start()
    } catch (error) {
      ready.reject(error)
      throw error
    }
  }
}

export declare namespace consumerPostMessage {
  type Options = {
    /** URL or origin of the dialog host. */
    host: string
    /** Optional gate before opening the Wata transport. */
    open?: Promise<void> | undefined
    /** Window that receives inbound postMessage events. */
    source?: Window | undefined
    /** Peer window to send messages to. */
    target: () => PostMessageTarget
  }
}

/** Creates the wallet/dialog host side of a Wata-backed dialog channel. */
export function hostPostMessage(options: hostPostMessage.Options): Host {
  const source = options.source ?? window
  const { getOrigin, source: source_ } = withOrigin(source)
  const wata = HostWata.create({
    transports: [
      wataHostPostMessage({
        close: () => {},
        source: source_,
        target: options.target,
        targetOrigin: options.targetOrigin,
      }),
    ],
  })
  const cancelRequestsListeners = new Set<(payload: CancelRequests, meta: Meta) => void>()
  const requestListeners = new Set<(payload: RequestContext, meta: Meta) => void>()
  let validateCachedAccountsListener:
    | ((
        payload: ValidateCachedAccountsRequest,
        meta: Meta,
      ) => ValidateCachedAccountsResponse | Promise<ValidateCachedAccountsResponse> | void)
    | undefined
  const themeListeners = new Set<(theme: Theme, meta: Meta) => void>()
  const hostInfoRequests = new Set<HostWata.RequestEvent>()
  const requests = new Map<RequestId, HostWata.RequestEvent>()
  let readyOptions: ReadyOptions | undefined

  wata.on('request', (event) => {
    const meta = { origin: getOrigin() ?? '' }
    if (event.method === 'dialog.hostInfo') {
      if (readyOptions) void event.respond(readyOptions)
      else hostInfoRequests.add(event)
      return
    }
    if (event.method === 'dialog.cachedAccounts.validate') {
      const payload = firstParam(event.params) as ValidateCachedAccountsRequest
      if (!validateCachedAccountsListener) {
        void event.respond({})
        return
      }
      void Promise.resolve(validateCachedAccountsListener(payload, meta))
        .then((result) => event.respond(normalizeValue(result ?? {})))
        .catch((error) => event.reject(errorToResponse(error)))
      return
    }
    if (event.method !== 'dialog.request') return

    const payload = firstParam(event.params) as DialogRequestPayload
    requests.set(payload.request.id, event)
    for (const listener of requestListeners)
      listener(
        {
          account: payload.account,
          chainId: payload.chainId,
          request: { request: payload.request, status: 'pending' },
        },
        meta,
      )
  })

  wata.on('notification', (event) => {
    const meta = { origin: getOrigin() ?? '' }
    if (event.method === 'dialog.requests.cancel') {
      const payload = firstParam(event.params) as CancelRequests
      for (const listener of cancelRequestsListeners) listener(payload, meta)
      return
    }
    if (event.method === 'dialog.theme.update') {
      const theme = firstParam(event.params) as Theme
      for (const listener of themeListeners) listener(theme, meta)
    }
  })

  return {
    async close() {
      await wata.close()
      cancelRequestsListeners.clear()
      requestListeners.clear()
      validateCachedAccountsListener = undefined
      themeListeners.clear()
      hostInfoRequests.clear()
      requests.clear()
    },
    onCancelRequests(listener) {
      cancelRequestsListeners.add(listener)
      return () => {
        cancelRequestsListeners.delete(listener)
      }
    },
    onRequest(listener) {
      requestListeners.add(listener)
      return () => {
        requestListeners.delete(listener)
      }
    },
    onValidateCachedAccounts(listener) {
      validateCachedAccountsListener = listener
      return () => {
        if (validateCachedAccountsListener === listener) validateCachedAccountsListener = undefined
      }
    },
    onTheme(listener) {
      themeListeners.add(listener)
      return () => {
        themeListeners.delete(listener)
      }
    },
    ready(options) {
      readyOptions = options ?? {}
      const pending = [...hostInfoRequests]
      hostInfoRequests.clear()
      return Promise.all(pending.map((request) => request.respond(readyOptions))).then(() => {})
    },
    sendResponse(response) {
      const request = requests.get(response.id)
      if (!request) return Promise.resolve()
      requests.delete(response.id)
      if ('error' in response && response.error)
        return request.reject({
          code: response.error.code,
          message: response.error.message,
        })
      return request.respond(normalizeValue(response.result))
    },
    switchMode(payload) {
      return wata.notify({
        method: 'dialog.mode.switch',
        params: [normalizeValue(payload)] as const,
      })
    },
    async start() {
      if (options.open) await options.open
      await wata.start()
    },
  }
}

/** Returns an inert consumer channel for SSR and disconnected environments. */
export function noopConsumer(): Consumer {
  const ready = Promise.resolve({})
  return {
    close: async () => {},
    cancelRequests: async () => {},
    onReady: () => () => {},
    onSwitchMode: () => () => {},
    request: async () => undefined,
    sendTheme: async () => {},
    start: async () => {},
    validateCachedAccounts: async () => ({}),
    waitForReady: () => ready,
  }
}

/** Returns an inert host channel for SSR and disconnected environments. */
export function noopHost(): Host {
  return {
    close: async () => {},
    onCancelRequests: () => () => {},
    onRequest: () => () => {},
    onValidateCachedAccounts: () => () => {},
    onTheme: () => () => {},
    ready: async () => {},
    sendResponse: async () => {},
    switchMode: async () => {},
    start: async () => {},
  }
}

export declare namespace hostPostMessage {
  type Options = {
    /** Optional gate before opening the Wata transport. */
    open?: Promise<void> | undefined
    /** Window that receives inbound postMessage events. */
    source?: Window | undefined
    /** Peer window to send messages to. */
    target: () => PostMessageTarget
    /** Consumer origin. Defaults to Wata's host-side wildcard. */
    targetOrigin?: string | undefined
  }
}

function withOrigin(source: Window): {
  getOrigin: () => string | undefined
  source: WindowLike
} {
  const listeners = new Map<EventListenerOrEventListenerObject, EventListener>()
  let origin: string | undefined
  return {
    getOrigin() {
      return origin
    },
    source: {
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean | undefined,
      ) {
        if (type !== 'message') {
          source.addEventListener(type, listener, options)
          return
        }
        const wrapped = ((event: MessageEvent) => {
          origin = event.origin
          if (typeof listener === 'function') listener(event)
          else listener.handleEvent(event)
        }) as EventListener
        listeners.set(listener, wrapped)
        source.addEventListener(type, wrapped, options)
      },
      postMessage(data, targetOrigin) {
        source.postMessage(data, targetOrigin)
      },
      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: EventListenerOptions | boolean | undefined,
      ) {
        if (type !== 'message') {
          source.removeEventListener(type, listener, options)
          return
        }
        const wrapped = listeners.get(listener)
        source.removeEventListener(type, wrapped ?? listener, options)
        listeners.delete(listener)
      },
    },
  }
}

type WindowLike = {
  addEventListener: Window['addEventListener']
  postMessage: (data: unknown, targetOrigin: string) => void
  removeEventListener: Window['removeEventListener']
}

function withResolvers<type>() {
  let resolve: (value: type | PromiseLike<type>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<type>((resolve_, reject_) => {
    resolve = resolve_
    reject = reject_
  })
  return { promise, reject, resolve }
}

function errorToResponse(error: unknown): RpcResponse.ErrorObject {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error)
    return {
      code: Number(error.code),
      message: String(error.message),
    }
  if (error instanceof Error) return { code: -32603, message: error.message }
  return { code: -32603, message: String(error) }
}

function firstParam(
  params:
    | HostWata.RequestEvent['params']
    | HostWata.NotificationEvent['params']
    | Wata.NotificationEvent['params'],
) {
  if (!Array.isArray(params)) return undefined
  return params[0]
}

function normalizeValue<type>(value: type): type {
  if (Array.isArray(value)) return value.map(normalizeValue) as never
  if (typeof value === 'function') return undefined as never
  if (typeof value === 'bigint') return value.toString() as never
  if (typeof value === 'symbol') return undefined as never
  if (!value) return value
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value_] of Object.entries(value)) out[key] = normalizeValue(value_ as never)
    return out as type
  }
  return value
}
