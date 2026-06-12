import { Address, Base64, Bytes, Hex, Json, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits, type Address as viem_Address } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'
import { Identity, type MobileWebAuth } from 'wata'
import { Wata as HostWata, mobileWebAuth as hostMobileWebAuth } from 'wata/host'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../../../test/config.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import * as Store from '../../Store.js'
import * as Rpc from '../../zod/rpc.js'
import { mobileWebAuth } from './mobileWebAuth.js'
import { tempoWallet } from './tempoWallet.js'

const callback = 'xyz.tempo.accounts.playground:/auth'
const consumerOrigin = 'https://accounts-playground.example'
const hostIdentity = Base64.fromBytes(Bytes.random(32), { pad: false, url: true })
const hostOrigin = 'https://wallet.tempo.xyz'
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

function createWallet() {
  let calls = 0
  const fetches: string[] = []
  const requests: { method: string; params: unknown }[] = []

  return {
    calls: () => calls,
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init)
      fetches.push(request.url)
      if (request.url === `${hostOrigin}/.well-known/urpc/host.json`)
        return Response.json({
          id: 'wallet.tempo.xyz',
          identity_pubkey: hostIdentity,
          name: 'Tempo Wallet',
          origin: hostOrigin,
          transports: {
            'mobile-web-auth': { auth_url: `${hostOrigin}/auth/mobile` },
          },
          version: '1.0',
        })
      throw new Error(`unexpected fetch to ${request.url}`)
    },
    fetches: () => fetches,
    requests: () => requests,
    openAuthSession: (async ({ authorizationUrl }) => {
      calls += 1
      const host = createHost(requests)
      const response = await host.fetch(new Request(authorizationUrl))
      return response.headers.get('location') ?? undefined
    }) satisfies NonNullable<MobileWebAuth.Options['openAuthSession']>,
  }
}

function createHost(requests: { method: string; params: unknown }[]) {
  const host = HostWata.create({
    baseUrl: hostOrigin,
    identity: Identity.fromPrivateKey(
      '0x2222222222222222222222222222222222222222222222222222222222222222',
    ),
    meta: { name: 'Tempo Wallet' },
    transports: [
      hostMobileWebAuth({
        fetch: async (input): Promise<Response> => {
          const url = input instanceof Request ? input.url : String(input)
          if (url === `${consumerOrigin}/.well-known/urpc/consumer.json`)
            return Response.json({
              callback_urls: [callback],
              id: 'accounts-playground.example',
              name: 'Accounts RN Test',
              origin: consumerOrigin,
              version: '1.0',
            })
          throw new Error(`unexpected fetch to ${url}`)
        },
        html: {
          authenticate: ({ actions }) => actions.approve(),
        },
        path: '/auth/mobile',
      }),
    ],
  })

  host.on('request', async (event) => {
    requests.push({ method: event.method, params: event.params })
    if (event.method === 'wallet_connect') {
      const [parameters] = z.decode(Rpc.wallet_connect.schema.params!, event.params as never) ?? []
      const capabilities = parameters?.capabilities
      const authorization = capabilities?.authorizeAccessKey
      await event.respond({
        accounts: [
          {
            address: root.address,
            capabilities: {
              ...(authorization
                ? {
                    keyAuthorization: KeyAuthorization.toRpc(
                      await signKeyAuthorization(authorization),
                    ),
                  }
                : {}),
              ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
              ...(await signature(capabilities)),
            },
          },
        ],
      })
      return
    }
    if (event.method === 'wallet_authorizeAccessKey') {
      const [parameters] = z.decode(
        Rpc.wallet_authorizeAccessKey.schema.params!,
        event.params as never,
      )
      await event.respond({
        keyAuthorization: KeyAuthorization.toRpc(await signKeyAuthorization(parameters)),
        rootAddress: root.address,
      })
      return
    }
    if (event.method === 'personal_sign') {
      const [data] = z.decode(Rpc.personal_sign.schema.params!, event.params as never)
      await event.respond(await root.signMessage({ message: { raw: data } }))
      return
    }
    if (event.method === 'wallet_deposit') {
      await event.respond({ receipts: [] })
      return
    }
    if (event.method === 'wallet_revokeAccessKey') {
      await event.respond(null)
    }
  })

  return host
}

