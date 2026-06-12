import { Address, Base64, Bytes, Hex, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits, type Address as viem_Address } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'
import type { DeviceCode } from 'wata'
import { Wata as HostWata, deviceCode as hostDeviceCode, Kv } from 'wata/host'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../../../test/config.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import * as Store from '../../Store.js'
import * as Rpc from '../../zod/rpc.js'
import { deviceCode } from './deviceCode.js'
import { tempoWallet } from './tempoWallet.js'

const consumerOrigin = 'https://accounts-playground.example'
const devicePath = '/auth/device'
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

function createWallet(options: { approve?: boolean; binding?: boolean } = {}) {
  const { approve = true, binding = true } = options
  let exchanges = 0
  const fetches: string[] = []
  const prompts: DeviceCode.Prompt[] = []
  const requests: { method: string; params: unknown }[] = []
  // The host transport is single-exchange, so each registration opens a
  // fresh host session; verify/token continue against the current one.
  let host: ReturnType<typeof createHost> | undefined

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init)
    fetches.push(request.url)
    if (request.url === `${hostOrigin}/.well-known/urpc/host.json`)
      return Response.json({
        id: 'wallet.tempo.xyz',
        identity_pubkey: hostIdentity,
        name: 'Tempo Wallet',
        origin: hostOrigin,
        transports: {
          'mobile-web-auth': { auth_url: `${hostOrigin}/mobile-web-auth` },
          ...(binding
            ? {
                'device-code': {
                  register_url: `${hostOrigin}${devicePath}/register`,
                  token_url: `${hostOrigin}${devicePath}/token`,
                },
              }
            : {}),
        },
        version: '1.0',
      })
    const url = new URL(request.url)
    if (url.origin === hostOrigin && url.pathname.startsWith(devicePath)) {
      if (url.pathname === `${devicePath}/register`) {
        exchanges += 1
        host = createHost(requests, { approve })
      }
      if (!host) throw new Error('no active device-code host session')
      return await host.fetch(request)
    }
    throw new Error(`unexpected fetch to ${request.url}`)
  }

  return {
    exchanges: () => exchanges,
    fetch,
    fetches: () => fetches,
    prompts: () => prompts,
    requests: () => requests,
    // Approve out-of-band, like a user on the wallet's verification page:
    // the consumer's first poll lands `authorization_pending`, then the
    // next one collects the response.
    onPrompt: ((prompt) => {
      prompts.push(prompt)
      setTimeout(() => {
        void fetch(`${hostOrigin}${devicePath}/verify`, {
          body: JSON.stringify({ user_code: prompt.userCode }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
      }, 10)
    }) satisfies NonNullable<DeviceCode.Options['onPrompt']>,
  }
}

function createHost(
  requests: { method: string; params: unknown }[],
  options: { approve: boolean },
) {
  const host = HostWata.create({
    baseUrl: hostOrigin,
    transports: [
      hostDeviceCode({
        fetch: async (input): Promise<Response> => {
          const url = input instanceof Request ? input.url : String(input)
          throw new Error(`unexpected fetch to ${url}`)
        },
        html: {
          authenticate: async ({ actions, request }) => {
            const { user_code } = (await request.json()) as { user_code: string }
            if (options.approve) await actions.approve(user_code)
            else await actions.deny(user_code)
            return Response.json({ ok: true })
          },
          render: () => new Response('verify', { headers: { 'content-type': 'text/html' } }),
        },
        path: devicePath,
        store: Kv.memory(),
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
    }
  })

  return host
}

async function signKeyAuthorization(parameters: AdapterAuthorizeParameters) {
  return await root.signKeyAuthorization(
    {
      accessKeyAddress: accessKeyAddress(parameters),
      keyType: parameters.keyType ?? 'secp256k1',
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

type AdapterAuthorizeParameters = NonNullable<
  Rpc.wallet_authorizeAccessKey.Decoded['params']
>[number]

function createProvider(
  wallet: ReturnType<typeof createWallet>,
  options: Omit<Provider.create.Options, 'adapter' | 'chains'> &
    Partial<Pick<deviceCode.Options, 'host' | 'name' | 'rdns'>> = {},
) {
  const {
    host = hostOrigin,
    name = 'Accounts Device Code Test',
    rdns = 'xyz.tempo.accounts.playground',
    ...rest
  } = options
  return Provider.create({
    chains: [chain],
    ...rest,
    adapter: deviceCode({
      baseUrl: consumerOrigin,
      fetch: wallet.fetch,
      host,
      name,
      onPrompt: wallet.onPrompt,
      pollingInterval: 50,
      rdns,
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
        onPrompt: wallet.onPrompt,
        pollingInterval: 50,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.fetches()[0]).toBe('https://wallet.tempo.xyz/.well-known/urpc/host.json')
    expect(wallet.requests()[0]?.method).toBe('wallet_connect')
  })

  test('behavior: accepts explicit device code adapter and surfaces the prompt', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      name: 'Custom Device App',
      rdns: 'xyz.tempo.custom',
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    const prompt = wallet.prompts()[0]!
    expect(prompt.userCode).toMatch(/^[A-Z0-9-]+$/i)
    expect(prompt.verificationUri).toBe(`${hostOrigin}${devicePath}/verify`)
    expect(prompt.verificationUriFull).toContain('user_code=')
    expect(wallet.requests()[0]?.method).toBe('wallet_connect')
  })

  test('behavior: persists managed access keys through provider storage', async () => {
    const storage = Storage.memory()
    const wallet = createWallet()
    const provider1 = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage,
    })

    const result = await provider1.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'Accounts Device Code Test' } }],
    })
    expect(result.accounts[0]!.address).toBe(root.address)

    await fund(root.address)

    const provider2 = createProvider(wallet, { storage })
    await Store.waitForHydration(provider2.store)

    const receipt = await provider2.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall], feeToken: Addresses.pathUsd }],
    })
    expect(receipt.status).toBe('0x1')
    expect(wallet.exchanges()).toBe(1)
  })

  test('behavior: forwards personal_sign through device code', async () => {
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

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
    expect(wallet.requests()[1]?.method).toBe('personal_sign')
    expect(wallet.exchanges()).toBe(2)
  })

  test('behavior: surfaces denial as a user rejection', async () => {
    const wallet = createWallet({ approve: false })
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      }),
    ).rejects.toThrow('user denied the device-code request')
  })

  test('behavior: rejects when the host does not advertise device-code', async () => {
    const wallet = createWallet({ binding: false })
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      }),
    ).rejects.toThrow('does not advertise the `device-code` transport')
  })
})
