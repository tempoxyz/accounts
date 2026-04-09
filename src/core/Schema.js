import { RpcSchema } from 'ox'
import { rpcSchema } from 'viem'
import * as z from 'zod/mini'

import * as Rpc from './zod/rpc.js'
export { defineItem, from } from './internal/schema.js'
import { from } from './internal/schema.js'
/** All provider-handled RPC method definitions. */
export const schema = from([
  Rpc.eth_accounts.schema,
  Rpc.eth_chainId.schema,
  Rpc.eth_fillTransaction.schema,
  Rpc.eth_requestAccounts.schema,
  Rpc.eth_sendTransaction.schema,
  Rpc.eth_sendTransactionSync.schema,
  Rpc.eth_signTransaction.schema,
  Rpc.eth_signTypedData_v4.schema,
  Rpc.personal_sign.schema,
  Rpc.wallet_authorizeAccessKey.schema,
  Rpc.wallet_connect.schema,
  Rpc.wallet_deposit.schema,
  Rpc.wallet_disconnect.schema,
  Rpc.wallet_getBalances.schema,
  Rpc.wallet_getCallsStatus.schema,
  Rpc.wallet_getCapabilities.schema,
  Rpc.wallet_revokeAccessKey.schema,
  Rpc.wallet_sendCalls.schema,
  Rpc.wallet_switchEthereumChain.schema,
])
export const ox = RpcSchema.from()
export const viem = rpcSchema()
/** Builds a request `z.object` from a schema item at runtime. */
function toRequestSchema(item) {
  if (item.params) return z.object({ method: item.method, params: item.params })
  return z.object({ method: item.method })
}
/** Discriminated union of all provider-handled RPC requests. */
export const Request = z.discriminatedUnion('method', schema.map(toRequestSchema))
//# sourceMappingURL=Schema.js.map
