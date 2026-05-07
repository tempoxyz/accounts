import { describe, expectTypeOf, test } from 'vp/test'

import type { turnkey } from './turnkey.js'

describe('turnkey types', () => {
  test('options keep Turnkey hook params narrow', () => {
    expectTypeOf<turnkey.Options['selectAccount']>().toMatchTypeOf<
      | ((
          accounts: readonly turnkey.WalletAccount[],
          context: turnkey.Context,
        ) => Promise<turnkey.WalletAccount | undefined> | turnkey.WalletAccount | undefined)
      | undefined
    >()
  })

  test('raw payload signing exposes Turnkey encodings', () => {
    expectTypeOf<turnkey.SignRawPayloadParameters>().toMatchTypeOf<{
      encoding:
        | 'PAYLOAD_ENCODING_HEXADECIMAL'
        | 'PAYLOAD_ENCODING_TEXT_UTF8'
        | 'PAYLOAD_ENCODING_EIP712'
        | 'PAYLOAD_ENCODING_EIP7702_AUTHORIZATION'
      hashFunction:
        | 'HASH_FUNCTION_NO_OP'
        | 'HASH_FUNCTION_SHA256'
        | 'HASH_FUNCTION_KECCAK256'
        | 'HASH_FUNCTION_NOT_APPLICABLE'
      payload: string
      signWith: string
    }>()
  })
})
