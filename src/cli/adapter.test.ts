import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { chain, getClient } from '../../test/config.js'
import * as Account from '../core/Account.js'
import * as Storage from '../core/Storage.js'
import * as Store from '../core/Store.js'
import * as Rpc from '../core/zod/rpc.js'
import { cli } from './adapter.js'

describe('cli', () => {
  test('error: rejects unsupported T5 fields for wallet_authorizeAccessKey', async () => {
    const { adapter } = setup()
    const parameters: Rpc.wallet_authorizeAccessKey.Decoded['params'][number] = {
      account: '0x0000000000000000000000000000000000000001',
      expiry: 0,
    }

    await expect(
      adapter.actions.authorizeAccessKey!(parameters, {
        method: 'wallet_authorizeAccessKey',
        params: z.encode(Rpc.wallet_authorizeAccessKey.schema.params!, [parameters]),
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`authorizeAccessKey.account\`, \`authorizeAccessKey.isAdmin\`, and \`authorizeAccessKey.witness\` are not supported by the CLI adapter.]`,
    )
  })

  test('error: rejects unsupported T5 fields for wallet_connect login', async () => {
    const { adapter } = setup()

    await expect(
      adapter.actions.loadAccounts(
        {
          authorizeAccessKey: {
            expiry: 0,
            isAdmin: false,
          },
        },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`authorizeAccessKey.account\`, \`authorizeAccessKey.isAdmin\`, and \`authorizeAccessKey.witness\` are not supported by the CLI adapter.]`,
    )
  })

  test('error: rejects unsupported T5 fields for wallet_connect register', async () => {
    const { adapter } = setup()

    await expect(
      adapter.actions.createAccount(
        {
          authorizeAccessKey: {
            expiry: 0,
            witness: `0x${'11'.repeat(32)}`,
          },
          name: 'test',
        },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`authorizeAccessKey.account\`, \`authorizeAccessKey.isAdmin\`, and \`authorizeAccessKey.witness\` are not supported by the CLI adapter.]`,
    )
  })
})

function setup() {
  const storage = Storage.memory()
  const store = Store.create({ chainId: chain.id, storage })
  const adapter = cli({
    host: 'http://localhost/cli-auth',
    open() {
      throw new Error('Unexpected browser open.')
    },
  })({
    getAccount: (options) => Account.find({ ...options, signable: true, store }),
    getClient: () => getClient({ chain }) as never,
    storage,
    store,
  })
  return { adapter, store }
}
