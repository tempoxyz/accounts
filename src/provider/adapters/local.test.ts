import { createClient, http } from 'viem'
import { tempoLocalnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { local } from '../../../test/adapters.js'
import { accounts as core_accounts, privateKeys } from '../../../test/config.js'
import * as Account from '../Account.js'
import * as Store from '../Store.js'

function setup(options: local.Options = {}) {
  const adapter = local(options)
  const store = Store.create({ chainId: tempoLocalnet.id })
  adapter.setup?.({
    getAccount: (address) => Account.fromAddress({ address, signable: true, store }),
    getClient: () => createClient({ chain: tempoLocalnet, transport: http() }) as never,
    store,
  })
  return { adapter, store }
}

describe('local', () => {
  describe('loadAccounts', () => {
    test('default: loads accounts and updates store', async () => {
      const { adapter, store } = setup()

      const accounts = await adapter.actions.loadAccounts()

      expect(accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        ]
      `)
      expect(store.getState().status).toMatchInlineSnapshot(`"connected"`)
      expect(store.getState().accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        ]
      `)
    })
  })

  describe('createAccount', () => {
    test('default: creates account and updates store', async () => {
      const { adapter, store } = setup({
        createAccounts: [
          {
            address: core_accounts[1].address,
            sign: { keyType: 'secp256k1', privateKey: privateKeys[1] },
          },
        ],
      })

      const accounts = await adapter.actions.createAccount()

      expect(accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        ]
      `)
      expect(store.getState().status).toMatchInlineSnapshot(`"connected"`)
    })

    test('error: throws when createAccount not configured', async () => {
      const { adapter } = setup()

      await expect(adapter.actions.createAccount()).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: \`createAccount\` not configured on adapter.]`,
      )
    })
  })

  describe('disconnect', () => {
    test('default: clears accounts and sets disconnected', async () => {
      const { adapter, store } = setup()

      await adapter.actions.loadAccounts()
      expect(store.getState().status).toMatchInlineSnapshot(`"connected"`)

      await adapter.actions.disconnect()

      expect(store.getState()).toMatchInlineSnapshot(`
        {
          "accounts": [],
          "activeAccount": 0,
          "chainId": 1337,
          "status": "disconnected",
        }
      `)
    })
  })

  describe('switchChain', () => {
    test('default: updates chainId in store', async () => {
      const { adapter, store } = setup()

      await adapter.actions.switchChain({ chainId: 42 })

      expect(store.getState().chainId).toMatchInlineSnapshot(`42`)
    })
  })
})
