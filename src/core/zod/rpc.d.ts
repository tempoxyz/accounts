import type { SignatureEnvelope } from 'ox/tempo'
import * as z from 'zod/mini'

import * as Schema from '../internal/schema.js'
export declare const log: z.ZodMiniObject<
  {
    address: z.ZodMiniTemplateLiteral<`0x${string}`>
    blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
    blockNumber: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    data: z.ZodMiniTemplateLiteral<`0x${string}`>
    logIndex: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
    removed: z.ZodMiniBoolean<boolean>
    topics: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
    transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
    transactionIndex: z.ZodMiniCodec<
      z.ZodMiniTemplateLiteral<`0x${string}`>,
      z.ZodMiniNumber<number>
    >
  },
  z.core.$strip
>
export declare const receipt: z.ZodMiniObject<
  {
    blobGasPrice: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    blobGasUsed: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
    blockNumber: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    contractAddress: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
    cumulativeGasUsed: z.ZodMiniCodec<
      z.ZodMiniTemplateLiteral<`0x${string}`>,
      z.ZodMiniBigInt<bigint>
    >
    effectiveGasPrice: z.ZodMiniCodec<
      z.ZodMiniTemplateLiteral<`0x${string}`>,
      z.ZodMiniBigInt<bigint>
    >
    feePayer: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    from: z.ZodMiniTemplateLiteral<`0x${string}`>
    gasUsed: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    logs: z.ZodMiniArray<
      z.ZodMiniObject<
        {
          address: z.ZodMiniTemplateLiteral<`0x${string}`>
          blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
          blockNumber: z.ZodMiniCodec<
            z.ZodMiniTemplateLiteral<`0x${string}`>,
            z.ZodMiniBigInt<bigint>
          >
          data: z.ZodMiniTemplateLiteral<`0x${string}`>
          logIndex: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
          removed: z.ZodMiniBoolean<boolean>
          topics: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
          transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
          transactionIndex: z.ZodMiniCodec<
            z.ZodMiniTemplateLiteral<`0x${string}`>,
            z.ZodMiniNumber<number>
          >
        },
        z.core.$strip
      >
    >
    logsBloom: z.ZodMiniTemplateLiteral<`0x${string}`>
    root: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    status: z.ZodMiniCodec<
      z.ZodMiniTemplateLiteral<`0x${string}`>,
      z.ZodMiniEnum<{
        success: 'success'
        reverted: 'reverted'
      }>
    >
    to: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
    transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
    transactionIndex: z.ZodMiniCodec<
      z.ZodMiniTemplateLiteral<`0x${string}`>,
      z.ZodMiniNumber<number>
    >
    type: z.ZodMiniTemplateLiteral<`0x${string}`>
  },
  z.core.$strip
>
export declare const signatureEnvelope: z.ZodMiniCustom<
  SignatureEnvelope.SignatureEnvelopeRpc,
  SignatureEnvelope.SignatureEnvelopeRpc
>
export declare const keyType: z.ZodMiniUnion<
  readonly [z.ZodMiniLiteral<'secp256k1'>, z.ZodMiniLiteral<'p256'>, z.ZodMiniLiteral<'webAuthn'>]
>
export declare const keyAuthorization: z.ZodMiniObject<
  {
    address: z.ZodMiniTemplateLiteral<`0x${string}`>
    chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    expiry: z.ZodMiniOptional<
      z.ZodMiniNullable<
        z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
      >
    >
    keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
    keyType: z.ZodMiniUnion<
      readonly [
        z.ZodMiniLiteral<'secp256k1'>,
        z.ZodMiniLiteral<'p256'>,
        z.ZodMiniLiteral<'webAuthn'>,
      ]
    >
    limits: z.ZodMiniOptional<
      z.ZodMiniReadonly<
        z.ZodMiniArray<
          z.ZodMiniObject<
            {
              token: z.ZodMiniTemplateLiteral<`0x${string}`>
              limit: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniBigInt<bigint>
              >
            },
            z.core.$strip
          >
        >
      >
    >
    signature: z.ZodMiniCustom<
      SignatureEnvelope.SignatureEnvelopeRpc,
      SignatureEnvelope.SignatureEnvelopeRpc
    >
  },
  z.core.$strip
>
export declare const call: z.ZodMiniObject<
  {
    data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    value: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
  },
  z.core.$strip
