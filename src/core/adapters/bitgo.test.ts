import { describe, expect, test } from 'vp/test'

import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import { bitgo } from './bitgo.js'

const accessToken = process.env.VITE_BITGO_ACCESS_TOKEN
const walletId = process.env.VITE_BITGO_WALLET_ID
const walletPassphrase = process.env.VITE_BITGO_WALLET_PASSPHRASE ?? ''
const coin = process.env.VITE_BITGO_COIN ?? 'ttempo'

const enabled = !!(accessToken && walletId)

function createProvider(overrides: Partial<bitgo.Options> = {}) {
  return Provider.create({
    adapter: bitgo({
      accessToken: accessToken!,
      coin,
      walletId: walletId!,
      walletPassphrase,
      env: 'test',
      ...overrides,
    }),
    storage: Storage.memory(),
    testnet: true,
  })
}

describe.skipIf(!enabled)('bitgo', () => {
  test('wallet_connect discovers the BitGo wallet base address', async () => {
    const provider = createProvider()

    const accounts = await provider.request({ method: 'wallet_connect' })

    expect(accounts.length).toBe(1)
    expect(accounts[0]).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('wallet_connect populates the provider store', async () => {
    const provider = createProvider()

    await provider.request({ method: 'wallet_connect' })
    const state = provider.store.getState()

    expect(state.accounts.length).toBe(1)
    expect(state.accounts[0]?.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
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

    expect(accounts.length).toBe(1)
    expect(accounts[0]).toMatch(/^0x[0-9a-fA-F]{40}$/)
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
    const [account] = await provider.request({ method: 'eth_accounts' })

    const signature = await provider.request({
      method: 'personal_sign',
      params: ['0x68656c6c6f', account!],
    })

    expect(signature).toBeDefined()
    expect(signature.startsWith('0x')).toBe(true)
  })
})
