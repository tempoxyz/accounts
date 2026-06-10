import { Address, Hex, Json, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits, type Address as viem_Address } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { afterEach, describe, expect, test, vi } from 'vp/test'
import { Wata as HostWata, postMessage as hostPostMessage } from 'wata/host'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../../../test/config.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import * as Store from '../../Store.js'
import * as Rpc from '../../zod/rpc.js'
import { postMessage } from './postMessage.js'
import { tempoWallet } from './tempoWallet.js'

const root = accounts[0]!
const transferCall = Actions.token.transfer.call({
  to: '0x0000000000000000000000000000000000000001',
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

const hosts: ReturnType<typeof createHost>[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(hosts.splice(0).map((host) => host.close()))
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

/**
 * In-process wallet endpoint. `target` is called whenever the adapter
 * (re-)opens its session: it mints a fresh `MessageChannel` and parks a wata
 * host on the far port — the port-pair stand-in for the wallet window. The
 * `opened` log therefore counts session mounts, not requests.
 */
function createWallet() {
  const opened: string[] = []
  const requests: { method: string; params: unknown }[] = []

  return {
    opened: () => opened,
    requests: () => requests,
    target: ({ host }: { host: string | undefined }) => {
      opened.push(host ?? '')
      const channel = new MessageChannel()
      hosts.push(createHost(requests, channel.port2))
      return channel.port1
    },
  }
}

function createHost(requests: { method: string; params: unknown }[], port: MessagePort) {
  const host = HostWata.create({
    transports: [hostPostMessage({ target: () => port })],
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
    Partial<Pick<postMessage.Options, 'host' | 'name' | 'rdns'>> = {},
) {
  const {
    host = 'https://wallet.tempo.xyz/post-message',
    name = 'Accounts Web Test',
    rdns = 'xyz.tempo.accounts.playground',
    ...rest
  } = options
  return Provider.create({
    chains: [chain],
    ...rest,
    adapter: postMessage({
      host,
      name,
      rdns,
      target: wallet.target,
    }),
  })
}

describe('create', () => {
  test('behavior: tempoWallet defaults host to the Tempo Wallet post-message page', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: tempoWallet({ target: wallet.target }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.xyz/post-message",
      ]
    `)
    expect(wallet.requests()[0]?.method).toBe('wallet_connect')
  })

  test('behavior: accepts explicit postMessage adapter', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: postMessage({
        host: 'https://wallet.example/post-message',
        name: 'Custom Wallet',
        rdns: 'xyz.tempo.custom',
        target: wallet.target,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(result.accounts[0]!.address).toBe(root.address)
    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.example/post-message",
      ]
    `)
  })

  test('behavior: tags the wallet page URL with the app origin', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } })

    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.xyz/post-message?origin=https%3A%2F%2Fapp.example",
      ]
    `)
  })

  test('behavior: persists managed access keys through provider storage', async () => {
    const storage = asyncJsonStorage({ key: 'post-message-managed-key' })
    const wallet = createWallet()
    const provider1 = createProvider(wallet, {
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage,
    })

    const result = await provider1.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'Accounts Web Test' } }],
    })
    expect(result.accounts[0]!.address).toBe(root.address)

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
    expect(wallet.opened()).toHaveLength(1)
  })

  test('behavior: reuses one wallet page session for sequential requests', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await provider.request({
      method: 'personal_sign',
      params: [Hex.fromString('hello'), root.address],
    })
    await provider.request({
      method: 'wallet_deposit',
      params: [{ amount: '25', token: 'USDC' }],
    })

    expect(wallet.requests().map((request) => request.method)).toMatchInlineSnapshot(`
      [
        "wallet_connect",
        "personal_sign",
        "wallet_deposit",
      ]
    `)
    expect(wallet.opened()).toHaveLength(1)
  })

  test('behavior: reopens the wallet page after disconnect', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.opened()).toHaveLength(2)
  })

  test('behavior: serializes overlapping requests over one session', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    const [result, deposit] = await Promise.all([
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      }),
      provider.request({ method: 'wallet_deposit', params: [{ amount: '25', token: 'USDC' }] }),
    ])

    expect(result.accounts[0]!.address).toBe(root.address)
    expect(deposit).toMatchInlineSnapshot(`
      {
        "receipts": [],
      }
    `)
    expect(wallet.opened()).toHaveLength(1)
    // Arrival order at the adapter is not defined for overlapping calls —
    // only that both round-trip through the single session.
    expect(
      wallet
        .requests()
        .map((request) => request.method)
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        "wallet_connect",
        "wallet_deposit",
      ]
    `)
  })

  test('behavior: forwards personal_sign through the wallet page', async () => {
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

  test('behavior: forwards wallet_deposit through the wallet page', async () => {
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

  test('behavior: disconnects locally without opening the wallet page', async () => {
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
    expect(wallet.opened()).toHaveLength(1)
  })

  test('behavior: switches chains locally without opening the wallet page', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: Hex.fromNumber(chain.id) }],
    })

    expect(await provider.request({ method: 'eth_chainId' })).toBe(Hex.fromNumber(chain.id))
    expect(wallet.opened()).toHaveLength(0)
  })

  test('behavior: rejects when the wallet page closes without answering', async () => {
    // Window targets receive inbound frames through the global `window`;
    // stub one so the transport can attach its listener, and hand back a
    // popup stand-in that reports itself closed.
    vi.stubGlobal('window', {
      addEventListener() {},
      location: { origin: 'https://app.example' },
      removeEventListener() {},
    })

    const provider = Provider.create({
      adapter: postMessage({
        host: 'https://wallet.example/post-message',
        name: 'Custom Wallet',
        rdns: 'xyz.tempo.custom',
        target: () =>
          ({
            addEventListener() {},
            closed: true,
            postMessage() {},
            removeEventListener() {},
          }) as unknown as Window,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      '[Provider.UserRejectedRequestError: The user rejected the request.]',
    )
  })
})
