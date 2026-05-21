import { Address, Hex, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits, type Address as viem_Address } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, chain, getClient } from '../../test/config.js'
import * as Storage from '../core/Storage.js'
import * as Provider from './Provider.js'

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

function createOpen(options: { mismatchFirstCall?: boolean | undefined } = {}) {
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

      if (!callback || !chainId || !pubKey || !state)
        throw new Error('Expected callback, chainId, pubKey, and state in auth URL.')

      const limits = authUrl.searchParams.get('limits')
      const keyType = authUrl.searchParams.get('keyType')
      if (keyType !== 'p256' && keyType !== 'secp256k1')
        throw new Error('Expected a managed key type in auth URL.')

      const keyAuthorization = await root.signKeyAuthorization(
        {
          accessKeyAddress:
            options.mismatchFirstCall && calls === 1
              ? accounts[1]!.address
              : Address.fromPublicKey(PublicKey.fromHex(pubKey as Hex.Hex)),
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

      const callbackUrl = new URL(callback)
      callbackUrl.searchParams.set('accountAddress', root.address)
      callbackUrl.searchParams.set('keyAuthorization', KeyAuthorization.serialize(keyAuthorization))
      const personalSign = authUrl.searchParams.get('personalSign')
      if (personalSign) {
        const { message } = JSON.parse(personalSign) as { message: string }
        callbackUrl.searchParams.set('personalSignMessage', message)
        callbackUrl.searchParams.set('signature', await root.signMessage({ message }))
      }
      callbackUrl.searchParams.set('state', state)
      return callbackUrl.toString()
    },
  }
}

describe('create', () => {
  test('behavior: reauthorizes the managed key when the saved authorization targets the wrong key', async () => {
    const secureStorage = Storage.memory()
    const browser = createOpen({ mismatchFirstCall: true })
    const provider = Provider.create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet-next.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      secureStorage,
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'Accounts RN Test' } }],
    })
    expect(result.accounts[0]!.address).toBe(root.address)

    await fund(root.address)

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall], feeToken: Addresses.pathUsd }],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    expect(browser.calls()).toMatchInlineSnapshot(`2`)
  })

  test('behavior: forwards showDeposit boolean to the mobile auth URL for registration', async () => {
    const browser = createOpen()
    const provider = Provider.create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet-next.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      secureStorage: Storage.memory(),
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
    const provider = Provider.create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet-next.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      secureStorage: Storage.memory(),
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
    const provider = Provider.create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet-next.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      secureStorage: Storage.memory(),
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

  test('behavior: forwards personalSign to the mobile auth URL and returns signature', async () => {
    const browser = createOpen()
    const provider = Provider.create({
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      chains: [chain],
      host: 'https://wallet-next.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      secureStorage: Storage.memory(),
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
})
