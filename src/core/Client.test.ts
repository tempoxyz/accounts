import { custom, http } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
import { describe, expect, test } from 'vp/test'

import { secp256k1 } from '../../test/adapters.js'
import * as Client from './Client.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'

/** Creates a fresh in-memory store for tests. */
function setup(chainId: number = tempo.id) {
  return Store.create({ chainId, storage: Storage.memory() })
}

describe('fromChainId', () => {
  test('default: returns a viem client for the given chain', () => {
    const store = setup()
    const client = Client.fromChainId(tempo.id, { chains: [tempo], store })
    expect(client.chain.id).toMatchInlineSnapshot(`4217`)
    expect(typeof client.request).toMatchInlineSnapshot(`"function"`)
  })

  test('behavior: resolves chain by chainId', () => {
    const store = setup()
    const client = Client.fromChainId(tempoModerato.id, {
      chains: [tempo, tempoModerato],
      store,
    })
    expect(client.chain.id).toMatchInlineSnapshot(`42431`)
  })

  test('behavior: falls back to first chain when chainId not in chains', () => {
    const store = setup()
    const client = Client.fromChainId(999_999, { chains: [tempo, tempoModerato], store })
    expect(client.chain.id).toMatchInlineSnapshot(`4217`)
  })

  test('behavior: falls back to store.chainId when chainId is undefined', () => {
    const store = setup(tempoModerato.id)
    const client = Client.fromChainId(undefined, {
      chains: [tempo, tempoModerato],
      store,
    })
    expect(client.chain.id).toMatchInlineSnapshot(`42431`)
  })
})

describe('caching', () => {
  test('default: returns the same client on subsequent calls', () => {
    const store = setup()
    const transports = { [tempo.id]: http('https://example.com') }
    const a = Client.fromChainId(tempo.id, { chains: [tempo], store, transports })
    const b = Client.fromChainId(tempo.id, { chains: [tempo], store, transports })
    expect(a).toBe(b)
  })

  test('behavior: different chainIds get different clients', () => {
    const store = setup()
    const transports = {
      [tempo.id]: http('https://a.example.com'),
      [tempoModerato.id]: http('https://b.example.com'),
    }
    const a = Client.fromChainId(tempo.id, { chains: [tempo, tempoModerato], store, transports })
    const b = Client.fromChainId(tempoModerato.id, {
      chains: [tempo, tempoModerato],
      store,
      transports,
    })
    expect(a).not.toBe(b)
    expect(a.chain.id).toMatchInlineSnapshot(`4217`)
    expect(b.chain.id).toMatchInlineSnapshot(`42431`)
  })

  test('behavior: different providers do not share cached clients', async () => {
    // Regression: two providers with the same chainId previously hit the
    // same cached client because the cache key only encoded a boolean for
    // `provider`. Requests would route to the wrong provider as a result.
    const store = setup()
    const provider_a = Provider.create({
      adapter: secp256k1(),
      chains: [tempo, tempoModerato],
      storage: Storage.memory(),
    })
    const provider_b = Provider.create({
      adapter: secp256k1(),
      chains: [tempoModerato, tempo],
      storage: Storage.memory(),
    })
    const client_a = Client.fromChainId(tempo.id, {
      chains: [tempo, tempoModerato],
      provider: provider_a,
      store,
    })
    const client_b = Client.fromChainId(tempo.id, {
      chains: [tempo, tempoModerato],
      provider: provider_b,
      store,
    })

    // The clients themselves must be distinct.
    expect(client_a).not.toBe(client_b)

    // Each `eth_chainId` is routed back to its own provider's store, so the
    // returned chain IDs must match each provider's `defaultChain`.
    const chainId_a = await client_a.request({ method: 'eth_chainId' })
    const chainId_b = await client_b.request({ method: 'eth_chainId' })
    expect(chainId_a).toMatchInlineSnapshot(`"0x1079"`)
    expect(chainId_b).toMatchInlineSnapshot(`"0xa5bf"`)
  })

  test('behavior: different transports objects do not share cached clients', () => {
    const store = setup()
    const transports_a = { [tempo.id]: http('https://a.example.com') }
    const transports_b = { [tempo.id]: http('https://b.example.com') }
    const a = Client.fromChainId(tempo.id, { chains: [tempo], store, transports: transports_a })
    const b = Client.fromChainId(tempo.id, { chains: [tempo], store, transports: transports_b })
    expect(a).not.toBe(b)
  })

  test('behavior: same provider with different feePayer URLs gets different clients', () => {
    const store = setup()
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      storage: Storage.memory(),
    })
    const a = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://a.example.com/relay',
      provider,
      store,
    })
    const b = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://b.example.com/relay',
      provider,
      store,
    })
    expect(a).not.toBe(b)
  })

  test('behavior: feePayer false is cached separately from no feePayer', () => {
    const store = setup()
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      storage: Storage.memory(),
    })
    const a = Client.fromChainId(tempo.id, { chains: [tempo], provider, store })
    const b = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: false,
      provider,
      store,
    })
    expect(a).not.toBe(b)
  })

  test('behavior: feePayer string and equivalent object share a client', () => {
    const store = setup()
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      storage: Storage.memory(),
    })
    const a = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://relay.example.com',
      provider,
      store,
    })
    const b = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: { url: 'https://relay.example.com' },
      provider,
      store,
    })
    expect(a).toBe(b)
  })

  test('behavior: different precedence values get different clients', () => {
    const store = setup()
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      storage: Storage.memory(),
    })
    const a = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: { url: 'https://relay.example.com', precedence: 'fee-payer-first' },
      provider,
      store,
    })
    const b = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: { url: 'https://relay.example.com', precedence: 'user-first' },
      provider,
      store,
    })
    expect(a).not.toBe(b)
  })
})

