import { Address, Hex, Json, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits, type Address as viem_Address } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, chain, getClient } from '../../test/config.js'
import * as Provider from '../core/Provider.js'
import * as Storage from '../core/Storage.js'
import * as Store from '../core/Store.js'
import { reactNative } from './adapter.js'

const root = accounts[0]!
const transferCall = Actions.token.transfer.call({
  to: '0x0000000000000000000000000000000000000001',
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

async function fund(address: viem_Address) {
  await Actions.token.transferSync(getClient(), {
    account: root,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}

function asyncJsonStorage(options: Storage.from.Options = {}) {
  const store = new Map<string, string>()
  return Storage.from(
    {
      async getItem(name) {
        const raw = store.get(name)
        if (!raw) return null
        return Json.parse(raw)
      },
      async setItem(name, value) {
        store.set(name, Json.stringify(value))
      },
      async removeItem(name) {
        store.delete(name)
      },
    },
    options,
  )
}

function createOpen() {
  let calls = 0
  const urls: string[] = []

  return {
    calls: () => calls,
    urls: () => urls,
    open: async (url: string) => {
      calls += 1
      urls.push(url)

      const authUrl = new URL(url)
      const callback = authUrl.searchParams.get('callback')
      const chainId = authUrl.searchParams.get('chainId')
      const pubKey = authUrl.searchParams.get('pubKey')
      const state = authUrl.searchParams.get('state')

      if (!callback || !chainId || !state)
        throw new Error('Expected callback, chainId, and state in auth URL.')

      const callbackUrl = new URL(callback)
      callbackUrl.searchParams.set('accountAddress', root.address)
      if (pubKey) {
        const limits = authUrl.searchParams.get('limits')
        const keyType = authUrl.searchParams.get('keyType')
        if (keyType !== 'p256' && keyType !== 'secp256k1')
          throw new Error('Expected a managed key type in auth URL.')

        const keyAuthorization = await root.signKeyAuthorization(
          {
            accessKeyAddress: Address.fromPublicKey(PublicKey.fromHex(pubKey as Hex.Hex)),
            keyType,
          },
          {
            chainId: BigInt(chainId),
            ...(authUrl.searchParams.get('expiry')
              ? { expiry: Number(authUrl.searchParams.get('expiry')) }
              : {}),
            ...(limits
              ? {
                  limits: (JSON.parse(limits) as { token: `0x${string}`; limit: string }[]).map(
                    (x) => ({
                      limit: BigInt(x.limit),
                      token: x.token,
                    }),
                  ),
                }
              : {}),
          },
        )
        callbackUrl.searchParams.set(
          'keyAuthorization',
          KeyAuthorization.serialize(keyAuthorization),
        )
      }
      const personalSign = authUrl.searchParams.get('personalSign')
      if (personalSign) {
        const { message } = JSON.parse(personalSign) as { message: string }
        callbackUrl.searchParams.set('personalSignMessage', message)
        callbackUrl.searchParams.set('signature', await root.signMessage({ message }))
      }
      const digest = authUrl.searchParams.get('digest') as Hex.Hex | null
      if (digest) callbackUrl.searchParams.set('signature', await root.sign({ hash: digest }))
      callbackUrl.searchParams.set('state', state)
      return callbackUrl.toString()
    },
  }
}

describe('create', () => {
  test('behavior: persists managed access keys through provider storage', async () => {
    const storage = asyncJsonStorage({ key: 'react-native-managed-key' })
    const browser = createOpen()
    const provider1 = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage,
    })

    const result = await provider1.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'Accounts RN Test' } }],
    })
    expect(result.accounts[0]!.address).toBe(root.address)

    await fund(root.address)

    const provider2 = create({
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage,
    })
    await Store.waitForHydration(provider2.store)

    const receipt = await provider2.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall], feeToken: Addresses.pathUsd }],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    expect(browser.calls()).toMatchInlineSnapshot(`1`)
  })

  test('behavior: wallet_connect does not require authorizeAccessKey capability', async () => {
    const browser = createOpen()
    const provider = create({
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', showDeposit: true } }],
    })
    const url = new URL(browser.urls()[0]!)

    expect(url.searchParams.get('pubKey')).toMatchInlineSnapshot(`null`)
    expect(url.searchParams.get('showDeposit')).toMatchInlineSnapshot(`"true"`)
    expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
  })

  test('behavior: forwards showDeposit boolean to the mobile auth URL for registration', async () => {
    const browser = createOpen()
    const provider = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', showDeposit: true } }],
    })

    expect(new URL(browser.urls()[0]!).pathname).toMatchInlineSnapshot(`"/remote/auth/mobile"`)
    expect(new URL(browser.urls()[0]!).searchParams.get('showDeposit')).toMatchInlineSnapshot(
      `"true"`,
    )
  })

  test('behavior: forwards showDeposit boolean to the mobile auth URL for login', async () => {
    const browser = createOpen()
    const provider = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', showDeposit: true } }],
    })

    expect(new URL(browser.urls()[0]!).searchParams.get('showDeposit')).toMatchInlineSnapshot(
      `"true"`,
    )
  })

  test('behavior: forwards showDeposit params to the mobile auth URL for registration', async () => {
    const browser = createOpen()
    const provider = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            method: 'register',
            showDeposit: {
              amount: '50',
              displayName: 'DoorDash',
              on: 'register',
              token: 'USDC',
            },
          },
        },
      ],
    })

    expect(JSON.parse(new URL(browser.urls()[0]!).searchParams.get('showDeposit')!))
      .toMatchInlineSnapshot(`
      {
        "amount": "50",
        "displayName": "DoorDash",
        "on": "register",
        "token": "USDC",
      }
    `)
  })

  test('behavior: forwards showDeposit params to the mobile auth URL for wallet_authorizeAccessKey', async () => {
    const browser = createOpen()
    const provider = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [
        {
          expiry: Math.floor(Date.now() / 1000) + 3600,
          showDeposit: {
            amount: '25',
            token: 'USDC',
          },
        },
      ],
    })

    expect(JSON.parse(new URL(browser.urls()[1]!).searchParams.get('showDeposit')!))
      .toMatchInlineSnapshot(`
      {
        "amount": "25",
        "token": "USDC",
      }
    `)
  })

  test('behavior: forwards personalSign to the mobile auth URL and returns signature', async () => {
    const browser = createOpen()
    const provider = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', personalSign: { message: 'hello' } } }],
    })

    expect(new URL(browser.urls()[0]!).searchParams.get('personalSign')).toMatchInlineSnapshot(
      `"{"message":"hello"}"`,
    )
    expect(result.accounts[0]!.capabilities.personalSign).toEqual({ message: 'hello' })
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: forwards digest to the mobile auth URL and returns signature', async () => {
    const browser = createOpen()
    const provider = create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })

    const digest = Hex.random(32)
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { digest, method: 'login' } }],
    })

    expect(new URL(browser.urls()[0]!).searchParams.get('digest')).toMatchInlineSnapshot(
      `"${digest}"`,
    )
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
  })
})

function create(options: create.Options): create.ReturnType {
  const { host, open, redirectUri, ...rest } = options
  return Provider.create({
    ...rest,
    adapter: reactNative({
      host,
      ...(open ? { open } : {}),
      redirectUri,
    }),
  })
}

declare namespace create {
  type Options = Omit<Provider.create.Options, 'adapter'> & reactNative.Options
  type ReturnType = Provider.create.ReturnType
}
