import * as z from 'zod/mini'

import * as Schema from '../Schema.js'
import * as u from './utils.js'

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

export namespace eth_accounts {
  export const schema = Schema.defineItem({
    method: z.literal('eth_accounts'),
    params: undefined,
    returns: z.readonly(z.array(u.address())),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace eth_chainId {
  export const schema = Schema.defineItem({
    method: z.literal('eth_chainId'),
    params: undefined,
    returns: u.hex(),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace eth_requestAccounts {
  export const schema = Schema.defineItem({
    method: z.literal('eth_requestAccounts'),
    params: undefined,
    returns: z.readonly(z.array(u.address())),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace eth_sendTransaction {
  export const schema = Schema.defineItem({
    method: z.literal('eth_sendTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: u.hex(),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace eth_signTransaction {
  export const schema = Schema.defineItem({
    method: z.literal('eth_signTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: u.hex(),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace eth_sendTransactionSync {
  export const schema = Schema.defineItem({
    method: z.literal('eth_sendTransactionSync'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: receipt,
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace eth_signTypedData_v4 {
  export const schema = Schema.defineItem({
    method: z.literal('eth_signTypedData_v4'),
    params: z.readonly(z.tuple([u.address(), z.string()])),
    returns: u.hex(),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace personal_sign {
  export const schema = Schema.defineItem({
    method: z.literal('personal_sign'),
    params: z.readonly(z.tuple([u.hex(), u.address()])),
    returns: u.hex(),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

const sendCallsCapabilities = z.optional(z.object({ sync: z.optional(z.boolean()) }))

export namespace wallet_sendCalls {
  export const schema = Schema.defineItem({
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
      atomic: z.optional(z.boolean()),
      capabilities: sendCallsCapabilities,
      chainId: z.optional(z.number()),
      id: z.string(),
      receipts: z.optional(z.array(receipt)),
      status: z.optional(z.number()),
      version: z.optional(z.string()),
    }),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace wallet_getBalances {
  export const schema = Schema.defineItem({
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
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace wallet_getCapabilities {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_getCapabilities'),
    params: z.optional(
      z.readonly(
        z.union([z.tuple([u.address()]), z.tuple([u.address(), z.readonly(z.array(u.hex()))])]),
      ),
    ),
    returns: z.record(
      u.hex(),
      z.object({
        atomic: z.object({
          status: z.union([z.literal('supported'), z.literal('ready'), z.literal('unsupported')]),
        }),
      }),
    ),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace wallet_connect {
  export const capabilities = {
    request: z.optional(
      z.union([
        z.object({
          digest: z.optional(u.hex()),
          method: z.literal('register'),
          name: z.optional(z.string()),
          userId: z.optional(z.string()),
        }),
        z.object({
          digest: z.optional(u.hex()),
          credentialId: z.optional(z.string()),
          method: z.optional(z.literal('login')),
          selectAccount: z.optional(z.boolean()),
        }),
      ]),
    ),
    result: z.object({ signature: z.optional(u.hex()) }),
  }

  export const schema = Schema.defineItem({
    method: z.literal('wallet_connect'),
    params: z.optional(
      z.readonly(
        z.tuple([
          z.object({
            capabilities: capabilities.request,
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
            capabilities: capabilities.result,
          }),
        ),
      ),
    }),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace wallet_disconnect {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_disconnect'),
    params: undefined,
    returns: undefined,
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace wallet_getCallsStatus {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_getCallsStatus'),
    params: z.optional(z.readonly(z.tuple([z.string()]))),
    returns: z.object({
      atomic: z.boolean(),
      chainId: z.number(),
      id: z.string(),
      receipts: z.optional(z.array(receipt)),
      status: z.number(),
      version: z.string(),
    }),
  })
  export type Schema = Schema.DefineItem<typeof schema>
}

export namespace wallet_switchEthereumChain {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_switchEthereumChain'),
    params: z.readonly(z.tuple([z.object({ chainId: u.number() })])),
    returns: undefined,
  })
  export type Schema = Schema.DefineItem<typeof schema>
}
