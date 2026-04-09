import { Hex } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import { type Chain, type Client, type Transport } from 'viem'
import type { Address } from 'viem/accounts'
import * as z from 'zod/mini'

import type { MaybePromise } from '../internal/types.js'
import type { Kv } from './Kv.js'
/** Supported access-key types for CLI bootstrap. */
export declare const keyType: z.ZodMiniUnion<
  readonly [z.ZodMiniLiteral<'secp256k1'>, z.ZodMiniLiteral<'p256'>, z.ZodMiniLiteral<'webAuthn'>]
>
/** Signed key authorization returned by the device-code flow. */
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
/** Request body for `POST /auth/pkce/code`. */
export declare const createRequest: z.ZodMiniObject<
  {
    account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    chainId: z.ZodMiniOptional<
      z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    >
    codeChallenge: z.ZodMiniString<string>
    expiry: z.ZodMiniOptional<z.ZodMiniNumber<number>>
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
    pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
  },
  z.core.$strip
>
/** Response body for `POST /cli-auth/device-code`. */
export declare const createResponse: z.ZodMiniObject<
  {
    code: z.ZodMiniString<string>
  },
  z.core.$strip
>
/** Request body for `POST /auth/pkce/poll/:code`. */
export declare const pollRequest: z.ZodMiniObject<
  {
    codeVerifier: z.ZodMiniString<string>
  },
  z.core.$strip
>
/** Response body for `POST /auth/pkce/poll/:code`. */
export declare const pollResponse: Omit<
  z.ZodMiniUnion<
    readonly [
      z.ZodMiniObject<
        {
          status: z.ZodMiniLiteral<'pending'>
        },
        z.core.$strip
      >,
      z.ZodMiniObject<
        {
          status: z.ZodMiniLiteral<'authorized'>
          accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
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
        },
        z.core.$strip
      >,
      z.ZodMiniObject<
        {
          status: z.ZodMiniLiteral<'expired'>
        },
        z.core.$strip
      >,
    ]
  >,
  '_zod'
> & {
  _zod: Omit<
    z.core.$ZodUnionInternals<
      readonly [
        z.ZodMiniObject<
          {
            status: z.ZodMiniLiteral<'pending'>
          },
          z.core.$strip
        >,
        z.ZodMiniObject<
          {
            status: z.ZodMiniLiteral<'authorized'>
            accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
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
          },
          z.core.$strip
        >,
        z.ZodMiniObject<
          {
            status: z.ZodMiniLiteral<'expired'>
          },
          z.core.$strip
        >,
      ]
    >,
    'output'
  > & {
    output:
      | {
          status: 'pending'
          keyAuthorization?: undefined
          accountAddress?: undefined
        }
      | {
          status: 'authorized'
          accountAddress: `0x${string}`
          keyAuthorization: {
            address: `0x${string}`
            chainId: bigint
            keyId: `0x${string}`
            keyType: 'secp256k1' | 'p256' | 'webAuthn'
            signature: SignatureEnvelope.SignatureEnvelopeRpc
            expiry?: number | null | undefined
            limits?:
              | readonly {
                  token: `0x${string}`
                  limit: bigint
                }[]
              | undefined
          }
        }
      | {
          status: 'expired'
          keyAuthorization?: undefined
          accountAddress?: undefined
        }
  }
}
/** Response body for `GET /auth/pkce/pending/:code`. */
export declare const pendingResponse: z.ZodMiniObject<
  {
    accessKeyAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
    account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
    chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
    code: z.ZodMiniString<string>
    expiry: z.ZodMiniNumber<number>
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
    pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
    status: z.ZodMiniLiteral<'pending'>
  },
  z.core.$strip
>
/** Request body for `POST /auth/pkce`. */
export declare const authorizeRequest: z.ZodMiniObject<
  {
    accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
    code: z.ZodMiniString<string>
    keyAuthorization: z.ZodMiniObject<
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
  },
  z.core.$strip
>
/** Response body for `POST /cli-auth/authorize`. */
export declare const authorizeResponse: z.ZodMiniObject<
  {
    status: z.ZodMiniLiteral<'authorized'>
  },
  z.core.$strip
