/**
 * Tests the refusals that cross Durable Object RPC as data, through `structuredClone`, which keeps
 * no error's class, as RPC does.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Rpc from './Rpc.js'

describe('Rpc', () => {
  test('carries RedirectUriRequiredError across RPC as its class', async () => {
    const result = await Rpc.wrap(() =>
      Promise.reject(new Accounts.RedirectUriRequiredError()),
    ).then(
      (wrapped) => structuredClone(wrapped),
      (error: unknown) => error,
    )

    const error = (() => {
      try {
        return Rpc.unwrap(result as Rpc.Result<never>)
      } catch (error) {
        return error
      }
    })()

    expect(error).toBeInstanceOf(Accounts.RedirectUriRequiredError)
  })
})
