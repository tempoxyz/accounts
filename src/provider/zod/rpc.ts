import * as z from 'zod/mini'

import * as Schema from '../Schema.js'
import * as u from './utils.js'

const capabilities = {
  connect: z.optional(
    z.object({
      method: z.optional(z.union([z.literal('register'), z.literal('login')])),
    }),
  ),
}
export type Capabilities = z.output<typeof capabilities>

const log = z.object({
  address: u.address(),
  blockHash: u.hex(),
  blockNumber: u.hex(),
  data: u.hex(),
  logIndex: u.hex(),
  removed: z.boolean(),
  topics: z.readonly(z.array(u.hex())),
  transactionHash: u.hex(),
  transactionIndex: u.hex(),
})
export type Log = z.output<typeof log>

const receipt = z.object({
  blobGasPrice: z.optional(u.hex()),
  blobGasUsed: z.optional(u.hex()),
  blockHash: u.hex(),
  blockNumber: u.hex(),
  contractAddress: z.nullable(u.address()),
  cumulativeGasUsed: u.hex(),
  effectiveGasPrice: u.hex(),
  feePayer: z.optional(u.address()),
  feeToken: z.optional(u.address()),
  from: u.address(),
  gasUsed: u.hex(),
  logs: z.array(log),
  logsBloom: u.hex(),
  root: z.optional(u.hex()),
  status: u.hex(),
  to: z.nullable(u.address()),
  transactionHash: u.hex(),
  transactionIndex: u.hex(),
  type: u.hex(),
})
export type Receipt = z.output<typeof receipt>

const signatureEnvelope: z.ZodMiniType = u.oneOf([
  z.object({
    r: u.hex(),
    s: u.hex(),
    yParity: u.hex(),
    v: z.optional(u.hex()),
    type: z.literal('secp256k1'),
  }),
  z.object({
    preHash: z.boolean(),
    pubKeyX: u.hex(),
    pubKeyY: u.hex(),
    r: u.hex(),
    s: u.hex(),
    type: z.literal('p256'),
  }),
  z.object({
    pubKeyX: u.hex(),
    pubKeyY: u.hex(),
    r: u.hex(),
    s: u.hex(),
    type: z.literal('webAuthn'),
    webauthnData: u.hex(),
  }),
  z.object({
    type: z.literal('keychain'),
    userAddress: u.address(),
    signature: z.lazy(() => signatureEnvelope),
    version: z.optional(z.union([z.literal('v1'), z.literal('v2')])),
  }),
])
export type SignatureEnvelope = z.output<typeof signatureEnvelope>

const call = z.object({
  data: z.optional(u.hex()),
  to: z.optional(u.address()),
})

const transactionRequest = z.object({
  accessList: z.optional(
    z.array(z.object({ address: u.address(), storageKeys: z.array(u.hex()) })),
  ),
  calls: z.optional(z.readonly(z.array(call))),
  chainId: z.optional(u.number()),
  feePayer: z.optional(z.union([z.boolean(), z.url()])),
  feeToken: z.optional(u.address()),
  from: z.optional(u.address()),
  gas: z.optional(u.bigint()),
  maxFeePerGas: z.optional(u.bigint()),
  maxPriorityFeePerGas: z.optional(u.bigint()),
  nonce: z.optional(u.number()),
  nonceKey: z.optional(u.bigint()),
  validAfter: z.optional(u.number()),
  validBefore: z.optional(u.number()),
  value: z.optional(u.bigint()),
})
export type TransactionRequest = z.output<typeof transactionRequest>

export const eth_accounts = Schema.defineItem({
  method: z.literal('eth_accounts'),
  params: undefined,
  returns: z.readonly(z.array(u.address())),
})
export type eth_accounts = Schema.DefineItem<typeof eth_accounts>

export const eth_chainId = Schema.defineItem({
  method: z.literal('eth_chainId'),
  params: undefined,
  returns: u.hex(),
})
export type eth_chainId = Schema.DefineItem<typeof eth_chainId>

export const eth_requestAccounts = Schema.defineItem({
  method: z.literal('eth_requestAccounts'),
  params: undefined,
  returns: z.readonly(z.array(u.address())),
})
export type eth_requestAccounts = Schema.DefineItem<typeof eth_requestAccounts>

export const eth_sendTransaction = Schema.defineItem({
  method: z.literal('eth_sendTransaction'),
  params: z.readonly(z.tuple([transactionRequest])),
  returns: u.hex(),
})
export type eth_sendTransaction = Schema.DefineItem<typeof eth_sendTransaction>

export const eth_sendTransactionSync = Schema.defineItem({
  method: z.literal('eth_sendTransactionSync'),
  params: z.readonly(z.tuple([transactionRequest])),
  returns: receipt,
})
export type eth_sendTransactionSync = Schema.DefineItem<typeof eth_sendTransactionSync>
export namespace eth_sendTransactionSync {
  export type decoded = z.output<eth_sendTransactionSync>
}

const sendCallsCapabilities = z.optional(z.object({ sync: z.optional(z.boolean()) }))

export const wallet_sendCalls = Schema.defineItem({
  method: z.literal('wallet_sendCalls'),
  params: z.optional(
    z.readonly(
      z.tuple([
        z.object({
          atomicRequired: z.optional(z.boolean()),
          calls: z.readonly(z.array(call)),
          capabilities: sendCallsCapabilities,
          chainId: z.optional(u.hex()),
          from: z.optional(u.address()),
          version: z.optional(z.string()),
        }),
      ]),
    ),
  ),
  returns: z.object({
    capabilities: sendCallsCapabilities,
    id: z.string(),
  }),
})
export type wallet_sendCalls = Schema.DefineItem<typeof wallet_sendCalls>

export const wallet_connect = Schema.defineItem({
  method: z.literal('wallet_connect'),
  params: z.optional(
    z.readonly(
      z.tuple([
        z.object({
          capabilities: capabilities.connect,
        }),
      ]),
    ),
  ),
  returns: z.readonly(z.array(u.address())),
})
export type wallet_connect = Schema.DefineItem<typeof wallet_connect>

export const wallet_disconnect = Schema.defineItem({
  method: z.literal('wallet_disconnect'),
  params: undefined,
  returns: undefined,
})
export type wallet_disconnect = Schema.DefineItem<typeof wallet_disconnect>

export const wallet_switchEthereumChain = Schema.defineItem({
  method: z.literal('wallet_switchEthereumChain'),
  params: z.readonly(z.tuple([z.object({ chainId: u.number() })])),
  returns: undefined,
})
export type wallet_switchEthereumChain = Schema.DefineItem<typeof wallet_switchEthereumChain>