>
export declare const transactionRequest: z.ZodMiniObject<
  {
    accessList: z.ZodMiniOptional<
      z.ZodMiniArray<
        z.ZodMiniObject<
          {
            address: z.ZodMiniTemplateLiteral<`0x${string}`>
            storageKeys: z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
          },
          z.core.$strip
        >
      >
    >
    calls: z.ZodMiniOptional<
      z.ZodMiniReadonly<
        z.ZodMiniArray<
          z.ZodMiniObject<
            {
              data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              value: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
            },
            z.core.$strip
          >
        >
      >
    >
    chainId: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
    >
    data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    feePayer: z.ZodMiniOptional<
      z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniString<string>]>
    >
    feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    from: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    gas: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    keyAuthorization: z.ZodMiniOptional<
      z.ZodMiniObject<
        {
          address: z.ZodMiniTemplateLiteral<`0x${string}`>
          chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
          expiry: z.ZodMiniOptional<
            z.ZodMiniNullable<
              z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
            >
          >
          keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
          keyType: z.ZodMiniUnion<
            readonly [
              z.ZodMiniLiteral<'secp256k1'>,
              z.ZodMiniLiteral<'p256'>,
              z.ZodMiniLiteral<'webAuthn'>,
            ]
          >
          limits: z.ZodMiniOptional<
            z.ZodMiniReadonly<
              z.ZodMiniArray<
                z.ZodMiniObject<
                  {
                    token: z.ZodMiniTemplateLiteral<`0x${string}`>
                    limit: z.ZodMiniCodec<
                      z.ZodMiniTemplateLiteral<`0x${string}`>,
                      z.ZodMiniBigInt<bigint>
                    >
                  },
                  z.core.$strip
                >
              >
            >
          >
          signature: z.ZodMiniCustom<
            SignatureEnvelope.SignatureEnvelopeRpc,
            SignatureEnvelope.SignatureEnvelopeRpc
          >
        },
        z.core.$strip
      >
    >
    maxFeePerGas: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    maxPriorityFeePerGas: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    nonce: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
    >
    nonceKey: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    validAfter: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
    >
    validBefore: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
    >
    value: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
  },
  z.core.$strip
