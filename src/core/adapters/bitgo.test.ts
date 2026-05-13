import { describe, expect, test } from 'vp/test'

import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import { bitgo } from './bitgo.js'

const accessToken = 'v2xddc0e59a2e7211b3b336c92805b2e715073c0145670b62f1a66a43551f64a23a'
const walletId = '6a03beb5464739a03ca8be8a6a4ab1ba'
const coin = 'ttempo'
const walletAddress = '0xc58d556ed56f7a32f608a5b0c2a5ff3446143872'

function createProvider(overrides: Partial<bitgo.Options> = {}) {
  return Provider.create({
    adapter: bitgo({
      accessToken,
      coin,
      walletId,
      walletPassphrase: '',
      env: 'test',
      ...overrides,
    }),
    storage: Storage.memory(),
    testnet: true,
  })
}

describe('bitgo', () => {
  test('wallet_connect discovers the BitGo wallet base address', async () => {
    const provider = createProvider()

    const accounts = await provider.request({ method: 'wallet_connect' })

    expect(accounts).toMatchInlineSnapshot(`
      [
        "${walletAddress}",
      ]
    `)
  })

  test('wallet_connect populates the provider store', async () => {
    const provider = createProvider()

    await provider.request({ method: 'wallet_connect' })
    const state = provider.store.getState()

    expect(state.accounts.length).toMatchInlineSnapshot(`1`)
    expect(state.accounts[0]?.address.toLowerCase()).toBe(walletAddress.toLowerCase())
  })

  test('wallet_disconnect clears the provider store', async () => {
    const provider = createProvider()

    await provider.request({ method: 'wallet_connect' })
    expect(provider.store.getState().accounts.length).toBe(1)

    await provider.request({ method: 'wallet_disconnect' })
    expect(provider.store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('eth_accounts returns connected accounts', async () => {
    const provider = createProvider()

    await provider.request({ method: 'wallet_connect' })
    const accounts = await provider.request({ method: 'eth_accounts' })

    expect(accounts).toMatchInlineSnapshot(`
      [
        "${walletAddress}",
      ]
    `)
  })

  test('eth_accounts returns empty before connect', async () => {
    const provider = createProvider()

    const accounts = await provider.request({ method: 'eth_accounts' })

    expect(accounts).toMatchInlineSnapshot(`[]`)
  })

  test('invalid access token fails authentication', async () => {
    const provider = createProvider({ accessToken: 'v2x-invalid-token' })

    await expect(
      provider.request({ method: 'wallet_connect' }),
    ).rejects.toThrow()
  })

  // Signing tests are skipped because the test wallet is custodial and
  // BitGo does not allow custodial signing on testnet.
  // To test signing, a self-custody MPC hot wallet + BitGo Express is required.
  test.skip('personal_sign signs a message', async () => {
    const provider = createProvider()
    await provider.request({ method: 'wallet_connect' })

    const signature = await provider.request({
      method: 'personal_sign',
      params: ['0x68656c6c6f', walletAddress],
    })

    expect(signature).toBeDefined()
    expect(signature.startsWith('0x')).toBe(true)
  })
})
