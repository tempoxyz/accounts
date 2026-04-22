import type { RpcSchema } from 'ox'
import type { Hex } from 'viem'
import { describe, expectTypeOf, test } from 'vp/test'

import type * as Schema from './Schema.js'
import type * as Rpc from './zod/rpc.js'

describe('Encoded', () => {
  test('eth_accounts', () => {
    expectTypeOf<Rpc.eth_accounts.Encoded>().toEqualTypeOf<{
      method: 'eth_accounts'
      params: undefined
      returns: readonly Hex[]
    }>()
  })

  test('eth_chainId', () => {
    expectTypeOf<Rpc.eth_chainId.Encoded>().toEqualTypeOf<{
      method: 'eth_chainId'
      params: undefined
      returns: Hex
    }>()
  })

  test('eth_requestAccounts', () => {
    expectTypeOf<Rpc.eth_requestAccounts.Encoded>().toEqualTypeOf<{
      method: 'eth_requestAccounts'
      params: undefined
      returns: readonly Hex[]
    }>()
  })

  test('eth_sendTransaction', () => {
    expectTypeOf<Rpc.eth_sendTransaction.Encoded>().toMatchTypeOf<{
      method: 'eth_sendTransaction'
      params: readonly [
        {
          accessList?: { address: Hex; storageKeys: Hex[] }[] | undefined
          calls?: readonly { data?: Hex | undefined; to?: Hex | undefined }[] | undefined
          chainId?: Hex | undefined
          feePayer?: boolean | string | undefined
          feeToken?: Hex | undefined
          from?: Hex | undefined
          gas?: Hex | undefined
          maxFeePerGas?: Hex | undefined
          maxPriorityFeePerGas?: Hex | undefined
          nonce?: Hex | undefined
          nonceKey?: Hex | undefined
          validAfter?: Hex | undefined
          validBefore?: Hex | undefined
          value?: Hex | undefined
        },
      ]
      returns: Hex
    }>()
  })

  test('wallet_connect: params', () => {
    expectTypeOf<Rpc.wallet_connect.Encoded['params']>().toExtend<
      | readonly [
          {
            capabilities?:
              | {
                  digest?: Hex | undefined
                  authorizeAccessKey?:
                    | {
                        address?: Hex | undefined
                        expiry: number
                        keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
                        limits?: readonly { token: Hex; limit: Hex }[] | undefined
                        publicKey?: Hex | undefined
                      }
                    | undefined
                  identity?: { email?: { required: true } | undefined } | undefined
                  method: 'register'
                  name?: string | undefined
                  userId?: string | undefined
                }
              | {
                  digest?: Hex | undefined
                  credentialId?: string | undefined
                  authorizeAccessKey?:
                    | {
                        address?: Hex | undefined
                        expiry: number
                        keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
                        limits?: readonly { token: Hex; limit: Hex }[] | undefined
                        publicKey?: Hex | undefined
                      }
                    | undefined
                  identity?: { email?: { required: true } | undefined } | undefined
                  method?: 'login' | undefined
                  selectAccount?: boolean | undefined
                }
              | undefined
            version?: string | undefined
          },
        ]
      | undefined
    >()
  })

  test('wallet_connect: returns', () => {
    expectTypeOf<Rpc.wallet_connect.Encoded['returns']>().toHaveProperty('accounts')
    expectTypeOf<
      Rpc.wallet_connect.Encoded['returns']['accounts'][number]['address']
    >().toEqualTypeOf<Hex>()
    expectTypeOf<Rpc.wallet_connect.Encoded['returns']>().toMatchTypeOf<{
      accounts: readonly {
        capabilities: {
          identity?:
            | {
                email?:
                  | {
                      issuer: string
                      value: string
                      verified: true
                    }
                  | undefined
              }
            | undefined
        }
      }[]
    }>()
    expectTypeOf<
      Extract<
        'email',
        keyof Rpc.wallet_connect.Encoded['returns']['accounts'][number]['capabilities']
      >
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Extract<
        'username',
        keyof Rpc.wallet_connect.Encoded['returns']['accounts'][number]['capabilities']
      >
    >().toEqualTypeOf<never>()
  })

  test('wallet_authorizeAccessKey', () => {
    expectTypeOf<Rpc.wallet_authorizeAccessKey.Encoded>().toHaveProperty('method')
    expectTypeOf<Rpc.wallet_authorizeAccessKey.Encoded['returns']>().toHaveProperty('rootAddress')
    expectTypeOf<Rpc.wallet_authorizeAccessKey.Encoded['returns']>().toHaveProperty(
      'keyAuthorization',
    )
  })

  test('wallet_disconnect', () => {
    expectTypeOf<Rpc.wallet_disconnect.Encoded>().toEqualTypeOf<{
      method: 'wallet_disconnect'
      params: undefined
      returns: undefined
    }>()
  })

  test('wallet_switchEthereumChain', () => {
    expectTypeOf<Rpc.wallet_switchEthereumChain.Encoded>().toEqualTypeOf<{
      method: 'wallet_switchEthereumChain'
      params: readonly [{ chainId: Hex }]
      returns: undefined
    }>()
  })
})

