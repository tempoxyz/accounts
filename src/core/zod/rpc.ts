import type { SignatureEnvelope } from 'ox/tempo'
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

export const signatureEnvelope = z.custom<SignatureEnvelope.SignatureEnvelopeRpc>()

export const keyType = z.union([z.literal('secp256k1'), z.literal('p256'), z.literal('webAuthn')])

export const keyAuthorization = z.object({
  address: u.address(),
  chainId: u.bigint(),
  expiry: z.union([u.number(), z.null(), z.undefined()]),
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

export namespace eth_accounts {
  export const schema = Schema.defineItem({
    method: z.literal('eth_accounts'),
    params: undefined,
    returns: z.readonly(z.array(u.address())),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_chainId {
  export const schema = Schema.defineItem({
    method: z.literal('eth_chainId'),
    params: undefined,
    returns: u.hex(),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_requestAccounts {
  export const schema = Schema.defineItem({
    method: z.literal('eth_requestAccounts'),
    params: undefined,
    returns: z.readonly(z.array(u.address())),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_sendTransaction {
  export const schema = Schema.defineItem({
    method: z.literal('eth_sendTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: u.hex(),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_fillTransaction {
  const balanceDiff = z.object({
    address: u.address(),
    decimals: z.number(),
    direction: z.enum(['incoming', 'outgoing']),
    formatted: z.string(),
    name: z.string(),
    recipients: z.readonly(z.array(u.address())),
    symbol: z.string(),
    value: u.hex(),
  })

  const swapAmount = z.object({
    decimals: z.number(),
    formatted: z.string(),
    name: z.string(),
    symbol: z.string(),
    token: u.address(),
    value: u.hex(),
  })

  export const schema = Schema.defineItem({
    method: z.literal('eth_fillTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: z.object({
      capabilities: z.object({
        balanceDiffs: z.optional(z.record(u.address(), z.readonly(z.array(balanceDiff)))),
        error: z.optional(
          z.object({
            abiItem: z.optional(z.record(z.string(), z.unknown())),
            data: z.optional(u.hex()),
            errorName: z.string(),
            message: z.string(),
          }),
        ),
        fee: z.optional(
          z.object({
            amount: u.hex(),
            decimals: z.number(),
            formatted: z.string(),
            symbol: z.string(),
          }),
        ),
        requireFunds: z.optional(
          z.object({
            amount: u.hex(),
            decimals: z.number(),
            formatted: z.string(),
            token: u.address(),
            symbol: z.string(),
          }),
        ),
        autoSwap: z.optional(
          z.object({
            maxIn: swapAmount,
            minOut: swapAmount,
            slippage: z.number(),
          }),
        ),
        sponsor: z.optional(
          z.object({
            address: u.address(),
            name: z.optional(z.string()),
            url: z.optional(z.string()),
          }),
        ),
        sponsored: z.boolean(),
      }),
      tx: z.record(z.string(), z.unknown()),
    }),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_signTransaction {
  export const schema = Schema.defineItem({
    method: z.literal('eth_signTransaction'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: u.hex(),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_sendTransactionSync {
  export const schema = Schema.defineItem({
    method: z.literal('eth_sendTransactionSync'),
    params: z.readonly(z.tuple([transactionRequest])),
    returns: receipt,
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace eth_signTypedData_v4 {
  export const schema = Schema.defineItem({
    method: z.literal('eth_signTypedData_v4'),
    params: z.readonly(z.tuple([u.address(), z.string()])),
    returns: u.hex(),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace personal_sign {
  export const schema = Schema.defineItem({
    method: z.literal('personal_sign'),
    params: z.readonly(z.tuple([u.hex(), u.address()])),
    returns: u.hex(),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

const sendCallsCapabilities = z.optional(
  z.object({
    feePayer: z.optional(z.union([z.boolean(), z.string()])),
    sync: z.optional(z.boolean()),
  }),
)

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
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
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
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
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
        accessKeys: z.optional(
          z.object({
            status: z.union([z.literal('supported'), z.literal('unsupported')]),
          }),
        ),
        atomic: z.object({
          status: z.union([z.literal('supported'), z.literal('ready'), z.literal('unsupported')]),
        }),
        feePayer: z.optional(
          z.object({
            status: z.union([z.literal('supported'), z.literal('unsupported')]),
          }),
        ),
      }),
    ),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_authorizeAccessKey {
  export const parameters = z.object({
    address: z.optional(u.address()),
    expiry: z.number(),
    keyType: z.optional(keyType),
    limits: z.optional(
      z.readonly(
        z.array(
          z.object({ token: u.address(), limit: u.bigint(), period: z.optional(z.number()) }),
        ),
      ),
    ),
    publicKey: z.optional(u.hex()),
    scopes: z.optional(
      z.readonly(
        z.array(
          z.object({
            address: u.address(),
            selector: z.optional(z.union([u.hex(), z.string()])),
            recipients: z.optional(z.readonly(z.array(u.address()))),
          }),
        ),
      ),
    ),
  })

  const returns = z.object({
    keyAuthorization,
    rootAddress: u.address(),
  })

  export const schema = Schema.defineItem({
    method: z.literal('wallet_authorizeAccessKey'),
    params: z.readonly(z.tuple([parameters])),
    returns,
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_authorizeAccessKey_strict {
  export const parameters = z.object({
    address: z.optional(u.address()),
    expiry: z.number(),
    keyType: z.optional(keyType),
    limits: z.readonly(
      z.array(z.object({ token: u.address(), limit: u.bigint(), period: z.optional(z.number()) })),
    ),
    publicKey: z.optional(u.hex()),
    scopes: z.optional(
      z.readonly(
        z.array(
          z.object({
            address: u.address(),
            selector: z.optional(z.union([u.hex(), z.string()])),
            recipients: z.optional(z.readonly(z.array(u.address()))),
          }),
        ),
      ),
    ),
  })
}

export namespace wallet_revokeAccessKey {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_revokeAccessKey'),
    params: z.readonly(
      z.tuple([z.object({ address: u.address(), accessKeyAddress: u.address() })]),
    ),
    returns: undefined,
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_connect {
  export const authorizeAccessKey = z.optional(wallet_authorizeAccessKey.parameters)

  export const capabilities = {
    request: z.optional(
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
    result: z.object({
      keyAuthorization: z.optional(keyAuthorization),
      signature: z.optional(u.hex()),
    }),
  }

  export const schema = Schema.defineItem({
    method: z.literal('wallet_connect'),
    params: z.optional(
      z.readonly(
        z.tuple([
          z.object({
            capabilities: capabilities.request,
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
            capabilities: capabilities.result,
          }),
        ),
      ),
    }),
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_connect_strict {
  const authorizeAccessKey = z.optional(wallet_authorizeAccessKey_strict.parameters)

  export const parameters = z.object({
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
}

export namespace wallet_disconnect {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_disconnect'),
    params: undefined,
    returns: undefined,
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_getCallsStatus {
  export const schema = Schema.defineItem({
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
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_switchEthereumChain {
  export const schema = Schema.defineItem({
    method: z.literal('wallet_switchEthereumChain'),
    params: z.readonly(z.tuple([z.object({ chainId: u.number() })])),
    returns: undefined,
  })
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

export namespace wallet_deposit {
  export const schema = Schema.defineItem({
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
  export type Encoded = Schema.Encoded<typeof schema>
  export type Decoded = Schema.Decoded<typeof schema>
}

/** Strict parameter schemas keyed by method name. */
export const strictParameters = {
  wallet_authorizeAccessKey: wallet_authorizeAccessKey_strict.parameters,
  wallet_connect: wallet_connect_strict.parameters,
} satisfies Partial<Record<string, z.ZodMiniType>>