async function signKeyAuthorization(parameters: AdapterAuthorizeParameters) {
  return await root.signKeyAuthorization(
    {
      accessKeyAddress: accessKeyAddress(parameters),
      keyType: parameters.keyType ?? 'p256',
    },
    {
      chainId: parameters.chainId ?? BigInt(chain.id),
      expiry: parameters.expiry,
      ...(parameters.limits ? { limits: parameters.limits } : {}),
    },
  )
}

function accessKeyAddress(parameters: AdapterAuthorizeParameters) {
  if (parameters.address) return parameters.address
  if (!parameters.publicKey)
    throw new Error('Expected access key address or public key in wallet request.')
  return Address.fromPublicKey(PublicKey.fromHex(parameters.publicKey))
}

async function signature(
  capabilities:
    | NonNullable<NonNullable<Rpc.wallet_connect.Decoded['params']>[number]['capabilities']>
    | undefined,
) {
  if (capabilities?.digest) return { signature: await root.sign({ hash: capabilities.digest }) }
  if (capabilities?.personalSign)
    return { signature: await root.signMessage({ message: capabilities.personalSign.message }) }
  return {}
}

function connectParameters(wallet: ReturnType<typeof createWallet>, index: number) {
  const [parameters] =
    z.decode(Rpc.wallet_connect.schema.params!, wallet.requests()[index]!.params as never) ?? []
  return parameters
}

function authorizeParameters(wallet: ReturnType<typeof createWallet>, index: number) {
  const [parameters] = z.decode(
    Rpc.wallet_authorizeAccessKey.schema.params!,
    wallet.requests()[index]!.params as never,
  )
  return parameters
}

function personalSignParameters(wallet: ReturnType<typeof createWallet>, index: number) {
  const [data, address] = z.decode(
    Rpc.personal_sign.schema.params!,
    wallet.requests()[index]!.params as never,
  )
  return { address, data }
}

type AdapterAuthorizeParameters = NonNullable<
  Rpc.wallet_authorizeAccessKey.Decoded['params']
>[number]

function createProvider(
  wallet: ReturnType<typeof createWallet>,
  options: Omit<Provider.create.Options, 'adapter' | 'chains'> &
    Partial<
      Pick<
        mobileWebAuth.Options,
        'baseUrl' | 'host' | 'name' | 'openAuthSession' | 'rdns' | 'redirectUri'
      >
    > = {},
) {
  const {
    baseUrl = consumerOrigin,
    host = hostOrigin,
    name = 'Accounts RN Test',
    openAuthSession = wallet.openAuthSession,
    rdns = 'xyz.tempo.accounts.playground',
    redirectUri = callback,
    ...rest
  } = options
  return Provider.create({
    chains: [chain],
    ...rest,
    adapter: mobileWebAuth({
      baseUrl,
      fetch: wallet.fetch,
      host,
      name,
      openAuthSession,
      rdns,
      redirectUri,
    }),
  })
}