describe('ToOx', () => {
  test('produces RpcSchema.Generic members', () => {
    type OxSchema = Schema.ToOx<typeof Schema.schema>
    expectTypeOf<OxSchema>().toMatchTypeOf<RpcSchema.Generic>()
  })
})

describe('ToViem', () => {
  test('produces tuple with Method/Parameters/ReturnType', () => {
    type ViemSchema = Schema.ToViem<typeof Schema.schema>
    expectTypeOf<ViemSchema[0]['Method']>().toEqualTypeOf<'eth_accounts'>()
    expectTypeOf<ViemSchema[0]['Parameters']>().toEqualTypeOf<undefined>()
    expectTypeOf<ViemSchema[0]['ReturnType']>().toEqualTypeOf<readonly Hex[]>()
  })
})

describe('Ox', () => {
  test('includes RpcSchema.Eth', () => {
    expectTypeOf<RpcSchema.Eth>().toMatchTypeOf<Schema.Ox>()
  })

  test('includes provider methods', () => {
    expectTypeOf<Schema.ToOx<typeof Schema.schema>>().toMatchTypeOf<Schema.Ox>()
  })
})

describe('Viem', () => {
  test('is a tuple of all provider methods', () => {
    expectTypeOf<Schema.Viem[0]['Method']>().toEqualTypeOf<'eth_accounts'>()
    expectTypeOf<Schema.Viem[18]['Method']>().toEqualTypeOf<'wallet_switchEthereumChain'>()
  })
})

describe('Request', () => {
  test('is a discriminated union of all methods', () => {
    type Methods = Schema.Request['method']
    expectTypeOf<Methods>().toEqualTypeOf<
      | 'eth_chainId'
      | 'eth_fillTransaction'
      | 'eth_accounts'
      | 'eth_requestAccounts'
      | 'eth_sendTransaction'
      | 'eth_signTransaction'
      | 'eth_signTypedData_v4'
      | 'personal_sign'
      | 'wallet_connect'
      | 'wallet_disconnect'
      | 'wallet_getCallsStatus'
      | 'wallet_getCapabilities'
      | 'wallet_sendCalls'
      | 'wallet_switchEthereumChain'
      | 'wallet_authorizeAccessKey'
      | 'eth_sendTransactionSync'
      | 'wallet_deposit'
      | 'wallet_getBalances'
      | 'wallet_revokeAccessKey'
    >()
  })

  test('wallet_switchEthereumChain has decoded params', () => {
    type SwitchChain = Extract<Schema.Request, { method: 'wallet_switchEthereumChain' }>
    expectTypeOf<SwitchChain['params']>().toEqualTypeOf<readonly [{ chainId: number }]>()
  })

  test('eth_accounts has no params', () => {
    type EthAccounts = Extract<Schema.Request, { method: 'eth_accounts' }>
    expectTypeOf<EthAccounts>().not.toHaveProperty('params')
  })

  test('wallet_connect params are optional', () => {
    type WalletConnect = Extract<Schema.Request, { method: 'wallet_connect' }>
    expectTypeOf<WalletConnect>().toMatchTypeOf<{ method: 'wallet_connect' }>()
  })
})