>
/** Stored device-code entry schema. */
export declare const entry: Omit<
  z.ZodMiniUnion<
    readonly [
      z.ZodMiniObject<
        {
          account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
          chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
          code: z.ZodMiniString<string>
          codeChallenge: z.ZodMiniString<string>
          createdAt: z.ZodMiniNumber<number>
          expiresAt: z.ZodMiniNumber<number>
          expiry: z.ZodMiniNumber<number>
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
          pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
          status: z.ZodMiniLiteral<'pending'>
        },
        z.core.$strip
      >,
      z.ZodMiniObject<
        {
          account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
          accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
          authorizedAt: z.ZodMiniNumber<number>
          chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
          code: z.ZodMiniString<string>
          codeChallenge: z.ZodMiniString<string>
          createdAt: z.ZodMiniNumber<number>
          expiresAt: z.ZodMiniNumber<number>
          expiry: z.ZodMiniNumber<number>
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
          pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
          status: z.ZodMiniLiteral<'authorized'>
        },
        z.core.$strip
      >,
      z.ZodMiniObject<
        {
          account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
          accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
          authorizedAt: z.ZodMiniNumber<number>
          chainId: z.ZodMiniCodec<z.ZodMiniTemplateLiteral<`0x${string}`>, z.ZodMiniBigInt<bigint>>
          code: z.ZodMiniString<string>
          codeChallenge: z.ZodMiniString<string>
          consumedAt: z.ZodMiniNumber<number>
          createdAt: z.ZodMiniNumber<number>
          expiresAt: z.ZodMiniNumber<number>
          expiry: z.ZodMiniNumber<number>
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
          pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
          status: z.ZodMiniLiteral<'consumed'>
        },
        z.core.$strip
      >,
    ]
  >,
  '_zod'
