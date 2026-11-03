import { Actions } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { vi } from 'vitest'
import { afterEach, describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

vi.mock('viem/tempo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/tempo')>()
  return { ...actual, Actions: { ...actual.Actions, accessKey: { ...actual.Actions.accessKey } } }
})
afterEach(() => vi.restoreAllMocks())

describe('wallet_revokeAccessKey fallback', () => {
  test.each(['pending', 'reverted', 'success'] as const)(
    'shared fallback retains local authority until receipt is successful: %s',
    async (status) => {
      const payer = accounts[0]!
      const revoke = vi.spyOn(Actions.accessKey, 'revokeSync').mockResolvedValue({
        receipt: { status },
      } as never)
      const provider = Provider.create({
        adapter: Adapter.define({ name: 'Local test', rdns: 'test.local' }, () => ({
          actions: {
            async createAccount() {
              return { accounts: [{ address: payer.address }] }
            },
            async loadAccounts() {
              return { accounts: [{ address: payer.address }] }
            },
          },
          getAccount: () => ({ account: payer }),
        })),
        chains: [tempo],
        storage: Storage.memory(),
      })
      await provider.store.accessKeys.authorize({
        account: payer,
        chainId: tempo.id,
        parameters: { privateKey: privateKeys[2], expiry: 9999999999 },
      })
      provider.store.setState({ accounts: [{ address: payer.address }], activeAccount: 0 })
      const key = provider.store.getState().accessKeys[0]!
      const request = provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address: payer.address, accessKeyAddress: key.address }],
      })
      if (status === 'success') await request
      else await expect(request).rejects.toThrow('Access-key revocation is not confirmed')
      expect(revoke).toHaveBeenCalledTimes(1)
      expect(provider.store.getState().accessKeys.length).toBe(status === 'success' ? 0 : 1)
    },
  )
})
