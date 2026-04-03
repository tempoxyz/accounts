/** Topic for messages between inpage ↔ content script ↔ background. */
const topic = 'tempo-wallet' as const

/** RPC request message from inpage → background. */
export type RpcRequest = {
  topic: typeof topic
  type: 'rpc-request'
  id: string
  method: string
  params?: unknown
}

/** RPC response message from background → inpage. */
export type RpcResponse = {
  topic: typeof topic
  type: 'rpc-response'
  id: string
  result?: unknown
  error?: { code: number; message: string } | undefined
}

export type Message = RpcRequest | RpcResponse

/** Type guard for messages originating from this extension. */
export function isMessage(data: unknown): data is Message {
  return (
    typeof data === 'object' &&
    data !== null &&
    'topic' in data &&
    (data as Message).topic === topic
  )
}

/** Creates an RPC request message. */
export function request(
  id: string,
  method: string,
  params?: unknown,
): RpcRequest {
  return { topic, type: 'rpc-request', id, method, params }
}

/** Creates a success RPC response message. */
export function response(id: string, result: unknown): RpcResponse {
  return { topic, type: 'rpc-response', id, result }
}

/** Creates an error RPC response message. */
export function error(
  id: string,
  error: { code: number; message: string },
): RpcResponse {
  return { topic, type: 'rpc-response', id, error }
}
