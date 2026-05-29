import { describe, expect, test } from 'vp/test'

import { accounts, chain, privateKeys } from '../../../test/config.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { secp256k1 } from './secp256k1.js'

describe('secp256k1', () => {
  test('behavior: does not hydrate account without private key', async () => {
    const storage = Storage.memory({ key: 'secp256k1-invalid-account' })
    storage.setItem('store', {
      state: {
        accounts: [
          {
            address: '0x0000000000000000000000000000000000000001',
            keyType: 'secp256k1',
          },
        ],
        activeAccount: 0,
        chainId: chain.id,
      },
      version: 0,
    })
    const provider = Provider.create({ adapter: secp256k1(), chains: [chain], storage })

    await Store.waitForHydration(provider.store)

    await expect(provider.request({ method: 'eth_accounts' })).resolves.toMatchInlineSnapshot(
      `[]`,
    )
  })

  test('behavior: privateKey option pins the connected account', async () => {
    const account = accounts[1]!
    const provider = Provider.create({
      adapter: secp256k1({ privateKey: privateKeys[1]! }),
      storage: Storage.memory({ key: 'secp256k1-private-key' }),
    })

    const result = await provider.request({ method: 'wallet_connect' })
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]!.address).toBe(account.address)

    const connected = await provider.request({ method: 'eth_accounts' })
    expect(connected).toHaveLength(1)
    expect(connected[0]).toBe(account.address)
  })
})
