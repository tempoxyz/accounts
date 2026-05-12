import { describe, expect, test } from 'vp/test'

import { accounts as core_accounts, privateKeys } from '../../../test/config.js'
import * as Account from '../Account.js'
import type * as Adapter from '../Adapter.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { local } from './local.js'

const account = core_accounts[0]
const account_other = core_accounts[1]

describe('local', () => {
  test('default: loadAccounts hydrates the first returned store account', async () => {
    const { adapter } = setup()

    const result = await adapter.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: undefined,
    })

    expect(result.accounts.map((account) => account.address)).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
  })

  test('default: createAccount delegates and hydrates created account', async () => {
    const { adapter } = setup({
      createAccount: async () => ({
        accounts: [storeAccountFor(account_other)],
      }),
    })

    const result = await adapter.actions.createAccount(
      { name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(result.accounts.map((account) => account.address)).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
  })

  test('behavior: shared connect-only fields are not passed to app callbacks', async () => {
    const calls: Adapter.loadAccounts.Parameters[] = []
    const { adapter } = setup({
      loadAccounts: async (parameters = {}) => {
        calls.push(parameters)
        return { accounts: [storeAccountFor(account)] }
      },
    })

    await adapter.actions.loadAccounts(
      {
        authorizeAccessKey: { expiry: 123 },
        personalSign: { message: 'hello' },
      },
      { method: 'wallet_connect', params: undefined },
    )

    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "digest": "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
        },
      ]
    `)
  })

  test('default: local hydrated accounts can sign through the base actions', async () => {
    const { adapter, store } = setup()
    store.setState({ accounts: [storeAccountFor(account)], activeAccount: 0 })

    const result = await adapter.actions.signPersonalMessage(
      { address: account.address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', account.address] },
    )

    expect(!!result).toMatchInlineSnapshot(`true`)
  })

  test('error: throws when createAccount is not configured', async () => {
    const { adapter } = setup()

    await expect(
      adapter.actions.createAccount(
        { name: 'Ada' },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnsupportedMethodError: \`createAccount\` not configured on adapter.]`,
    )
  })
})

function setup(overrides: Partial<local.Options> = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const adapter = local({
    loadAccounts: async () => ({ accounts: [storeAccountFor(account)] }),
    ...overrides,
  })({
    getAccount: (options) => Account.find({ ...options, signable: true, store }),
    getClient: (() => ({ chain: { id: 1 } })) as never,
    storage,
    store,
  })
  return { adapter, store }
}

function storeAccountFor(account: (typeof core_accounts)[number]): Account.Store {
  const index = core_accounts.findIndex((candidate) => candidate.address === account.address)
  return {
    address: account.address,
    keyType: 'secp256k1',
    privateKey: privateKeys[index]!,
  }
}