describe('create', () => {
  test('behavior: tempoWallet defaults host to the Tempo Wallet origin', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: tempoWallet({
        baseUrl: consumerOrigin,
        fetch: wallet.fetch,
        openAuthSession: wallet.openAuthSession,
        redirectUri: callback,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.fetches()).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.xyz/.well-known/urpc/host.json",
      ]
    `)
    expect(wallet.requests()[0]?.method).toBe('wallet_connect')
  })

  test('behavior: accepts explicit mobile web auth adapter', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: mobileWebAuth({
        baseUrl: consumerOrigin,
        fetch: wallet.fetch,
        host: hostOrigin,
        name: 'Custom Mobile App',
        openAuthSession: wallet.openAuthSession,
        rdns: 'xyz.tempo.custom',
        redirectUri: callback,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.requests()[0]?.method).toBe('wallet_connect')
  })

  test('behavior: persists managed access keys through provider storage', async () => {
    const storage = asyncJsonStorage({ key: 'react-native-managed-key' })
    const wallet = createWallet()
    const provider1 = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage,
    })

    const result = await provider1.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'Accounts RN Test' } }],
    })
    expect(result.accounts[0]!.address).toBe(root.address)
    expect(
      connectParameters(wallet, 0)?.capabilities?.authorizeAccessKey?.keyType,
    ).toMatchInlineSnapshot(`"p256"`)

    await fund(root.address)

    const provider2 = createProvider(wallet, {
      storage,
    })
    await Store.waitForHydration(provider2.store)

    const receipt = await provider2.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall], feeToken: Addresses.pathUsd }],
    })
    expect(receipt.status).toBe('0x1')
    expect(wallet.calls()).toBe(1)
  })

  test('behavior: forwards showDeposit boolean through wallet_connect for registration', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', showDeposit: true } }],
    })

    expect(connectParameters(wallet, 0)?.capabilities?.showDeposit).toBe(true)
  })

  test('behavior: forwards showDeposit boolean through wallet_connect for login', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', showDeposit: true } }],
    })

    expect(connectParameters(wallet, 0)?.capabilities?.showDeposit).toBe(true)
  })

  test('behavior: forwards showDeposit params through wallet_connect for registration', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
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

    expect(connectParameters(wallet, 0)?.capabilities?.showDeposit).toMatchInlineSnapshot(`
      {
        "amount": "50",
        "displayName": "DoorDash",
        "on": "register",
        "token": "USDC",
      }
    `)
  })

  test('behavior: forwards showDeposit params through wallet_authorizeAccessKey', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
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

    expect(authorizeParameters(wallet, 1).showDeposit).toMatchInlineSnapshot(`
      {
        "amount": "25",
        "token": "USDC",
      }
    `)
  })

  test('behavior: forwards personalSign through wallet_connect and returns signature', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', personalSign: { message: 'hello' } } }],
    })

    expect(connectParameters(wallet, 0)?.capabilities?.personalSign).toMatchInlineSnapshot(`
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

  test('behavior: forwards digest through wallet_connect and returns signature', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage: Storage.memory(),
    })

    const digest = Hex.random(32)
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { digest, method: 'login' } }],
    })

    expect(connectParameters(wallet, 0)?.capabilities?.digest).toBe(digest)
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: forwards personal_sign through mobile web auth', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    const data = Hex.fromString('hello')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [data, root.address],
    })
    const forwarded = personalSignParameters(wallet, 1)

    expect(forwarded.address).toBe(root.address)
    expect(forwarded.data).toBe(data)
    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: forwards wallet_deposit through mobile web auth', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_deposit',
      params: [{ amount: '25', token: 'USDC' }],
    })

    expect(wallet.requests()[0]).toMatchInlineSnapshot(`
      {
        "method": "wallet_deposit",
        "params": [
          {
            "amount": "25",
            "token": "USDC",
          },
        ],
      }
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "receipts": [],
      }
    `)
  })

  test('behavior: disconnects locally without opening an auth session', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    expect(provider.store.getState().accounts).toHaveLength(1)

    await provider.request({ method: 'wallet_disconnect' })

    expect(provider.store.getState().accounts).toHaveLength(0)
    expect(wallet.calls()).toBe(1)
  })

  test('behavior: switches chains locally without opening an auth session', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: Hex.fromNumber(chain.id) }],
    })

    expect(await provider.request({ method: 'eth_chainId' })).toBe(Hex.fromNumber(chain.id))
    expect(wallet.calls()).toBe(0)
  })

  test('behavior: forwards wallet_revokeAccessKey through mobile web auth', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    await provider.request({
      method: 'wallet_revokeAccessKey',
      params: [{ accessKeyAddress: root.address, address: root.address }],
    })
    const request = wallet.requests()[1]!

    expect(request.method).toBe('wallet_revokeAccessKey')
    expect(request.params).toMatchInlineSnapshot(`
      [
        {
          "accessKeyAddress": "${root.address}",
          "address": "${root.address}",
        },
      ]
    `)
  })
})
