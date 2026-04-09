import * as z from 'zod/mini'

import * as Schema from '../internal/schema.js'
import * as u from './utils.js'
export const log = z.object({
  address: u.address(),
  blockHash: u.hex(),
  blockNumber: u.bigint(),
  data: u.hex(),
  logIndex: u.number(),
  removed: z.boolean(),
  topics: z.readonly(z.array(u.hex())),
  transactionHash: u.hex(),
  transactionIndex: u.number(),
})
export const receipt = z.object({
  blobGasPrice: z.optional(u.bigint()),
  blobGasUsed: z.optional(u.bigint()),
  blockHash: u.hex(),
  blockNumber: u.bigint(),
  contractAddress: z.nullable(u.address()),
  cumulativeGasUsed: u.bigint(),
  effectiveGasPrice: u.bigint(),
  feePayer: z.optional(u.address()),
  feeToken: z.optional(u.address()),
  from: u.address(),
  gasUsed: u.bigint(),
  logs: z.array(log),
  logsBloom: u.hex(),
  root: z.optional(u.hex()),
  status: z.codec(u.hex(), z.enum(['success', 'reverted']), {
    decode: (value) => (value === '0x1' ? 'success' : 'reverted'),
    encode: (value) => (value === 'success' ? '0x1' : '0x0'),
  }),
  to: z.nullable(u.address()),
  transactionHash: u.hex(),
  transactionIndex: u.number(),
  type: u.hex(),
})
export const signatureEnvelope = z.custom()
export const keyType = z.union([z.literal('secp256k1'), z.literal('p256'), z.literal('webAuthn')])
export const keyAuthorization = z.object({
  address: u.address(),
  chainId: u.bigint(),
  expiry: z.nullish(u.number()),
  keyId: u.address(),
  keyType,
  limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
  signature: signatureEnvelope,
})
export const call = z.object({
  data: z.optional(u.hex()),
  to: z.optional(u.address()),
  value: z.optional(u.bigint()),
})
export const transactionRequest = z.object({
  accessList: z.optional(
    z.array(z.object({ address: u.address(), storageKeys: z.array(u.hex()) })),
  ),
  calls: z.optional(z.readonly(z.array(call))),
  chainId: z.optional(u.number()),
  data: z.optional(u.hex()),
  feePayer: z.optional(z.union([z.boolean(), z.string()])),
  feeToken: z.optional(u.address()),
  from: z.optional(u.address()),
  gas: z.optional(u.bigint()),
  keyAuthorization: z.optional(keyAuthorization),
  maxFeePerGas: z.optional(u.bigint()),
  maxPriorityFeePerGas: z.optional(u.bigint()),
  nonce: z.optional(u.number()),
  nonceKey: z.optional(u.bigint()),
  to: z.optional(u.address()),
  validAfter: z.optional(u.number()),
  validBefore: z.optional(u.number()),
  value: z.optional(u.bigint()),
})
export var eth_accounts
;(function (eth_accounts) {
  eth_accounts.schema = Schema.defineItem({
    method: z.literal('eth_accounts'),
    params: undefined,
    returns: z.readonly(z.array(u.address())),
  })
})(eth_accounts || (eth_accounts = {}))
export var eth_chainId
;(function (eth_chainId) {
  eth_chainId.schema = Schema.defineItem({
    method: z.literal('eth_chainId'),
    params: undefined,
    returns: u.hex(),
  })
})(eth_chainId || (eth_chainId = {}))
export var eth_requestAccounts
;(function (eth_requestAccounts) {
  eth_requestAccounts.schema = Schema.defineItem({
    method: z.literal('eth_requestAccounts'),
    params: undefined,
    returns: z.readonly(z.array(u.address())),
  })
})(eth_requestAccounts || (eth_requestAccounts = {}))
export var eth_sendTransaction
;(function (eth_sendTransaction) {
  eth_sendTransaction.schema = Schema.defineItem({
    method: z.literal('eth_sendTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: u.hex(),
  })
})(eth_sendTransaction || (eth_sendTransaction = {}))
export var eth_fillTransaction
;(function (eth_fillTransaction) {
  eth_fillTransaction.schema = Schema.defineItem({
    method: z.literal('eth_fillTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: z.any(),
  })
})(eth_fillTransaction || (eth_fillTransaction = {}))
export var eth_signTransaction
;(function (eth_signTransaction) {
  eth_signTransaction.schema = Schema.defineItem({
    method: z.literal('eth_signTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: u.hex(),
  })
})(eth_signTransaction || (eth_signTransaction = {}))
export var eth_sendTransactionSync
;(function (eth_sendTransactionSync) {
  eth_sendTransactionSync.schema = Schema.defineItem({
    method: z.literal('eth_sendTransactionSync'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: receipt,
  })
})(eth_sendTransactionSync || (eth_sendTransactionSync = {}))
export var eth_signTypedData_v4
;(function (eth_signTypedData_v4) {
  eth_signTypedData_v4.schema = Schema.defineItem({
    method: z.literal('eth_signTypedData_v4'),
    params: z.readonly(z.tuple([u.address(), z.string()])),
    returns: u.hex(),
  })
})(eth_signTypedData_v4 || (eth_signTypedData_v4 = {}))
export var personal_sign
;(function (personal_sign) {
  personal_sign.schema = Schema.defineItem({
    method: z.literal('personal_sign'),
    params: z.readonly(z.tuple([u.hex(), u.address()])),
    returns: u.hex(),
  })
})(personal_sign || (personal_sign = {}))
const sendCallsCapabilities = z.optional(z.object({ sync: z.optional(z.boolean()) }))
export var wallet_sendCalls
;(function (wallet_sendCalls) {
  wallet_sendCalls.schema = Schema.defineItem({
    method: z.literal('wallet_sendCalls'),
    params: z.optional(
      z.readonly(
        z.tuple([
          z.object({
            atomicRequired: z.optional(z.boolean()),
            calls: z.readonly(z.array(call)),
            capabilities: sendCallsCapabilities,
            chainId: z.optional(u.number()),
            from: z.optional(u.address()),
            version: z.optional(z.string()),
          }),
        ]),
      ),
    ),
    returns: z.object({
      atomic: z.optional(z.boolean()),
      capabilities: sendCallsCapabilities,
      chainId: z.optional(u.number()),
      id: z.string(),
      receipts: z.optional(z.array(receipt)),
      status: z.optional(z.number()),
      version: z.optional(z.string()),
    }),
  })
})(wallet_sendCalls || (wallet_sendCalls = {}))
export var wallet_getBalances
;(function (wallet_getBalances) {
  wallet_getBalances.schema = Schema.defineItem({
    method: z.literal('wallet_getBalances'),
    params: z.optional(
      z.readonly(
        z.tuple([
          z.object({
            account: z.optional(u.address()),
            chainId: z.optional(u.number()),
            tokens: z.optional(z.readonly(z.array(u.address()))),
          }),
        ]),
      ),
    ),
    returns: z.readonly(
      z.array(
        z.object({
          address: u.address(),
          balance: u.bigint(),
          decimals: z.number(),
          display: z.string(),
          name: z.string(),
          symbol: z.string(),
        }),
      ),
    ),
  })
})(wallet_getBalances || (wallet_getBalances = {}))
export var wallet_getCapabilities
;(function (wallet_getCapabilities) {
  wallet_getCapabilities.schema = Schema.defineItem({
    method: z.literal('wallet_getCapabilities'),
    params: z.optional(
      z.readonly(
        z.union([z.tuple([u.address()]), z.tuple([u.address(), z.readonly(z.array(u.hex()))])]),
      ),
    ),
    returns: z.record(
      u.hex(),
      z.object({
        accessKeys: z.optional(
          z.object({
            status: z.union([z.literal('supported'), z.literal('unsupported')]),
          }),
        ),
        atomic: z.object({
          status: z.union([z.literal('supported'), z.literal('ready'), z.literal('unsupported')]),
        }),
      }),
    ),
  })
})(wallet_getCapabilities || (wallet_getCapabilities = {}))
export var wallet_authorizeAccessKey
;(function (wallet_authorizeAccessKey) {
  wallet_authorizeAccessKey.parameters = z.object({
    address: z.optional(u.address()),
    expiry: z.number(),
    keyType: z.optional(keyType),
    limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
    publicKey: z.optional(u.hex()),
  })
  const returns = z.object({
    keyAuthorization,
    rootAddress: u.address(),
  })
  wallet_authorizeAccessKey.schema = Schema.defineItem({
    method: z.literal('wallet_authorizeAccessKey'),
    params: z.readonly(z.tuple([wallet_authorizeAccessKey.parameters])),
    returns,
  })
})(wallet_authorizeAccessKey || (wallet_authorizeAccessKey = {}))
export var wallet_authorizeAccessKey_strict
;(function (wallet_authorizeAccessKey_strict) {
  wallet_authorizeAccessKey_strict.parameters = z.object({
    address: z.optional(u.address()),
    expiry: z.number(),
    keyType: z.optional(keyType),
    limits: z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() }))),
    publicKey: z.optional(u.hex()),
  })
})(wallet_authorizeAccessKey_strict || (wallet_authorizeAccessKey_strict = {}))
export var wallet_revokeAccessKey
;(function (wallet_revokeAccessKey) {
  wallet_revokeAccessKey.schema = Schema.defineItem({
    method: z.literal('wallet_revokeAccessKey'),
    params: z.readonly(
      z.tuple([z.object({ address: u.address(), accessKeyAddress: u.address() })]),
    ),
    returns: undefined,
  })
})(wallet_revokeAccessKey || (wallet_revokeAccessKey = {}))
export var wallet_connect
;(function (wallet_connect) {
  wallet_connect.authorizeAccessKey = z.optional(wallet_authorizeAccessKey.parameters)
  wallet_connect.capabilities = {
    request: z.optional(
      z.union([
        z.object({
          digest: z.optional(u.hex()),
          authorizeAccessKey: wallet_connect.authorizeAccessKey,
          method: z.literal('register'),
          name: z.optional(z.string()),
          userId: z.optional(z.string()),
        }),
        z.object({
          digest: z.optional(u.hex()),
          credentialId: z.optional(z.string()),
          authorizeAccessKey: wallet_connect.authorizeAccessKey,
          method: z.optional(z.literal('login')),
          selectAccount: z.optional(z.boolean()),
        }),
      ]),
    ),
    result: z.object({
      keyAuthorization: z.optional(keyAuthorization),
      signature: z.optional(u.hex()),
    }),
  }
  wallet_connect.schema = Schema.defineItem({
    method: z.literal('wallet_connect'),
    params: z.optional(
      z.readonly(
        z.tuple([
          z.object({
            capabilities: wallet_connect.capabilities.request,
            chainId: z.optional(u.number()),
            version: z.optional(z.string()),
          }),
        ]),
      ),
    ),
    returns: z.object({
      accounts: z.readonly(
        z.array(
          z.object({
            address: u.address(),
            capabilities: wallet_connect.capabilities.result,
          }),
        ),
      ),
    }),
  })
})(wallet_connect || (wallet_connect = {}))
export var wallet_connect_strict
;(function (wallet_connect_strict) {
  const authorizeAccessKey = z.optional(wallet_authorizeAccessKey_strict.parameters)
  wallet_connect_strict.parameters = z.object({
    capabilities: z.optional(
      z.union([
        z.object({
          digest: z.optional(u.hex()),
          authorizeAccessKey,
          method: z.literal('register'),
          name: z.optional(z.string()),
          userId: z.optional(z.string()),
        }),
        z.object({
          digest: z.optional(u.hex()),
          credentialId: z.optional(z.string()),
          authorizeAccessKey,
          method: z.optional(z.literal('login')),
          selectAccount: z.optional(z.boolean()),
        }),
      ]),
    ),
    chainId: z.optional(u.number()),
    version: z.optional(z.string()),
  })
})(wallet_connect_strict || (wallet_connect_strict = {}))
export var wallet_disconnect
;(function (wallet_disconnect) {
  wallet_disconnect.schema = Schema.defineItem({
    method: z.literal('wallet_disconnect'),
    params: undefined,
    returns: undefined,
  })
})(wallet_disconnect || (wallet_disconnect = {}))
export var wallet_getCallsStatus
;(function (wallet_getCallsStatus) {
  wallet_getCallsStatus.schema = Schema.defineItem({
    method: z.literal('wallet_getCallsStatus'),
    params: z.optional(z.readonly(z.tuple([z.string()]))),
    returns: z.object({
      atomic: z.boolean(),
      chainId: u.number(),
      id: z.string(),
      receipts: z.optional(z.array(receipt)),
      status: z.number(),
      version: z.string(),
    }),
  })
})(wallet_getCallsStatus || (wallet_getCallsStatus = {}))
export var wallet_switchEthereumChain
;(function (wallet_switchEthereumChain) {
  wallet_switchEthereumChain.schema = Schema.defineItem({
    method: z.literal('wallet_switchEthereumChain'),
    params: z.readonly(z.tuple([z.object({ chainId: u.number() })])),
    returns: undefined,
  })
})(wallet_switchEthereumChain || (wallet_switchEthereumChain = {}))
export var wallet_deposit
;(function (wallet_deposit) {
  wallet_deposit.schema = Schema.defineItem({
    method: z.literal('wallet_deposit'),
    params: z.readonly(
      z.tuple([
        z.object({
          address: z.optional(u.address()),
          chainId: z.optional(u.number()),
          token: z.optional(u.address()),
          value: z.optional(z.string()),
        }),
      ]),
    ),
    returns: z.void(),
  })
})(wallet_deposit || (wallet_deposit = {}))
/** Strict parameter schemas keyed by method name. */
export const strictParameters = {
  wallet_authorizeAccessKey: wallet_authorizeAccessKey_strict.parameters,
  wallet_connect: wallet_connect_strict.parameters,
}
//# sourceMappingURL=rpc.js.map
