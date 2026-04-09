import { RpcSchema } from 'ox'
import * as z from 'zod/mini'
export { defineItem, from } from './internal/schema.js'
/**
 * A single JSON-RPC method definition with Zod schemas for
 * the method name, parameters, and return type.
 */
export type Item = {
  /** Method name as a Zod literal. */
  method: z.ZodMiniLiteral<string>
  /** Parameters schema, or `undefined` if the method takes no params. */
  params: z.ZodMiniType | undefined
  /** Return type schema, or `undefined` if the method returns nothing. */
  returns: z.ZodMiniType | undefined
}
/** An array of JSON-RPC method definitions. */
export type Schema = readonly Item[]
/** Inferred wire-format type for a schema item — raw JSON-RPC `{ method, params, returns }`. */
export type Encoded<item extends Item> = {
  method: z.input<item['method']>
  params: item['params'] extends z.ZodMiniType ? z.input<item['params']> : undefined
  returns: item['returns'] extends z.ZodMiniType ? z.input<item['returns']> : undefined
}
/** Inferred decoded type for a schema item — after codec transforms are applied. */
export type Decoded<item extends Item> = {
  method: z.input<item['method']>
  params: item['params'] extends z.ZodMiniType ? z.output<item['params']> : undefined
  returns: item['returns'] extends z.ZodMiniType ? z.output<item['returns']> : undefined
}
/**
 * Transforms a {@link Schema} into an Ox-compatible `RpcSchema.Generic` union.
 *
 * Uses `z.input` (the wire/encoded form — hex strings) since Ox operates
 * on the raw JSON-RPC wire format.
 */
export type ToOx<schema extends Schema> = {
  [key in keyof schema]: RpcSchema.From<{
    Request: schema[key]['params'] extends z.ZodMiniType
      ? undefined extends z.input<schema[key]['params']>
        ? {
            method: z.input<schema[key]['method']>
            params?: z.input<schema[key]['params']>
          }
        : {
            method: z.input<schema[key]['method']>
            params: z.input<schema[key]['params']>
          }
      : {
          method: z.input<schema[key]['method']>
        }
    ReturnType: schema[key]['returns'] extends z.ZodMiniType
      ? z.input<schema[key]['returns']>
      : undefined
  }>
}[number]
/**
 * Transforms a {@link Schema} into a Viem-compatible `RpcSchema` tuple.
 *
 * Uses `z.input` (the wire/encoded form — hex strings) since Viem's
 * RPC schema types operate on the raw JSON-RPC wire format.
 */
