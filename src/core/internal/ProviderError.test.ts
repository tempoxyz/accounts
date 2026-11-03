import { Provider as ox_Provider } from 'ox'
import { InternalRpcError, TransactionExecutionError, UserRejectedRequestError } from 'viem'
import { describe, expect, test } from 'vp/test'

import * as ProviderError from './ProviderError.js'

function wrap(cause: Error) {
  return new TransactionExecutionError(cause as never, { account: null })
}

describe('parse', () => {
  test('behavior: recovers a user rejection wrapped by a viem action', () => {
    const rejection = new UserRejectedRequestError(new Error('Rejected'))
    expect(ProviderError.parse(wrap(rejection)) === rejection).toMatchInlineSnapshot(`true`)
    expect(ox_Provider.parseError(ProviderError.parse(wrap(rejection))).code).toMatchInlineSnapshot(
      `4001`,
    )
  })

  test('behavior: keeps a wrapper whose first coded cause is not a provider error', () => {
    const error = wrap(new InternalRpcError(new UserRejectedRequestError(new Error('Rejected'))))
    expect(ProviderError.parse(error) === error).toMatchInlineSnapshot(`true`)
  })

  test('behavior: keeps coded and non-viem errors', () => {
    const rejection = new UserRejectedRequestError(new Error('Rejected'))
    const plain = new Error('Revocation is not confirmed', { cause: rejection })
    expect(ProviderError.parse(rejection) === rejection).toMatchInlineSnapshot(`true`)
    expect(ProviderError.parse(plain) === plain).toMatchInlineSnapshot(`true`)
  })
})
