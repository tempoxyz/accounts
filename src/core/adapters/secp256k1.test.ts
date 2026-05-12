import { describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../../test/config.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import { secp256k1 } from './secp256k1.js'

describe('secp256k1', () => {
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