export type ToViem<schema extends Schema> = {
  [key in keyof schema]: {
    Method: z.input<schema[key]['method']>
    Parameters: schema[key]['params'] extends z.ZodMiniType
      ? z.input<schema[key]['params']>
      : undefined
    ReturnType: schema[key]['returns'] extends z.ZodMiniType
      ? z.input<schema[key]['returns']>
      : undefined
  }
}
/** All provider-handled RPC method definitions. */
export declare const schema: readonly [
  {
    readonly method: z.ZodMiniLiteral<'eth_accounts'>
    readonly params: undefined
    readonly returns: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
  },
  {
    readonly method: z.ZodMiniLiteral<'eth_chainId'>
    readonly params: undefined
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  },
  {
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
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc,
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
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
  },
  {
    readonly method: z.ZodMiniLiteral<'eth_requestAccounts'>
    readonly params: undefined
    readonly returns: z.ZodMiniReadonly<z.ZodMiniArray<z.ZodMiniTemplateLiteral<`0x${string}`>>>
  },
  {
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
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc,
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
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
  },
  {
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
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc,
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
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
  },
  {
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
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc,
                      import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
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
  },
  {
    readonly method: z.ZodMiniLiteral<'eth_signTypedData_v4'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniString<string>],
        null
      >
    >
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  },
  {
    readonly method: z.ZodMiniLiteral<'personal_sign'>
    readonly params: z.ZodMiniReadonly<
      z.ZodMiniTuple<
        readonly [z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniTemplateLiteral<`0x${string}`>],
        null
      >
    >
    readonly returns: z.ZodMiniTemplateLiteral<`0x${string}`>
  },
  {
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
              import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc,
              import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
            >
          },
          z.core.$strip
        >
        rootAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
      },
      z.core.$strip
    >
  },
  {
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
                            import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc,
                            import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
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
  },
  {
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
  },
  {
    readonly method: z.ZodMiniLiteral<'wallet_disconnect'>
    readonly params: undefined
    readonly returns: undefined
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
]
/** Ox-compatible RPC schema union for the provider. */
export type Ox = RpcSchema.Eth | ToOx<typeof schema>
export declare const ox: Ox
/** Viem-compatible RPC schema tuple for the provider. */
export type Viem = ToViem<typeof schema>
export declare const viem: readonly [
  {
    Method: 'eth_accounts'
    Parameters: undefined
    ReturnType: readonly `0x${string}`[]
  },
  {
    Method: 'eth_chainId'
    Parameters: undefined
    ReturnType: `0x${string}`
  },
  {
    Method: 'eth_fillTransaction'
    Parameters: readonly [
      {
        accessList?:
          | {
              address: `0x${string}`
              storageKeys: `0x${string}`[]
            }[]
          | undefined
        calls?:
          | readonly {
              data?: `0x${string}` | undefined
              to?: `0x${string}` | undefined
              value?: `0x${string}` | undefined
            }[]
          | undefined
        chainId?: `0x${string}` | undefined
        data?: `0x${string}` | undefined
        feePayer?: string | boolean | undefined
        feeToken?: `0x${string}` | undefined
        from?: `0x${string}` | undefined
        gas?: `0x${string}` | undefined
        keyAuthorization?:
          | {
              address: `0x${string}`
              chainId: `0x${string}`
              keyId: `0x${string}`
              keyType: 'secp256k1' | 'p256' | 'webAuthn'
              signature: import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
              expiry?: `0x${string}` | null | undefined
              limits?:
                | readonly {
                    token: `0x${string}`
                    limit: `0x${string}`
                  }[]
                | undefined
            }
          | undefined
        maxFeePerGas?: `0x${string}` | undefined
        maxPriorityFeePerGas?: `0x${string}` | undefined
        nonce?: `0x${string}` | undefined
        nonceKey?: `0x${string}` | undefined
        to?: `0x${string}` | undefined
        validAfter?: `0x${string}` | undefined
        validBefore?: `0x${string}` | undefined
        value?: `0x${string}` | undefined
      },
    ]
    ReturnType: any
  },
  {
    Method: 'eth_requestAccounts'
    Parameters: undefined
    ReturnType: readonly `0x${string}`[]
  },
  {
    Method: 'eth_sendTransaction'
    Parameters: readonly [
      {
        accessList?:
          | {
              address: `0x${string}`
              storageKeys: `0x${string}`[]
            }[]
          | undefined
        calls?:
          | readonly {
              data?: `0x${string}` | undefined
              to?: `0x${string}` | undefined
              value?: `0x${string}` | undefined
            }[]
          | undefined
        chainId?: `0x${string}` | undefined
        data?: `0x${string}` | undefined
        feePayer?: string | boolean | undefined
        feeToken?: `0x${string}` | undefined
        from?: `0x${string}` | undefined
        gas?: `0x${string}` | undefined
        keyAuthorization?:
          | {
              address: `0x${string}`
              chainId: `0x${string}`
              keyId: `0x${string}`
              keyType: 'secp256k1' | 'p256' | 'webAuthn'
              signature: import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
              expiry?: `0x${string}` | null | undefined
              limits?:
                | readonly {
                    token: `0x${string}`
                    limit: `0x${string}`
                  }[]
                | undefined
            }
          | undefined
        maxFeePerGas?: `0x${string}` | undefined
        maxPriorityFeePerGas?: `0x${string}` | undefined
        nonce?: `0x${string}` | undefined
        nonceKey?: `0x${string}` | undefined
        to?: `0x${string}` | undefined
        validAfter?: `0x${string}` | undefined
        validBefore?: `0x${string}` | undefined
        value?: `0x${string}` | undefined
      },
    ]
    ReturnType: `0x${string}`
  },
  {
    Method: 'eth_sendTransactionSync'
    Parameters: readonly [
      {
        accessList?:
          | {
              address: `0x${string}`
              storageKeys: `0x${string}`[]
            }[]
          | undefined
        calls?:
          | readonly {
              data?: `0x${string}` | undefined
              to?: `0x${string}` | undefined
              value?: `0x${string}` | undefined
            }[]
          | undefined
        chainId?: `0x${string}` | undefined
        data?: `0x${string}` | undefined
        feePayer?: string | boolean | undefined
        feeToken?: `0x${string}` | undefined
        from?: `0x${string}` | undefined
        gas?: `0x${string}` | undefined
        keyAuthorization?:
          | {
              address: `0x${string}`
              chainId: `0x${string}`
              keyId: `0x${string}`
              keyType: 'secp256k1' | 'p256' | 'webAuthn'
              signature: import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
              expiry?: `0x${string}` | null | undefined
              limits?:
                | readonly {
                    token: `0x${string}`
                    limit: `0x${string}`
                  }[]
                | undefined
            }
          | undefined
        maxFeePerGas?: `0x${string}` | undefined
        maxPriorityFeePerGas?: `0x${string}` | undefined
        nonce?: `0x${string}` | undefined
        nonceKey?: `0x${string}` | undefined
        to?: `0x${string}` | undefined
        validAfter?: `0x${string}` | undefined
        validBefore?: `0x${string}` | undefined
        value?: `0x${string}` | undefined
      },
    ]
    ReturnType: {
      blockHash: `0x${string}`
      blockNumber: `0x${string}`
      contractAddress: `0x${string}` | null
      cumulativeGasUsed: `0x${string}`
      effectiveGasPrice: `0x${string}`
      from: `0x${string}`
      gasUsed: `0x${string}`
      logs: {
        address: `0x${string}`
        blockHash: `0x${string}`
        blockNumber: `0x${string}`
        data: `0x${string}`
        logIndex: `0x${string}`
        removed: boolean
        topics: readonly `0x${string}`[]
        transactionHash: `0x${string}`
        transactionIndex: `0x${string}`
      }[]
      logsBloom: `0x${string}`
      status: `0x${string}`
      to: `0x${string}` | null
      transactionHash: `0x${string}`
      transactionIndex: `0x${string}`
      type: `0x${string}`
      blobGasPrice?: `0x${string}` | undefined
      blobGasUsed?: `0x${string}` | undefined
      feePayer?: `0x${string}` | undefined
      feeToken?: `0x${string}` | undefined
      root?: `0x${string}` | undefined
    }
  },
  {
    Method: 'eth_signTransaction'
    Parameters: readonly [
      {
        accessList?:
          | {
              address: `0x${string}`
              storageKeys: `0x${string}`[]
            }[]
          | undefined
        calls?:
          | readonly {
              data?: `0x${string}` | undefined
              to?: `0x${string}` | undefined
              value?: `0x${string}` | undefined
            }[]
          | undefined
        chainId?: `0x${string}` | undefined
        data?: `0x${string}` | undefined
        feePayer?: string | boolean | undefined
        feeToken?: `0x${string}` | undefined
        from?: `0x${string}` | undefined
        gas?: `0x${string}` | undefined
        keyAuthorization?:
          | {
              address: `0x${string}`
              chainId: `0x${string}`
              keyId: `0x${string}`
              keyType: 'secp256k1' | 'p256' | 'webAuthn'
              signature: import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
              expiry?: `0x${string}` | null | undefined
              limits?:
                | readonly {
                    token: `0x${string}`
                    limit: `0x${string}`
                  }[]
                | undefined
            }
          | undefined
        maxFeePerGas?: `0x${string}` | undefined
        maxPriorityFeePerGas?: `0x${string}` | undefined
        nonce?: `0x${string}` | undefined
        nonceKey?: `0x${string}` | undefined
        to?: `0x${string}` | undefined
        validAfter?: `0x${string}` | undefined
        validBefore?: `0x${string}` | undefined
        value?: `0x${string}` | undefined
      },
    ]
    ReturnType: `0x${string}`
  },
  {
    Method: 'eth_signTypedData_v4'
    Parameters: readonly [`0x${string}`, string]
    ReturnType: `0x${string}`
  },
  {
    Method: 'personal_sign'
    Parameters: readonly [`0x${string}`, `0x${string}`]
    ReturnType: `0x${string}`
  },
  {
    Method: 'wallet_authorizeAccessKey'
    Parameters: readonly [
      {
        expiry: number
        address?: `0x${string}` | undefined
        keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
        limits?:
          | readonly {
              token: `0x${string}`
              limit: `0x${string}`
            }[]
          | undefined
        publicKey?: `0x${string}` | undefined
      },
    ]
    ReturnType: {
      keyAuthorization: {
        address: `0x${string}`
        chainId: `0x${string}`
        keyId: `0x${string}`
        keyType: 'secp256k1' | 'p256' | 'webAuthn'
        signature: import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
        expiry?: `0x${string}` | null | undefined
        limits?:
          | readonly {
              token: `0x${string}`
              limit: `0x${string}`
            }[]
          | undefined
      }
      rootAddress: `0x${string}`
    }
  },
  {
    Method: 'wallet_connect'
    Parameters:
      | readonly [
          {
            capabilities?:
              | {
                  method: 'register'
                  digest?: `0x${string}` | undefined
                  authorizeAccessKey?:
                    | {
                        expiry: number
                        address?: `0x${string}` | undefined
                        keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
                        limits?:
                          | readonly {
                              token: `0x${string}`
                              limit: `0x${string}`
                            }[]
                          | undefined
                        publicKey?: `0x${string}` | undefined
                      }
                    | undefined
                  name?: string | undefined
                  userId?: string | undefined
                }
              | {
                  digest?: `0x${string}` | undefined
                  credentialId?: string | undefined
                  authorizeAccessKey?:
                    | {
                        expiry: number
                        address?: `0x${string}` | undefined
                        keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
                        limits?:
                          | readonly {
                              token: `0x${string}`
                              limit: `0x${string}`
                            }[]
                          | undefined
                        publicKey?: `0x${string}` | undefined
                      }
                    | undefined
                  method?: 'login' | undefined
                  selectAccount?: boolean | undefined
                }
              | undefined
            chainId?: `0x${string}` | undefined
            version?: string | undefined
          },
        ]
      | undefined
    ReturnType: {
      accounts: readonly {
        address: `0x${string}`
        capabilities: {
          keyAuthorization?:
            | {
                address: `0x${string}`
                chainId: `0x${string}`
                keyId: `0x${string}`
                keyType: 'secp256k1' | 'p256' | 'webAuthn'
                signature: import('ox/tempo/SignatureEnvelope').SignatureEnvelopeRpc
                expiry?: `0x${string}` | null | undefined
                limits?:
                  | readonly {
                      token: `0x${string}`
                      limit: `0x${string}`
                    }[]
                  | undefined
              }
            | undefined
          signature?: `0x${string}` | undefined
        }
      }[]
    }
  },
  {
    Method: 'wallet_deposit'
    Parameters: readonly [
      {
        address?: `0x${string}` | undefined
        chainId?: `0x${string}` | undefined
        token?: `0x${string}` | undefined
        value?: string | undefined
      },
    ]
    ReturnType: void
  },
  {
    Method: 'wallet_disconnect'
    Parameters: undefined
    ReturnType: undefined
  },
  {
    Method: 'wallet_getBalances'
    Parameters:
      | readonly [
          {
            account?: `0x${string}` | undefined
            chainId?: `0x${string}` | undefined
            tokens?: readonly `0x${string}`[] | undefined
          },
        ]
      | undefined
    ReturnType: readonly {
      address: `0x${string}`
      balance: `0x${string}`
      decimals: number
      display: string
      name: string
      symbol: string
    }[]
  },
  {
    Method: 'wallet_getCallsStatus'
    Parameters: readonly [string] | undefined
    ReturnType: {
      atomic: boolean
      chainId: `0x${string}`
      id: string
      status: number
      version: string
      receipts?:
        | {
            blockHash: `0x${string}`
            blockNumber: `0x${string}`
            contractAddress: `0x${string}` | null
            cumulativeGasUsed: `0x${string}`
            effectiveGasPrice: `0x${string}`
            from: `0x${string}`
            gasUsed: `0x${string}`
            logs: {
              address: `0x${string}`
              blockHash: `0x${string}`
              blockNumber: `0x${string}`
              data: `0x${string}`
              logIndex: `0x${string}`
              removed: boolean
              topics: readonly `0x${string}`[]
              transactionHash: `0x${string}`
              transactionIndex: `0x${string}`
            }[]
            logsBloom: `0x${string}`
            status: `0x${string}`
            to: `0x${string}` | null
            transactionHash: `0x${string}`
            transactionIndex: `0x${string}`
            type: `0x${string}`
            blobGasPrice?: `0x${string}` | undefined
            blobGasUsed?: `0x${string}` | undefined
            feePayer?: `0x${string}` | undefined
            feeToken?: `0x${string}` | undefined
            root?: `0x${string}` | undefined
          }[]
        | undefined
    }
  },
  {
    Method: 'wallet_getCapabilities'
    Parameters:
      | readonly [`0x${string}`]
      | readonly [`0x${string}`, readonly `0x${string}`[]]
      | undefined
    ReturnType: Record<
      `0x${string}`,
      {
        atomic: {
          status: 'supported' | 'unsupported' | 'ready'
        }
        accessKeys?:
          | {
              status: 'supported' | 'unsupported'
            }
          | undefined
      }
    >
  },
  {
    Method: 'wallet_revokeAccessKey'
    Parameters: readonly [
      {
        address: `0x${string}`
        accessKeyAddress: `0x${string}`
      },
    ]
    ReturnType: undefined
  },
  {
    Method: 'wallet_sendCalls'
    Parameters:
      | readonly [
          {
            calls: readonly {
              data?: `0x${string}` | undefined
              to?: `0x${string}` | undefined
              value?: `0x${string}` | undefined
            }[]
            atomicRequired?: boolean | undefined
            capabilities?:
              | {
                  sync?: boolean | undefined
                }
              | undefined
            chainId?: `0x${string}` | undefined
            from?: `0x${string}` | undefined
            version?: string | undefined
          },
        ]
      | undefined
    ReturnType: {
      id: string
      atomic?: boolean | undefined
      capabilities?:
        | {
            sync?: boolean | undefined
          }
        | undefined
      chainId?: `0x${string}` | undefined
      receipts?:
        | {
            blockHash: `0x${string}`
            blockNumber: `0x${string}`
            contractAddress: `0x${string}` | null
            cumulativeGasUsed: `0x${string}`
            effectiveGasPrice: `0x${string}`
            from: `0x${string}`
            gasUsed: `0x${string}`
            logs: {
              address: `0x${string}`
              blockHash: `0x${string}`
              blockNumber: `0x${string}`
              data: `0x${string}`
              logIndex: `0x${string}`
              removed: boolean
              topics: readonly `0x${string}`[]
              transactionHash: `0x${string}`
              transactionIndex: `0x${string}`
            }[]
            logsBloom: `0x${string}`
            status: `0x${string}`
            to: `0x${string}` | null
            transactionHash: `0x${string}`
            transactionIndex: `0x${string}`
            type: `0x${string}`
            blobGasPrice?: `0x${string}` | undefined
            blobGasUsed?: `0x${string}` | undefined
            feePayer?: `0x${string}` | undefined
            feeToken?: `0x${string}` | undefined
            root?: `0x${string}` | undefined
          }[]
        | undefined
      status?: number | undefined
      version?: string | undefined
    }
  },
  {
    Method: 'wallet_switchEthereumChain'
    Parameters: readonly [
      {
        chainId: `0x${string}`
      },
    ]
    ReturnType: undefined
  },
]
/** Derives a union of wire-format request shapes from a {@link Schema}. */
type ToRequestInput<schema extends Schema> = {
  [key in keyof schema]: schema[key]['params'] extends z.ZodMiniType
    ? {
        method: z.input<schema[key]['method']>
        params: z.input<schema[key]['params']>
      }
    : {
        method: z.input<schema[key]['method']>
      }
}[number]
/** Derives a union of decoded request shapes from a {@link Schema}. */
type ToRequestOutput<schema extends Schema> = {
  [key in keyof schema]: schema[key]['params'] extends z.ZodMiniType
    ? {
        method: z.output<schema[key]['method']>
        params: z.output<schema[key]['params']>
      }
    : {
        method: z.output<schema[key]['method']>
      }
}[number]
/** Discriminated union of all provider-handled RPC requests. */
export declare const Request: z.ZodMiniType<
  ToRequestOutput<typeof schema>,
  ToRequestInput<typeof schema>
>
export type Request = ToRequestOutput<typeof schema>
//# sourceMappingURL=Schema.d.ts.map