> & {
  _zod: Omit<
    z.core.$ZodUnionInternals<
      readonly [
        z.ZodMiniObject<
          {
            account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
            chainId: z.ZodMiniCodec<
              z.ZodMiniTemplateLiteral<`0x${string}`>,
              z.ZodMiniBigInt<bigint>
            >
            code: z.ZodMiniString<string>
            codeChallenge: z.ZodMiniString<string>
            createdAt: z.ZodMiniNumber<number>
            expiresAt: z.ZodMiniNumber<number>
            expiry: z.ZodMiniNumber<number>
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
            pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
            status: z.ZodMiniLiteral<'pending'>
          },
          z.core.$strip
        >,
        z.ZodMiniObject<
          {
            account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
            accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
            authorizedAt: z.ZodMiniNumber<number>
            chainId: z.ZodMiniCodec<
              z.ZodMiniTemplateLiteral<`0x${string}`>,
              z.ZodMiniBigInt<bigint>
            >
            code: z.ZodMiniString<string>
            codeChallenge: z.ZodMiniString<string>
            createdAt: z.ZodMiniNumber<number>
            expiresAt: z.ZodMiniNumber<number>
            expiry: z.ZodMiniNumber<number>
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
            pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
            status: z.ZodMiniLiteral<'authorized'>
          },
          z.core.$strip
        >,
        z.ZodMiniObject<
          {
            account: z.ZodMiniOptional<z.ZodMiniTemplateLiteral<`0x${string}`>>
            accountAddress: z.ZodMiniTemplateLiteral<`0x${string}`>
            authorizedAt: z.ZodMiniNumber<number>
            chainId: z.ZodMiniCodec<
              z.ZodMiniTemplateLiteral<`0x${string}`>,
              z.ZodMiniBigInt<bigint>
            >
            code: z.ZodMiniString<string>
            codeChallenge: z.ZodMiniString<string>
            consumedAt: z.ZodMiniNumber<number>
            createdAt: z.ZodMiniNumber<number>
            expiresAt: z.ZodMiniNumber<number>
            expiry: z.ZodMiniNumber<number>
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
            pubKey: z.ZodMiniTemplateLiteral<`0x${string}`>
            status: z.ZodMiniLiteral<'consumed'>
          },
          z.core.$strip
        >,
      ]
    >,
    'output'
  > & {
    output:
      | {
          chainId: bigint
          code: string
          codeChallenge: string
          createdAt: number
          expiresAt: number
          expiry: number
          keyType: 'secp256k1' | 'p256' | 'webAuthn'
          pubKey: `0x${string}`
          status: 'pending'
          account?: `0x${string}` | undefined
          limits?:
            | readonly {
                token: `0x${string}`
                limit: bigint
              }[]
            | undefined
          keyAuthorization?: undefined
          accountAddress?: undefined
          authorizedAt?: undefined
          consumedAt?: undefined
        }
      | {
          accountAddress: `0x${string}`
          authorizedAt: number
          chainId: bigint
          code: string
          codeChallenge: string
          createdAt: number
          expiresAt: number
          expiry: number
          keyAuthorization: {
            address: `0x${string}`
            chainId: bigint
            keyId: `0x${string}`
            keyType: 'secp256k1' | 'p256' | 'webAuthn'
            signature: SignatureEnvelope.SignatureEnvelopeRpc
            expiry?: number | null | undefined
            limits?:
              | readonly {
                  token: `0x${string}`
                  limit: bigint
                }[]
              | undefined
          }
          keyType: 'secp256k1' | 'p256' | 'webAuthn'
          pubKey: `0x${string}`
          status: 'authorized'
          account?: `0x${string}` | undefined
          limits?:
            | readonly {
                token: `0x${string}`
                limit: bigint
              }[]
            | undefined
          consumedAt?: undefined
        }
      | {
          accountAddress: `0x${string}`
          authorizedAt: number
          chainId: bigint
          code: string
          codeChallenge: string
          consumedAt: number
          createdAt: number
          expiresAt: number
          expiry: number
          keyAuthorization: {
            address: `0x${string}`
            chainId: bigint
            keyId: `0x${string}`
            keyType: 'secp256k1' | 'p256' | 'webAuthn'
            signature: SignatureEnvelope.SignatureEnvelopeRpc
            expiry?: number | null | undefined
            limits?:
              | readonly {
                  token: `0x${string}`
                  limit: bigint
                }[]
              | undefined
          }
          keyType: 'secp256k1' | 'p256' | 'webAuthn'
          pubKey: `0x${string}`
          status: 'consumed'
          account?: `0x${string}` | undefined
          limits?:
            | readonly {
                token: `0x${string}`
                limit: bigint
              }[]
            | undefined
        }
  }
}
/** Stored device-code entry. */
export type Entry = z.output<typeof entry>
/** Device-code storage contract. */
export type Store = {
  /** Saves a new pending device-code entry. */
  create: (entry: Entry.Pending) => MaybePromise<void>
  /** Loads a device-code entry by verification code. */
  get: (code: string) => MaybePromise<Entry | undefined>
  /** Marks a pending device-code as authorized. */
  authorize: (options: Store.authorize.Options) => MaybePromise<Entry.Authorized | undefined>
  /** Consumes an authorized device-code exactly once. */
  consume: (code: string) => MaybePromise<Entry.Authorized | undefined>
  /** Deletes a device-code entry. */
  delete: (code: string) => MaybePromise<void>
}
export declare namespace Entry {
  /** Pending device-code entry. */
  type Pending = Extract<
    z.output<typeof entry>,
    {
      status: 'pending'
    }
  >
  /** Authorized device-code entry. */
  type Authorized = Extract<
    z.output<typeof entry>,
    {
      status: 'authorized'
    }
  >
  /** Consumed device-code entry. */
  type Consumed = Extract<
    z.output<typeof entry>,
    {
      status: 'consumed'
    }
  >
}
export declare namespace Store {
  namespace authorize {
    type Options = {
      /** Root account that approved the access key. */
      accountAddress: Address
      /** Signed key authorization. */
      keyAuthorization: z.output<typeof keyAuthorization>
      /** Verification code to authorize. */
      code: string
    }
  }
  namespace kv {
    type Options = {
      /** Prefix used for KV keys. @default "cli-auth" */
      key?: string | undefined
    }
  }
}
/** Error thrown when pending device-code lookup cannot return a pending request. */
export declare class PendingError extends Error {
  status: 400 | 404
  constructor(message: string, status: 400 | 404)
}
/** Host validation and sanitization for requested CLI auth defaults. */
export type Policy = {
  /** Validates and optionally rewrites requested policy before the entry is stored. */
  validate: (options: Policy.validate.Options) => MaybePromise<Policy.validate.ReturnType>
}
export declare namespace Policy {
  namespace validate {
    type Options = {
      /** Requested root account restriction. */
      account?: Address | undefined
      /** Requested access-key expiry timestamp. Omit to let the server choose one. */
      expiry?: number | undefined
      /** Requested key type. */
      keyType: z.output<typeof keyType>
      /** Requested spending limits. */
      limits?:
        | readonly {
            token: Address
            limit: bigint
          }[]
        | undefined
      /** Requested access-key public key. */
      pubKey: Hex.Hex
    }
    type ReturnType = {
      /** Approved access-key expiry timestamp. */
      expiry: number
      /** Approved spending limits. */
      limits?:
        | readonly {
            token: Address
            limit: bigint
          }[]
        | undefined
    }
  }
}
/** Built-in device-code store helpers. */
export declare const Store: {
  /**
   * Creates an in-memory device-code store.
   *
   * Useful for tests and single-process servers.
   */
  memory(): Store
  /**
   * Creates a key-value backed device-code store.
   *
   * Stored values are encoded through the shared entry schema so they remain
   * JSON-safe across KV implementations.
   */
  kv(kv: Kv, options?: Store.kv.Options): Store
}
/** Built-in policy helpers. */
export declare const Policy: {
  /** Creates an allow-all policy with a default 24-hour expiry when omitted. */
  allow(): Policy
  /** Returns the provided policy unchanged. */
  from(policy: Policy): Policy
}
/** Creates and stores a new device code. */
export declare function createDeviceCode(
  options: createDeviceCode.Options,
): Promise<createDeviceCode.ReturnType>
export declare namespace createDeviceCode {
  type Options = {
    /** Chain ID embedded into the expected key authorization. @default tempo.id */
    chainId?: bigint | number | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Policy used to validate requested expiry and limits. */
    policy?: Policy | undefined
    /** Random byte generator used for verification code allocation. */
    random?: ((size: number) => Uint8Array) | undefined
    /** Incoming device-code creation request. */
    request: z.output<typeof createRequest>
    /** Device-code store. */
    store?: Store | undefined
    /** Pending entry TTL in milliseconds. @default 600000 */
    ttlMs?: number | undefined
  }
  type ReturnType = z.output<typeof createResponse>
}
/** Looks up a pending device code for browser approval UIs. */
export declare function pending(options: pending.Options): Promise<pending.ReturnType>
export declare namespace pending {
  type Options = {
    /** Verification code from the route path. */
    code: string
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Device-code store. */
    store?: Store | undefined
  }
  type ReturnType = z.output<typeof pendingResponse>
}
/** Polls a device code with PKCE verification. */
export declare function poll(options: poll.Options): Promise<poll.ReturnType>
export declare namespace poll {
  type Options = {
    /** Verification code from the route path. */
    code: string
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Poll request body. */
    request: z.output<typeof pollRequest>
    /** Device-code store. */
    store?: Store | undefined
  }
  type ReturnType = z.output<typeof pollResponse>
}
/** Authorizes a pending device code after validating the signed key authorization. */
export declare function authorize(options: authorize.Options): Promise<authorize.ReturnType>
export declare namespace authorize {
  type Options = {
    /** Chain ID embedded into the expected key authorization. Defaults to the client chain or tempo.id. */
    chainId?: bigint | number | undefined
    /** Client used to verify the signed key authorization. */
    client?: Client<Transport, Chain | undefined> | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Authorize request body. */
    request: z.output<typeof authorizeRequest>
    /** Device-code store. */
    store?: Store | undefined
  }
  type ReturnType = z.output<typeof authorizeResponse>
}
//# sourceMappingURL=CliAuth.d.ts.map
