import { describe, expect, test } from 'vp/test'

import { accounts } from '../../../test/config.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import { dangerous_secp256k1 } from './dangerous_secp256k1.js'

describe('dangerous_secp256k1', () => {
  test('behavior: account option pins the connected account', async () => {
    const account = accounts[1]!
    const provider = Provider.create({
      adapter: dangerous_secp256k1({ account }),
      storage: Storage.memory({ key: 'dangerous-secp256k1-account' }),
    })

    const result = await provider.request({ method: 'wallet_connect' })
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]!.address).toBe(account.address)

    const connected = await provider.request({ method: 'eth_accounts' })
    expect(connected).toHaveLength(1)
    expect(connected[0]).toBe(account.address)
  })
})
