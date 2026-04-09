import type { RpcRequest, RpcResponse } from 'ox'

import type * as Store from './Store.js'
/** Messenger interface for cross-frame communication. */
export type Messenger = {
  /** Tear down all listeners. */
  destroy: () => void
  /** Subscribe to a topic. Returns an unsubscribe function. */
  on: <const topic extends Topic>(
    topic: topic | Topic,
    listener: (payload: Payload<topic>, event: MessageEvent) => void,
    id?: string | undefined,
  ) => () => void
  /** Send a message on a topic. */
  send: <const topic extends Topic>(
    topic: topic | Topic,
    payload: Payload<topic>,
    targetOrigin?: string | undefined,
  ) => Promise<{
    id: string
    topic: topic
    payload: Payload<topic>
  }>
}
/** Options sent with the `ready` signal from the remote frame. */
export type ReadyOptions = {
  /** CSS `color-scheme` used by the remote embed (e.g. `'dark'`). */
  colorScheme?: string | undefined
  /** Hostnames trusted by the remote embed to render in an iframe. */
  trustedHosts?: readonly string[] | undefined
}
/** Bridge messenger that waits for a `ready` signal from the remote frame. */
export type Bridge = Messenger & {
  /** Signal readiness (called by the remote frame). */
  ready: (options?: ReadyOptions | undefined) => void
  /** Promise that resolves when the remote frame signals ready. */
  waitForReady: () => Promise<ReadyOptions>
}
/** Message schema for cross-frame communication. */
export type Schema = [
  {
    topic: 'ready'
    payload: ReadyOptions
  },
  {
    topic: 'rpc-requests'
    payload: {
      account:
        | {
            address: string
          }
        | undefined
      chainId: number
      requests: readonly Store.QueuedRequest[]
    }
  },
  {
    topic: 'rpc-response'
    payload: RpcResponse.RpcResponse & {
      _request: RpcRequest.RpcRequest
    }
  },
  {
    topic: 'close'
    payload: undefined
  },
  {
    topic: 'switch-mode'
    payload: {
      mode: 'popup'
    }
  },
]
/** Union of all topic strings. */
export type Topic = Schema[number]['topic']
/** Payload for a given topic. */
export type Payload<topic extends Topic> = Extract<
  Schema[number],
  {
    topic: topic
  }
>['payload']
/** Creates a messenger from a custom implementation. */
export declare function from(messenger: Messenger): Messenger
/**
 * Creates a messenger backed by `window.postMessage` / `addEventListener('message')`.
 * Filters messages by `targetOrigin` when provided.
 */
export declare function fromWindow(w: Window, options?: fromWindow.Options): Messenger
export declare namespace fromWindow {
  type Options = {
    /** Only accept messages from this origin. Also used as the `targetOrigin` for `postMessage`. */
    targetOrigin?: string | undefined
  }
}
/**
 * Bridges two window messengers. The bridge waits for a `ready` signal
 * before sending messages when `waitForReady` is `true`.
 */
export declare function bridge(parameters: bridge.Parameters): Bridge
export declare namespace bridge {
  type Parameters = {
    /** Listens on this messenger. */
    from: Messenger
    /** Sends to this messenger. */
    to: Messenger
    /** Buffer sends until `ready` is received. */
    waitForReady?: boolean | undefined
  }
}
/** Returns a no-op bridge for SSR environments. */
export declare function noop(): Bridge
//# sourceMappingURL=Messenger.d.ts.map
