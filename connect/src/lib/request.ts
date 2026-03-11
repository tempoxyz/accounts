import { type Messenger, Schema } from '@tempoxyz/accounts'
import type { RpcResponse } from 'ox'

/** Stub address used for MVP auto-approve responses. */
const stubAddress = '0x0000000000000000000000000000000000000000' as const

/** Stub transaction hash used for MVP auto-approve responses. */
const stubHash = '0x0000000000000000000000000000000000000000000000000000000000000001' as const

/** Stub signature used for MVP auto-approve responses. */
const stubSignature = '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as const

/** Routes an RPC request to a stub handler. Returns `{ result }` or `{ error }`. */
export function handle(
  request: Messenger.Payload<'rpc-requests'>[number],
): Omit<RpcResponse.RpcResponse, 'id' | 'jsonrpc'> {
  const parsed = Schema.Request.safeParse(request)
  if (!parsed.success)
    return { error: { code: -32601, message: 'Unsupported method' } }

  switch (parsed.data.method) {
    case 'wallet_connect':
      return {
        result: {
          accounts: [
            {
              address: stubAddress,
              capabilities: {},
            },
          ],
        },
      }

    case 'eth_sendTransaction':
    case 'eth_sendTransactionSync':
    case 'eth_signTransaction':
      return { result: stubHash }

    case 'personal_sign':
    case 'eth_signTypedData_v4':
      return { result: stubSignature }

    case 'wallet_authorizeAccessKey':
      return {
        result: {
          address: stubAddress,
          chainId: '0x1',
          expiry: null,
          keyId: stubAddress,
          keyType: 'secp256k1',
          limits: [],
          signature: {},
        },
      }

    case 'wallet_revokeAccessKey':
      return { result: undefined }

    default:
      return { error: { code: -32601, message: 'Unsupported method' } }
  }
}
