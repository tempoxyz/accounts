import { createClient, http } from 'viem'
import { tempoLocalnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'

import { accounts as core_accounts, privateKeys, webAuthnAccounts } from '../../../test/config.js'
import * as Account from '../Account.js'
import * as Store from '../Store.js'
import { local } from './local.js'

describe('local', () => {
  describe('loadAccounts', () => {
    test('default: loads accounts', async () => {
      const { adapter } = setup()

      const { accounts } = await adapter.actions.loadAccounts()

      expect(accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
        ]
      `)
    })
  })

  describe('createAccount', () => {
    test('default: creates account', async () => {
      const { adapter } = setup({
        createAccount: async () => ({
          accounts: [
            {
              address: core_accounts[1].address,
              keyType: 'secp256k1',
              privateKey: privateKeys[1],
            },
          ],
        }),
      })

      const { accounts } = await adapter.actions.createAccount({ name: 'test' })

      expect(accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        ]
      `)
    })

    test('error: throws when createAccount not configured', async () => {
      const { adapter } = setup()

      await expect(adapter.actions.createAccount({ name: 'test' })).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`createAccount\` not configured on adapter.]`,
      )
    })
  })
})

function setup(overrides: Partial<local.Options> = {}) {
  const adapter = local({
    loadAccounts: async () => ({
      accounts: [
        {
          address: webAuthnAccounts[0]!.address,
          keyType: 'webAuthn_headless' as const,
          privateKey: privateKeys[0]!,
          rpId: 'example.com',
          origin: 'https://example.com',
        },
      ],
    }),
    ...overrides,
  })
  const store = Store.create({ chainId: tempoLocalnet.id })
  adapter.setup?.({
    getAccount: (address) => Account.find({ address, signable: true, store }),
    getClient: () => createClient({ chain: tempoLocalnet, transport: http() }) as never,
    store,
  })
  return { adapter, store }
}
