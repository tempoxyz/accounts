import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vp/test'

import { accounts, chain } from '../../test/config.js'
import * as Keyring from './keyring.js'

const root = accounts[0]!
const accessKey = accounts[1]!
const accessKey_2 = accounts[2]!

async function createPath() {
  return join(await mkdtemp(join(tmpdir(), 'accounts-keyring-')), 'keys.toml')
}

describe('Keyring.find', () => {
  test('returns the newest key for a wallet and chain', async () => {
    const path = await createPath()

    await Keyring.upsert(
      {
        chainId: chain.id,
        expiry: 1,
        key: '0x11',
        keyAddress: accessKey.address,
        keyAuthorization: '0x22',
        keyType: 'secp256k1',
        walletAddress: root.address,
        walletType: 'passkey',
      },
      { path },
    )
    await Keyring.upsert(
      {
        chainId: chain.id,
        expiry: 2,
        key: '0x33',
        keyAddress: accessKey_2.address,
        keyAuthorization: '0x44',
        keyType: 'p256',
        walletAddress: root.address,
        walletType: 'passkey',
      },
      { path },
    )

    const entry = await Keyring.find({
      chainId: chain.id,
      path,
      walletAddress: root.address,
    })

    expect(entry).toMatchInlineSnapshot(`
      {
        "chainId": ${chain.id},
        "expiry": 2,
        "key": "0x33",
        "keyAddress": "${accessKey_2.address}",
        "keyAuthorization": "0x44",
        "keyType": "p256",
        "walletAddress": "${root.address}",
        "walletType": "passkey",
      }
    `)
  })

  test('filters by key type when requested', async () => {
    const path = await createPath()

    await Keyring.upsert(
      {
        chainId: chain.id,
        expiry: 1,
        key: '0x11',
        keyAddress: accessKey.address,
        keyAuthorization: '0x22',
        keyType: 'secp256k1',
        walletAddress: root.address,
        walletType: 'passkey',
      },
      { path },
    )
    await Keyring.upsert(
      {
        chainId: chain.id,
        expiry: 2,
        key: '0x33',
        keyAddress: accessKey_2.address,
        keyAuthorization: '0x44',
        keyType: 'p256',
        walletAddress: root.address,
        walletType: 'passkey',
      },
      { path },
    )

    const entry = await Keyring.find({
      chainId: chain.id,
      keyType: 'secp256k1',
      path,
      walletAddress: root.address,
    })

    expect(entry).toMatchInlineSnapshot(`
      {
        "chainId": ${chain.id},
        "expiry": 1,
        "key": "0x11",
        "keyAddress": "${accessKey.address}",
        "keyAuthorization": "0x22",
        "keyType": "secp256k1",
        "walletAddress": "${root.address}",
        "walletType": "passkey",
      }
    `)
  })
})