>
export declare namespace eth_accounts {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_accounts'>
    readonly params: undefined
    readonly returns: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_chainId {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_chainId'>
    readonly params: undefined
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_requestAccounts {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_requestAccounts'>
    readonly params: undefined
    readonly returns: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_sendTransaction {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_sendTransaction'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              accessList: z.ZodMiniOptional<
                z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniTemplateLiteral<`0x${string}`>
                      storageKeys: z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
              >
              calls: z.ZodMiniOptional<
                z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        value: z.ZodMiniOptional<
                          z.ZodMiniCodec<
                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                            z.ZodMiniBigInt<bigint>
                          >
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
              >
              chainId: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              feePayer: z.ZodMiniOptional<
                z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniString<string>]>
              >
              feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              from: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              gas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              keyAuthorization: z.ZodMiniOptional<
                z.ZodMiniObject<
                  {
                    address: z.ZodMiniTemplateLiteral<`0x${string}`>
                    chainId: z.ZodMiniCodec<
                      z.ZodMiniTemplateLiteral<`0x${string}`>,
                      z.ZodMiniBigInt<bigint>
                    >
                    expiry: z.ZodMiniOptional<
                      z.ZodMiniNullable<
                        z.ZodMiniCodec<
                          z.ZodMiniTemplateLiteral<`0x${string}`>,
                          z.ZodMiniNumber<number>
                        >
                      >
                    >
                    keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
                    keyType: z.ZodMiniUnion<
                      readonly [
                        z.ZodMiniLiteral<'secp256k1'>,
                        z.ZodMiniLiteral<'p256'>,
                        z.ZodMiniLiteral<'webAuthn'>,
                      ]
                    >
                    limits: z.ZodMiniOptional<
                      z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >
                    signature: z.ZodMiniCustom<
                      SignatureEnvelope.SignatureEnvelopeRpc,
                      SignatureEnvelope.SignatureEnvelopeRpc
                    >
                  },
                  z.core.$strip
                >
              >
              maxFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              maxPriorityFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              nonce: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              nonceKey: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              validAfter: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              validBefore: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              value: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_fillTransaction {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_fillTransaction'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              accessList: z.ZodMiniOptional<
                z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniTemplateLiteral<`0x${string}`>
                      storageKeys: z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
              >
              calls: z.ZodMiniOptional<
                z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        value: z.ZodMiniOptional<
                          z.ZodMiniCodec<
                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                            z.ZodMiniBigInt<bigint>
                          >
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
              >
              chainId: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              feePayer: z.ZodMiniOptional<
                z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniString<string>]>
              >
              feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              from: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              gas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              keyAuthorization: z.ZodMiniOptional<
                z.ZodMiniObject<
                  {
                    address: z.ZodMiniTemplateLiteral<`0x${string}`>
                    chainId: z.ZodMiniCodec<
                      z.ZodMiniTemplateLiteral<`0x${string}`>,
                      z.ZodMiniBigInt<bigint>
                    >
                    expiry: z.ZodMiniOptional<
                      z.ZodMiniNullable<
                        z.ZodMiniCodec<
                          z.ZodMiniTemplateLiteral<`0x${string}`>,
                          z.ZodMiniNumber<number>
                        >
                      >
                    >
                    keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
                    keyType: z.ZodMiniUnion<
                      readonly [
                        z.ZodMiniLiteral<'secp256k1'>,
                        z.ZodMiniLiteral<'p256'>,
                        z.ZodMiniLiteral<'webAuthn'>,
                      ]
                    >
                    limits: z.ZodMiniOptional<
                      z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >
                    signature: z.ZodMiniCustom<
                      SignatureEnvelope.SignatureEnvelopeRpc,
                      SignatureEnvelope.SignatureEnvelopeRpc
                    >
                  },
                  z.core.$strip
                >
              >
              maxFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              maxPriorityFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              nonce: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              nonceKey: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              validAfter: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              validBefore: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              value: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: z.ZodMiniAny
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_signTransaction {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_signTransaction'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              accessList: z.ZodMiniOptional<
                z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniTemplateLiteral<`0x${string}`>
                      storageKeys: z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
              >
              calls: z.ZodMiniOptional<
                z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        value: z.ZodMiniOptional<
                          z.ZodMiniCodec<
                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                            z.ZodMiniBigInt<bigint>
                          >
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
              >
              chainId: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              feePayer: z.ZodMiniOptional<
                z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniString<string>]>
              >
              feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              from: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              gas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              keyAuthorization: z.ZodMiniOptional<
                z.ZodMiniObject<
                  {
                    address: z.ZodMiniTemplateLiteral<`0x${string}`>
                    chainId: z.ZodMiniCodec<
                      z.ZodMiniTemplateLiteral<`0x${string}`>,
                      z.ZodMiniBigInt<bigint>
                    >
                    expiry: z.ZodMiniOptional<
                      z.ZodMiniNullable<
                        z.ZodMiniCodec<
                          z.ZodMiniTemplateLiteral<`0x${string}`>,
                          z.ZodMiniNumber<number>
                        >
                      >
                    >
                    keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
                    keyType: z.ZodMiniUnion<
                      readonly [
                        z.ZodMiniLiteral<'secp256k1'>,
                        z.ZodMiniLiteral<'p256'>,
                        z.ZodMiniLiteral<'webAuthn'>,
                      ]
                    >
                    limits: z.ZodMiniOptional<
                      z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >
                    signature: z.ZodMiniCustom<
                      SignatureEnvelope.SignatureEnvelopeRpc,
                      SignatureEnvelope.SignatureEnvelopeRpc
                    >
                  },
                  z.core.$strip
                >
              >
              maxFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              maxPriorityFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              nonce: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              nonceKey: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              validAfter: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              validBefore: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              value: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_sendTransactionSync {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_sendTransactionSync'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              accessList: z.ZodMiniOptional<
                z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniTemplateLiteral<`0x${string}`>
                      storageKeys: z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
              >
              calls: z.ZodMiniOptional<
                z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        value: z.ZodMiniOptional<
                          z.ZodMiniCodec<
                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                            z.ZodMiniBigInt<bigint>
                          >
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
              >
              chainId: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              feePayer: z.ZodMiniOptional<
                z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniString<string>]>
              >
              feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              from: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              gas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              keyAuthorization: z.ZodMiniOptional<
                z.ZodMiniObject<
                  {
                    address: z.ZodMiniTemplateLiteral<`0x${string}`>
                    chainId: z.ZodMiniCodec<
                      z.ZodMiniTemplateLiteral<`0x${string}`>,
                      z.ZodMiniBigInt<bigint>
                    >
                    expiry: z.ZodMiniOptional<
                      z.ZodMiniNullable<
                        z.ZodMiniCodec<
                          z.ZodMiniTemplateLiteral<`0x${string}`>,
                          z.ZodMiniNumber<number>
                        >
                      >
                    >
                    keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
                    keyType: z.ZodMiniUnion<
                      readonly [
                        z.ZodMiniLiteral<'secp256k1'>,
                        z.ZodMiniLiteral<'p256'>,
                        z.ZodMiniLiteral<'webAuthn'>,
                      ]
                    >
                    limits: z.ZodMiniOptional<
                      z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >
                    signature: z.ZodMiniCustom<
                      SignatureEnvelope.SignatureEnvelopeRpc,
                      SignatureEnvelope.SignatureEnvelopeRpc
                    >
                  },
                  z.core.$strip
                >
              >
              maxFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              maxPriorityFeePerGas: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              nonce: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              nonceKey: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
              to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              validAfter: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              validBefore: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              value: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
              >
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: z.ZodMiniObject<
      {
        blobGasPrice: z.ZodMiniOptional<
          z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
        >
        blobGasUsed: z.ZodMiniOptional<
          z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
        >
        blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
        blockNumber: z.ZodMiniCodec<
          z.ZodMiniTemplateLiteral<`0x${string}`>,
          z.ZodMiniBigInt<bigint>
        >
        contractAddress: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
        cumulativeGasUsed: z.ZodMiniCodec<
          z.ZodMiniTemplateLiteral<`0x${string}`>,
          z.ZodMiniBigInt<bigint>
        >
        effectiveGasPrice: z.ZodMiniCodec<
          z.ZodMiniTemplateLiteral<`0x${string}`>,
          z.ZodMiniBigInt<bigint>
        >
        feePayer: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
        feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
        from: z.ZodMiniTemplateLiteral<`0x${string}`>
        gasUsed: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
        logs: z.ZodMiniArray<
          z.ZodMiniObject<
            {
              address: z.ZodMiniTemplateLiteral<`0x${string}`>
              blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
              blockNumber: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniBigInt<bigint>
              >
              data: z.ZodMiniTemplateLiteral<`0x${string}`>
              logIndex: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniNumber<number>
              >
              removed: z.ZodMiniBoolean<boolean>
              topics: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
              transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
              transactionIndex: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniNumber<number>
              >
            },
            z.core.$strip
          >
        >
        logsBloom: z.ZodMiniTemplateLiteral<`0x${string}`>
        root: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
        status: z.ZodMiniCodec<
          z.ZodMiniTemplateLiteral<`0x${string}`>,
          z.ZodMiniEnum<{
            success: 'success'
            reverted: 'reverted'
          }>
        >
        to: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
        transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
        transactionIndex: z.ZodMiniCodec<
          z.ZodMiniTemplateLiteral<`0x${string}`>,
          z.ZodMiniNumber<number>
        >
        type: z.ZodMiniTemplateLiteral<`0x${string}`>
      },
      z.core.$strip
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace eth_signTypedData_v4 {
  const schema: {
    readonly method: z.ZodMiniLiteral<'eth_signTypedData_v4'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniString<string>],
        null
      >
    >
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace personal_sign {
  const schema: {
    readonly method: z.ZodMiniLiteral<'personal_sign'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniTemplateLiteral<`0x${string}`>],
        null
      >
    >
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_sendCalls {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_sendCalls'>
    readonly params: z.ZodMiniOptional<
      z.ZodMiniReadonly<
        z.ZodMiniTuple<
          readonly [
            z.ZodMiniObject<
              {
                atomicRequired: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
                calls: z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        data: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        to: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                        value: z.ZodMiniOptional<
                          z.ZodMiniCodec<
                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                            z.ZodMiniBigInt<bigint>
                          >
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
                capabilities: z.ZodMiniOptional<
                  z.ZodMiniObject<
                    {
                      sync: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
                    },
                    z.core.$strip
                  >
                >
                chainId: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
                >
                from: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                version: z.ZodMiniOptional<z.ZodMiniString<string>>
              },
              z.core.$strip
            >,
          ],
          null
        >
      >
    >
    readonly returns: z.ZodMiniObject<
      {
        atomic: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
        capabilities: z.ZodMiniOptional<
          z.ZodMiniObject<
            {
              sync: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
            },
            z.core.$strip
          >
        >
        chainId: z.ZodMiniOptional<
          z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
        >
        id: z.ZodMiniString<string>
        receipts: z.ZodMiniOptional<
          z.ZodMiniArray<
            z.ZodMiniObject<
              {
                blobGasPrice: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
                >
                blobGasUsed: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
                >
                blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                blockNumber: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                contractAddress: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
                cumulativeGasUsed: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                effectiveGasPrice: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                feePayer: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                from: z.ZodMiniTemplateLiteral<`0x${string}`>
                gasUsed: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                logs: z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniTemplateLiteral<`0x${string}`>
                      blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                      blockNumber: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniBigInt<bigint>
                      >
                      data: z.ZodMiniTemplateLiteral<`0x${string}`>
                      logIndex: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniNumber<number>
                      >
                      removed: z.ZodMiniBoolean<boolean>
                      topics: z.ZodMiniReadonly<
                        z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
                      >
                      transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                      transactionIndex: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniNumber<number>
                      >
                    },
                    z.core.$strip
                  >
                >
                logsBloom: z.ZodMiniTemplateLiteral<`0x${string}`>
                root: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                status: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniEnum<{
                    success: 'success'
                    reverted: 'reverted'
                  }>
                >
                to: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
                transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                transactionIndex: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniNumber<number>
                >
                type: z.ZodMiniTemplateLiteral<`0x${string}`>
              },
              z.core.$strip
            >
          >
        >
        status: z.ZodMiniOptional<z.ZodMiniNumber<number>>
        version: z.ZodMiniOptional<z.ZodMiniString<string>>
      },
      z.core.$strip
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_getBalances {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_getBalances'>
    readonly params: z.ZodMiniOptional<
      z.ZodMiniReadonly<
        z.ZodMiniTuple<
          readonly [
            z.ZodMiniObject<
              {
                account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                chainId: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
                >
                tokens: z.ZodMiniOptional<
                  z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
                >
              },
              z.core.$strip
            >,
          ],
          null
        >
      >
    >
    readonly returns: z.ZodMiniReadonly<
      z.ZodMiniArray<
        z.ZodMiniObject<
          {
            address: z.ZodMiniTemplateLiteral<`0x${string}`>
            balance: z.ZodMiniCodec<
              z.ZodMiniTemplateLiteral<`0x${string}`>,
              z.ZodMiniBigInt<bigint>
            >
            decimals: z.ZodMiniNumber<number>
            display: z.ZodMiniString<string>
            name: z.ZodMiniString<string>
            symbol: z.ZodMiniString<string>
          },
          z.core.$strip
        >
      >
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_getCapabilities {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_getCapabilities'>
    readonly params: z.ZodMiniOptional<
      z.ZodMiniReadonly<
        z.ZodMiniUnion<
          readonly [
            z.ZodMiniTuple<readonly [z.ZodMiniTemplateLiteral<`0x${string}`>], null>,
            z.ZodMiniTuple<
              readonly [
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>,
              ],
              null
            >,
          ]
        >
      >
    >
    readonly returns: z.ZodMiniRecord<
      z.ZodMiniTemplateLiteral<`0x${string}`>,
      z.ZodMiniObject<
        {
          accessKeys: z.ZodMiniOptional<
            z.ZodMiniObject<
              {
                status: z.ZodMiniUnion<
                  readonly [z.ZodMiniLiteral<'supported'>, z.ZodMiniLiteral<'unsupported'>]
                >
              },
              z.core.$strip
            >
          >
          atomic: z.ZodMiniObject<
            {
              status: z.ZodMiniUnion<
                readonly [
                  z.ZodMiniLiteral<'supported'>,
                  z.ZodMiniLiteral<'ready'>,
                  z.ZodMiniLiteral<'unsupported'>,
                ]
              >
            },
            z.core.$strip
          >
        },
        z.core.$strip
      >
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_authorizeAccessKey {
  const parameters: z.ZodMiniObject<
    {
      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
      expiry: z.ZodMiniNumber<number>
      keyType: z.ZodMiniOptional<
        z.ZodMiniUnion<
          readonly [
            z.ZodMiniLiteral<'secp256k1'>,
            z.ZodMiniLiteral<'p256'>,
            z.ZodMiniLiteral<'webAuthn'>,
          ]
        >
      >
      limits: z.ZodMiniOptional<
        z.ZodMiniReadonly<
          z.ZodMiniArray<
            z.ZodMiniObject<
              {
                token: z.ZodMiniTemplateLiteral<`0x${string}`>
                limit: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
              },
              z.core.$strip
            >
          >
        >
      >
      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    },
    z.core.$strip
  >
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_authorizeAccessKey'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              expiry: z.ZodMiniNumber<number>
              keyType: z.ZodMiniOptional<
                z.ZodMiniUnion<
                  readonly [
                    z.ZodMiniLiteral<'secp256k1'>,
                    z.ZodMiniLiteral<'p256'>,
                    z.ZodMiniLiteral<'webAuthn'>,
                  ]
                >
              >
              limits: z.ZodMiniOptional<
                z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        token: z.ZodMiniTemplateLiteral<`0x${string}`>
                        limit: z.ZodMiniCodec<
                          z.ZodMiniTemplateLiteral<`0x${string}`>,
                          z.ZodMiniBigInt<bigint>
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
              >
              publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: z.ZodMiniObject<
      {
        keyAuthorization: z.ZodMiniObject<
          {
            address: z.ZodMiniTemplateLiteral<`0x${string}`>
            chainId: z.ZodMiniCodec<
              z.ZodMiniTemplateLiteral<`0x${string}`>,
              z.ZodMiniBigInt<bigint>
            >
            expiry: z.ZodMiniOptional<
              z.ZodMiniNullable<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
            >
            keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
            keyType: z.ZodMiniUnion<
              readonly [
                z.ZodMiniLiteral<'secp256k1'>,
                z.ZodMiniLiteral<'p256'>,
                z.ZodMiniLiteral<'webAuthn'>,
              ]
            >
            limits: z.ZodMiniOptional<
              z.ZodMiniReadonly<
                z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      token: z.ZodMiniTemplateLiteral<`0x${string}`>
                      limit: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniBigInt<bigint>
                      >
                    },
                    z.core.$strip
                  >
                >
              >
            >
            signature: z.ZodMiniCustom<
              SignatureEnvelope.SignatureEnvelopeRpc,
              SignatureEnvelope.SignatureEnvelopeRpc
            >
          },
          z.core.$strip
        >
        rootAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
      },
      z.core.$strip
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_authorizeAccessKey_strict {
  const parameters: z.ZodMiniObject<
    {
      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
      expiry: z.ZodMiniNumber<number>
      keyType: z.ZodMiniOptional<
        z.ZodMiniUnion<
          readonly [
            z.ZodMiniLiteral<'secp256k1'>,
            z.ZodMiniLiteral<'p256'>,
            z.ZodMiniLiteral<'webAuthn'>,
          ]
        >
      >
      limits: z.ZodMiniReadonly<
        z.ZodMiniArray<
          z.ZodMiniObject<
            {
              token: z.ZodMiniTemplateLiteral<`0x${string}`>
              limit: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniBigInt<bigint>
              >
            },
            z.core.$strip
          >
        >
      >
      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    },
    z.core.$strip
  >
}
export declare namespace wallet_revokeAccessKey {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_revokeAccessKey'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              address: z.ZodMiniTemplateLiteral<`0x${string}`>
              accessKeyAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: undefined
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_connect {
  const authorizeAccessKey: z.ZodMiniOptional<
    z.ZodMiniObject<
      {
        address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
        expiry: z.ZodMiniNumber<number>
        keyType: z.ZodMiniOptional<
          z.ZodMiniUnion<
            readonly [
              z.ZodMiniLiteral<'secp256k1'>,
              z.ZodMiniLiteral<'p256'>,
              z.ZodMiniLiteral<'webAuthn'>,
            ]
          >
        >
        limits: z.ZodMiniOptional<
          z.ZodMiniReadonly<
            z.ZodMiniArray<
              z.ZodMiniObject<
                {
                  token: z.ZodMiniTemplateLiteral<`0x${string}`>
                  limit: z.ZodMiniCodec<
                    z.ZodMiniTemplateLiteral<`0x${string}`>,
                    z.ZodMiniBigInt<bigint>
                  >
                },
                z.core.$strip
              >
            >
          >
        >
        publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
      },
      z.core.$strip
    >
  >
  const capabilities: {
    request: z.ZodMiniOptional<
      z.ZodMiniUnion<
        readonly [
          z.ZodMiniObject<
            {
              digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              authorizeAccessKey: z.ZodMiniOptional<
                z.ZodMiniObject<
                  {
                    address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    expiry: z.ZodMiniNumber<number>
                    keyType: z.ZodMiniOptional<
                      z.ZodMiniUnion<
                        readonly [
                          z.ZodMiniLiteral<'secp256k1'>,
                          z.ZodMiniLiteral<'p256'>,
                          z.ZodMiniLiteral<'webAuthn'>,
                        ]
                      >
                    >
                    limits: z.ZodMiniOptional<
                      z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >
                    publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                  },
                  z.core.$strip
                >
              >
              method: z.ZodMiniLiteral<'register'>
              name: z.ZodMiniOptional<z.ZodMiniString<string>>
              userId: z.ZodMiniOptional<z.ZodMiniString<string>>
            },
            z.core.$strip
          >,
          z.ZodMiniObject<
            {
              digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              credentialId: z.ZodMiniOptional<z.ZodMiniString<string>>
              authorizeAccessKey: z.ZodMiniOptional<
                z.ZodMiniObject<
                  {
                    address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    expiry: z.ZodMiniNumber<number>
                    keyType: z.ZodMiniOptional<
                      z.ZodMiniUnion<
                        readonly [
                          z.ZodMiniLiteral<'secp256k1'>,
                          z.ZodMiniLiteral<'p256'>,
                          z.ZodMiniLiteral<'webAuthn'>,
                        ]
                      >
                    >
                    limits: z.ZodMiniOptional<
                      z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >
                    publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                  },
                  z.core.$strip
                >
              >
              method: z.ZodMiniOptional<z.ZodMiniLiteral<'login'>>
              selectAccount: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
            },
            z.core.$strip
          >,
        ]
      >
    >
    result: z.ZodMiniObject<
      {
        keyAuthorization: z.ZodMiniOptional<
          z.ZodMiniObject<
            {
              address: z.ZodMiniTemplateLiteral<`0x${string}`>
              chainId: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniBigInt<bigint>
              >
              expiry: z.ZodMiniOptional<
                z.ZodMiniNullable<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
                >
              >
              keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
              keyType: z.ZodMiniUnion<
                readonly [
                  z.ZodMiniLiteral<'secp256k1'>,
                  z.ZodMiniLiteral<'p256'>,
                  z.ZodMiniLiteral<'webAuthn'>,
                ]
              >
              limits: z.ZodMiniOptional<
                z.ZodMiniReadonly<
                  z.ZodMiniArray<
                    z.ZodMiniObject<
                      {
                        token: z.ZodMiniTemplateLiteral<`0x${string}`>
                        limit: z.ZodMiniCodec<
                          z.ZodMiniTemplateLiteral<`0x${string}`>,
                          z.ZodMiniBigInt<bigint>
                        >
                      },
                      z.core.$strip
                    >
                  >
                >
              >
              signature: z.ZodMiniCustom<
                SignatureEnvelope.SignatureEnvelopeRpc,
                SignatureEnvelope.SignatureEnvelopeRpc
              >
            },
            z.core.$strip
          >
        >
        signature: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
      },
      z.core.$strip
    >
  }
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_connect'>
    readonly params: z.ZodMiniOptional<
      z.ZodMiniReadonly<
        z.ZodMiniTuple<
          readonly [
            z.ZodMiniObject<
              {
                capabilities: z.ZodMiniOptional<
                  z.ZodMiniUnion<
                    readonly [
                      z.ZodMiniObject<
                        {
                          digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                          authorizeAccessKey: z.ZodMiniOptional<
                            z.ZodMiniObject<
                              {
                                address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                                expiry: z.ZodMiniNumber<number>
                                keyType: z.ZodMiniOptional<
                                  z.ZodMiniUnion<
                                    readonly [
                                      z.ZodMiniLiteral<'secp256k1'>,
                                      z.ZodMiniLiteral<'p256'>,
                                      z.ZodMiniLiteral<'webAuthn'>,
                                    ]
                                  >
                                >
                                limits: z.ZodMiniOptional<
                                  z.ZodMiniReadonly<
                                    z.ZodMiniArray<
                                      z.ZodMiniObject<
                                        {
                                          token: z.ZodMiniTemplateLiteral<`0x${string}`>
                                          limit: z.ZodMiniCodec<
                                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                                            z.ZodMiniBigInt<bigint>
                                          >
                                        },
                                        z.core.$strip
                                      >
                                    >
                                  >
                                >
                                publicKey: z.ZodMiniOptional<
                                  z.ZodMiniTemplateLiteral<`0x${string}`>
                                >
                              },
                              z.core.$strip
                            >
                          >
                          method: z.ZodMiniLiteral<'register'>
                          name: z.ZodMiniOptional<z.ZodMiniString<string>>
                          userId: z.ZodMiniOptional<z.ZodMiniString<string>>
                        },
                        z.core.$strip
                      >,
                      z.ZodMiniObject<
                        {
                          digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                          credentialId: z.ZodMiniOptional<z.ZodMiniString<string>>
                          authorizeAccessKey: z.ZodMiniOptional<
                            z.ZodMiniObject<
                              {
                                address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                                expiry: z.ZodMiniNumber<number>
                                keyType: z.ZodMiniOptional<
                                  z.ZodMiniUnion<
                                    readonly [
                                      z.ZodMiniLiteral<'secp256k1'>,
                                      z.ZodMiniLiteral<'p256'>,
                                      z.ZodMiniLiteral<'webAuthn'>,
                                    ]
                                  >
                                >
                                limits: z.ZodMiniOptional<
                                  z.ZodMiniReadonly<
                                    z.ZodMiniArray<
                                      z.ZodMiniObject<
                                        {
                                          token: z.ZodMiniTemplateLiteral<`0x${string}`>
                                          limit: z.ZodMiniCodec<
                                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                                            z.ZodMiniBigInt<bigint>
                                          >
                                        },
                                        z.core.$strip
                                      >
                                    >
                                  >
                                >
                                publicKey: z.ZodMiniOptional<
                                  z.ZodMiniTemplateLiteral<`0x${string}`>
                                >
                              },
                              z.core.$strip
                            >
                          >
                          method: z.ZodMiniOptional<z.ZodMiniLiteral<'login'>>
                          selectAccount: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
                        },
                        z.core.$strip
                      >,
                    ]
                  >
                >
                chainId: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
                >
                version: z.ZodMiniOptional<z.ZodMiniString<string>>
              },
              z.core.$strip
            >,
          ],
          null
        >
      >
    >
    readonly returns: z.ZodMiniObject<
      {
        accounts: z.ZodMiniReadonly<
          z.ZodMiniArray<
            z.ZodMiniObject<
              {
                address: z.ZodMiniTemplateLiteral<`0x${string}`>
                capabilities: z.ZodMiniObject<
                  {
                    keyAuthorization: z.ZodMiniOptional<
                      z.ZodMiniObject<
                        {
                          address: z.ZodMiniTemplateLiteral<`0x${string}`>
                          chainId: z.ZodMiniCodec<
                            z.ZodMiniTemplateLiteral<`0x${string}`>,
                            z.ZodMiniBigInt<bigint>
                          >
                          expiry: z.ZodMiniOptional<
                            z.ZodMiniNullable<
                              z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniNumber<number>
                              >
                            >
                          >
                          keyId: z.ZodMiniTemplateLiteral<`0x${string}`>
                          keyType: z.ZodMiniUnion<
                            readonly [
                              z.ZodMiniLiteral<'secp256k1'>,
                              z.ZodMiniLiteral<'p256'>,
                              z.ZodMiniLiteral<'webAuthn'>,
                            ]
                          >
                          limits: z.ZodMiniOptional<
                            z.ZodMiniReadonly<
                              z.ZodMiniArray<
                                z.ZodMiniObject<
                                  {
                                    token: z.ZodMiniTemplateLiteral<`0x${string}`>
                                    limit: z.ZodMiniCodec<
                                      z.ZodMiniTemplateLiteral<`0x${string}`>,
                                      z.ZodMiniBigInt<bigint>
                                    >
                                  },
                                  z.core.$strip
                                >
                              >
                            >
                          >
                          signature: z.ZodMiniCustom<
                            SignatureEnvelope.SignatureEnvelopeRpc,
                            SignatureEnvelope.SignatureEnvelopeRpc
                          >
                        },
                        z.core.$strip
                      >
                    >
                    signature: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                  },
                  z.core.$strip
                >
              },
              z.core.$strip
            >
          >
        >
      },
      z.core.$strip
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_connect_strict {
  const parameters: z.ZodMiniObject<
    {
      capabilities: z.ZodMiniOptional<
        z.ZodMiniUnion<
          readonly [
            z.ZodMiniObject<
              {
                digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                authorizeAccessKey: z.ZodMiniOptional<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                      expiry: z.ZodMiniNumber<number>
                      keyType: z.ZodMiniOptional<
                        z.ZodMiniUnion<
                          readonly [
                            z.ZodMiniLiteral<'secp256k1'>,
                            z.ZodMiniLiteral<'p256'>,
                            z.ZodMiniLiteral<'webAuthn'>,
                          ]
                        >
                      >
                      limits: z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
                method: z.ZodMiniLiteral<'register'>
                name: z.ZodMiniOptional<z.ZodMiniString<string>>
                userId: z.ZodMiniOptional<z.ZodMiniString<string>>
              },
              z.core.$strip
            >,
            z.ZodMiniObject<
              {
                digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                credentialId: z.ZodMiniOptional<z.ZodMiniString<string>>
                authorizeAccessKey: z.ZodMiniOptional<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                      expiry: z.ZodMiniNumber<number>
                      keyType: z.ZodMiniOptional<
                        z.ZodMiniUnion<
                          readonly [
                            z.ZodMiniLiteral<'secp256k1'>,
                            z.ZodMiniLiteral<'p256'>,
                            z.ZodMiniLiteral<'webAuthn'>,
                          ]
                        >
                      >
                      limits: z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
                method: z.ZodMiniOptional<z.ZodMiniLiteral<'login'>>
                selectAccount: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
              },
              z.core.$strip
            >,
          ]
        >
      >
      chainId: z.ZodMiniOptional<
        z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
      >
      version: z.ZodMiniOptional<z.ZodMiniString<string>>
    },
    z.core.$strip
  >
}
export declare namespace wallet_disconnect {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_disconnect'>
    readonly params: undefined
    readonly returns: undefined
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_getCallsStatus {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_getCallsStatus'>
    readonly params: z.ZodMiniOptional<
      z.ZodMiniReadonly<z.ZodMiniTuple<readonly [z.ZodMiniString<string>], null>>
    >
    readonly returns: z.ZodMiniObject<
      {
        atomic: z.ZodMiniBoolean<boolean>
        chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
        id: z.ZodMiniString<string>
        receipts: z.ZodMiniOptional<
          z.ZodMiniArray<
            z.ZodMiniObject<
              {
                blobGasPrice: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
                >
                blobGasUsed: z.ZodMiniOptional<
                  z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
                >
                blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                blockNumber: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                contractAddress: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
                cumulativeGasUsed: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                effectiveGasPrice: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                feePayer: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                feeToken: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                from: z.ZodMiniTemplateLiteral<`0x${string}`>
                gasUsed: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniBigInt<bigint>
                >
                logs: z.ZodMiniArray<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniTemplateLiteral<`0x${string}`>
                      blockHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                      blockNumber: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniBigInt<bigint>
                      >
                      data: z.ZodMiniTemplateLiteral<`0x${string}`>
                      logIndex: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniNumber<number>
                      >
                      removed: z.ZodMiniBoolean<boolean>
                      topics: z.ZodMiniReadonly<
                        z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>
                      >
                      transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                      transactionIndex: z.ZodMiniCodec<
                        z.ZodMiniTemplateLiteral<`0x${string}`>,
                        z.ZodMiniNumber<number>
                      >
                    },
                    z.core.$strip
                  >
                >
                logsBloom: z.ZodMiniTemplateLiteral<`0x${string}`>
                root: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                status: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniEnum<{
                    success: 'success'
                    reverted: 'reverted'
                  }>
                >
                to: z.ZodMiniNullable<z.ZodMiniTemplateLiteral<`0x${string}`>>
                transactionHash: z.ZodMiniTemplateLiteral<`0x${string}`>
                transactionIndex: z.ZodMiniCodec<
                  z.ZodMiniTemplateLiteral<`0x${string}`>,
                  z.ZodMiniNumber<number>
                >
                type: z.ZodMiniTemplateLiteral<`0x${string}`>
              },
              z.core.$strip
            >
          >
        >
        status: z.ZodMiniNumber<number>
        version: z.ZodMiniString<string>
      },
      z.core.$strip
    >
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_switchEthereumChain {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_switchEthereumChain'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              chainId: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniNumber<number>
              >
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: undefined
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
export declare namespace wallet_deposit {
  const schema: {
    readonly method: z.ZodMiniLiteral<'wallet_deposit'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [
          z.ZodMiniObject<
            {
              address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              chainId: z.ZodMiniOptional<
                z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
              >
              token: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
              value: z.ZodMiniOptional<z.ZodMiniString<string>>
            },
            z.core.$strip
          >,
        ],
        null
      >
    >
    readonly returns: z.ZodMiniVoid
  }
  type Encoded = Schema.Encoded<typeof schema>
  type Decoded = Schema.Decoded<typeof schema>
}
/** Strict parameter schemas keyed by method name. */
export declare const strictParameters: {
  wallet_authorizeAccessKey: z.ZodMiniObject<
    {
      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
      expiry: z.ZodMiniNumber<number>
      keyType: z.ZodMiniOptional<
        z.ZodMiniUnion<
          readonly [
            z.ZodMiniLiteral<'secp256k1'>,
            z.ZodMiniLiteral<'p256'>,
            z.ZodMiniLiteral<'webAuthn'>,
          ]
        >
      >
      limits: z.ZodMiniReadonly<
        z.ZodMiniArray<
          z.ZodMiniObject<
            {
              token: z.ZodMiniTemplateLiteral<`0x${string}`>
              limit: z.ZodMiniCodec<
                z.ZodMiniTemplateLiteral<`0x${string}`>,
                z.ZodMiniBigInt<bigint>
              >
            },
            z.core.$strip
          >
        >
      >
      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    },
    z.core.$strip
  >
  wallet_connect: z.ZodMiniObject<
    {
      capabilities: z.ZodMiniOptional<
        z.ZodMiniUnion<
          readonly [
            z.ZodMiniObject<
              {
                digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                authorizeAccessKey: z.ZodMiniOptional<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                      expiry: z.ZodMiniNumber<number>
                      keyType: z.ZodMiniOptional<
                        z.ZodMiniUnion<
                          readonly [
                            z.ZodMiniLiteral<'secp256k1'>,
                            z.ZodMiniLiteral<'p256'>,
                            z.ZodMiniLiteral<'webAuthn'>,
                          ]
                        >
                      >
                      limits: z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
                method: z.ZodMiniLiteral<'register'>
                name: z.ZodMiniOptional<z.ZodMiniString<string>>
                userId: z.ZodMiniOptional<z.ZodMiniString<string>>
              },
              z.core.$strip
            >,
            z.ZodMiniObject<
              {
                digest: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                credentialId: z.ZodMiniOptional<z.ZodMiniString<string>>
                authorizeAccessKey: z.ZodMiniOptional<
                  z.ZodMiniObject<
                    {
                      address: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                      expiry: z.ZodMiniNumber<number>
                      keyType: z.ZodMiniOptional<
                        z.ZodMiniUnion<
                          readonly [
                            z.ZodMiniLiteral<'secp256k1'>,
                            z.ZodMiniLiteral<'p256'>,
                            z.ZodMiniLiteral<'webAuthn'>,
                          ]
                        >
                      >
                      limits: z.ZodMiniReadonly<
                        z.ZodMiniArray<
                          z.ZodMiniObject<
                            {
                              token: z.ZodMiniTemplateLiteral<`0x${string}`>
                              limit: z.ZodMiniCodec<
                                z.ZodMiniTemplateLiteral<`0x${string}`>,
                                z.ZodMiniBigInt<bigint>
                              >
                            },
                            z.core.$strip
                          >
                        >
                      >
                      publicKey: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
                    },
                    z.core.$strip
                  >
                >
                method: z.ZodMiniOptional<z.ZodMiniLiteral<'login'>>
                selectAccount: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>
              },
              z.core.$strip
            >,
          ]
        >
      >
      chainId: z.ZodMiniOptional<
        z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniNumber<number>>
      >
      version: z.ZodMiniOptional<z.ZodMiniString<string>>
    },
    z.core.$strip
  >
}
//# sourceMappingURL=rpc.d.ts.map