describe('providerTransport', () => {
  test('default: routes requests through the provider', async () => {
    const store = setup()
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempoModerato, tempo],
      storage: Storage.memory(),
    })
    // Wire the client to chain ID `tempo.id` but route through a provider
    // whose default chain is `tempoModerato`. The returned chain ID must
    // come from the provider, not the requested chain.
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo, tempoModerato],
      provider,
      store,
    })
    const result = await client.request({ method: 'eth_chainId' })
    expect(result).toMatchInlineSnapshot(`"0xa5bf"`)
  })

  test('behavior: returns empty accounts before connecting', async () => {
    const store = setup()
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      storage: Storage.memory(),
    })
    const client = Client.fromChainId(tempo.id, { chains: [tempo], provider, store })
    const result = await client.request({ method: 'eth_accounts' })
    expect(result).toMatchInlineSnapshot(`[]`)
  })
})

describe('feePayerTransport', () => {
  test('behavior: passes through unrelated methods to the base transport', async () => {
    const store = setup()
    const baseRequests: { method: string; params?: unknown }[] = []
    const transports = {
      [tempo.id]: custom({
        async request({ method, params }) {
          baseRequests.push({ method, params })
          if (method === 'eth_chainId') return '0x1079'
          return null
        },
      }),
    }
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://relay.example.com',
      store,
      transports,
    })
    const result = await client.request({ method: 'eth_chainId' })
    expect(result).toMatchInlineSnapshot(`"0x1079"`)
    expect(baseRequests).toMatchInlineSnapshot(`
      [
        {
          "method": "eth_chainId",
          "params": undefined,
        },
      ]
    `)
  })

  test('behavior: eth_fillTransaction without feePayer flag stays on base', async () => {
    const store = setup()
    const baseRequests: { method: string; params?: unknown }[] = []
    const transports = {
      [tempo.id]: custom({
        async request({ method, params }) {
          baseRequests.push({ method, params })
          return { ok: true }
        },
      }),
    }
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://relay.example.com',
      store,
      transports,
    })
    await client.request({
      method: 'eth_fillTransaction' as never,
      params: [{ to: '0x0000000000000000000000000000000000000001' }] as never,
    })
    expect(baseRequests.map((r) => r.method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
  })

  test('behavior: user-first precedence skips sponsor for eth_fillTransaction', async () => {
    const store = setup()
    const baseRequests: { method: string; params?: unknown }[] = []
    const transports = {
      [tempo.id]: custom({
        async request({ method, params }) {
          baseRequests.push({ method, params })
          return { ok: true }
        },
      }),
    }
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: { url: 'https://relay.example.com', precedence: 'user-first' },
      store,
      transports,
    })
    await client.request({
      method: 'eth_fillTransaction' as never,
      params: [{ to: '0x0000000000000000000000000000000000000001', feePayer: true }] as never,
    })
    expect(baseRequests.map((r) => r.method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
  })
})
