import { Address, Base64, Hex, Json, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, chain, privateKeys } from '../../test/config.js'
import * as Storage from '../core/Storage.js'
import * as Provider from './Provider.js'

const root = accounts[0]!

type RpcRequest = {
  id: number
  jsonrpc: '2.0'
  method: string
  params?: readonly unknown[] | undefined
}

type AccessKeyParameters = {
  address?: Address.Address | undefined
  chainId?: bigint | number | undefined
  expiry: number
  keyType?: 'p256' | 'secp256k1' | 'webAuthn' | undefined
  limits?:
    | readonly { token: Address.Address; limit: bigint; period?: number | undefined }[]
    | undefined
  publicKey?: Hex.Hex | undefined
}

function createOpen() {
  const requests: RpcRequest[] = []
  const urls: string[] = []

  return {
    requests: () => requests,
    urls: () => urls,
    open: async (url: string) => {
      urls.push(url)

      const authUrl = new URL(url)
      const callback = authUrl.searchParams.get('callback')
      const message = authUrl.searchParams.get('message')
      const state = authUrl.searchParams.get('state')
      if (!callback || !message || !state)
        throw new Error('Expected callback, message, and state in auth URL.')

      const request = decode<RpcRequest>(message)
      requests.push(request)

      const callbackUrl = new URL(callback)
      callbackUrl.searchParams.set('state', state)
      callbackUrl.searchParams.set(
        'message',
        encode({ id: request.id, jsonrpc: '2.0', result: await handleRequest(request) } as const),
      )
      return callbackUrl.toString()
    },
  }
}

describe('create', () => {
  test('behavior: opens a single mobile auth JSON-RPC request', async () => {
    const browser = createOpen()
    const provider = Provider.create({
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
      params: [{ capabilities: { method: 'register', name: 'Accounts RN Test' } }],
    })

    const authUrl = new URL(browser.urls()[0]!)
    expect({
      callback: authUrl.searchParams.get('callback'),
      host: authUrl.origin,
      message: Boolean(authUrl.searchParams.get('message')),
      path: authUrl.pathname,
      pubkey: Boolean(authUrl.searchParams.get('pubkey')),
      state: Boolean(authUrl.searchParams.get('state')),
      version: authUrl.searchParams.get('version'),
    }).toMatchInlineSnapshot(`
      {
        "callback": "accounts-playground://auth",
        "host": "https://wallet.tempo.xyz",
        "message": true,
        "path": "/remote/auth/mobile",
        "pubkey": true,
        "state": true,
        "version": "1",
      }
    `)
    expect(browser.requests()[0]?.method).toMatchInlineSnapshot(`"wallet_connect"`)
  })

  test('behavior: forwards showDeposit boolean to the mobile auth request for registration', async () => {
    const browser = createOpen()
    const provider = Provider.create({
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

    expect(getCapabilities(browser.requests()[0]!).showDeposit).toMatchInlineSnapshot(`true`)
  })

  test('behavior: forwards showDeposit boolean to the mobile auth request for login', async () => {
    const browser = createOpen()
    const provider = Provider.create({
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

    expect(getCapabilities(browser.requests()[0]!).showDeposit).toMatchInlineSnapshot(`true`)
  })

  test('behavior: forwards showDeposit params to the mobile auth request for registration', async () => {
    const browser = createOpen()
    const provider = Provider.create({
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

    expect(getCapabilities(browser.requests()[0]!).showDeposit).toMatchInlineSnapshot(`
      {
        "amount": "50",
        "displayName": "DoorDash",
        "on": "register",
        "token": "USDC",
      }
    `)
  })

  test('behavior: forwards showDeposit params to the mobile auth request for wallet_authorizeAccessKey', async () => {
    const browser = createOpen()
    const provider = Provider.create({
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
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

    expect(getParameters(browser.requests()[0]!).showDeposit).toMatchInlineSnapshot(`
      {
        "amount": "25",
        "token": "USDC",
      }
    `)
  })

  test('behavior: forwards public material for a provided private key', async () => {
    const browser = createOpen()
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const provider = Provider.create({
      chains: [chain],
      host: 'https://wallet.tempo.xyz',
      open: browser.open,
      redirectUri: 'accounts-playground://auth',
      storage: Storage.memory(),
    })
    const privateKey = privateKeys[1]!
    const accessKey = TempoAccount.fromSecp256k1(privateKey)

    await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [
        {
          expiry: expiresAt,
          keyType: 'secp256k1',
          privateKey,
        },
      ],
    })

    const { expiry, keyType, publicKey } = getParameters(browser.requests()[0]!)
    expect({ expiry, keyType, publicKey }).toMatchInlineSnapshot(`
      {
        "expiry": ${expiresAt},
        "keyType": "secp256k1",
        "publicKey": "${accessKey.publicKey}",
      }
    `)
  })

  test('behavior: forwards personalSign to the mobile auth request and returns signature', async () => {
    const browser = createOpen()
    const provider = Provider.create({
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

    expect(getCapabilities(browser.requests()[0]!).personalSign).toMatchInlineSnapshot(`
      {
        "message": "hello",
      }
    `)
    expect(result.accounts[0]!.capabilities.personalSign).toMatchInlineSnapshot(`
      {
        "message": "hello",
      }
    `)
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
  })
})

async function handleRequest(request: RpcRequest) {
  if (request.method === 'wallet_connect') {
    const capabilities = getCapabilities(request)
    const keyAuthorization = capabilities.authorizeAccessKey
      ? await signKeyAuthorization(capabilities.authorizeAccessKey)
      : undefined
    const signature = capabilities.personalSign
      ? await root.signMessage({ message: capabilities.personalSign.message })
      : undefined
    return {
      accounts: [
        {
          address: root.address,
          capabilities: {
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(capabilities.personalSign ? { personalSign: capabilities.personalSign } : {}),
            ...(signature ? { signature } : {}),
          },
        },
      ],
    }
  }

  if (request.method === 'wallet_authorizeAccessKey')
    return {
      keyAuthorization: await signKeyAuthorization(getParameters(request)),
      rootAddress: root.address,
    }

  throw new Error(`Unsupported request method: ${request.method}`)
}

async function signKeyAuthorization(parameters: AccessKeyParameters) {
  if (!parameters.address && !parameters.publicKey) throw new Error('Expected access key material.')
  const keyAuthorization = await root.signKeyAuthorization(
    {
      accessKeyAddress:
        parameters.address ?? Address.fromPublicKey(PublicKey.fromHex(parameters.publicKey!)),
      keyType: parameters.keyType ?? 'secp256k1',
    },
    {
      chainId: BigInt(parameters.chainId ?? chain.id),
      expiry: parameters.expiry,
      ...(parameters.limits ? { limits: parameters.limits } : {}),
    },
  )
  return KeyAuthorization.toRpc(keyAuthorization)
}

function getCapabilities(request: RpcRequest) {
  return (getParameters(request).capabilities ?? {}) as {
    authorizeAccessKey?: AccessKeyParameters | undefined
    personalSign?: { message: string } | undefined
    showDeposit?: unknown
  }
}

function getParameters(request: RpcRequest) {
  return (request.params?.[0] ?? {}) as AccessKeyParameters & {
    capabilities?: Record<string, unknown> | undefined
    showDeposit?: unknown
  }
}

function encode(value: unknown) {
  return Base64.fromString(Json.stringify(value), { pad: false, url: true })
}

function decode<type>(value: string): type {
  return Json.parse(Base64.toString(value)) as type
}
