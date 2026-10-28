import { Hash, Secp256k1 } from 'ox'
import { TxEnvelopeTempo } from 'ox/tempo'
import { custom, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Transaction } from 'viem/tempo'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'

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
    const client_a = Client.fromChainId(undefined, {
      chains: [tempo, tempoModerato],
      provider: provider_a,
      store,
    })
    const client_b = Client.fromChainId(undefined, {
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

  test('behavior: fills transactions on the requested chain', async () => {
    const requests: unknown[] = []
    const store = setup()
    const provider = {
      async request(request: unknown) {
        requests.push(request)
        return {}
      },
    } as never
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo, tempoModerato],
      provider,
      store,
    })

    await client.request({
      method: 'eth_fillTransaction' as never,
      params: [{ to: '0x0000000000000000000000000000000000000001' }] as never,
    })

    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "method": "eth_fillTransaction",
          "params": [
            {
              "chainId": 4217,
              "to": "0x0000000000000000000000000000000000000001",
            },
          ],
        },
      ]
    `)
  })
})

describe('feePayerTransport', () => {
  afterEach(() => vi.unstubAllGlobals())

  const sender = privateKeyToAccount(
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  )
  const feePayerPrivateKey = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  async function sponsoredTransaction(data: `0x${string}`) {
    const requested = await sender.signTransaction(
      {
        calls: [{ data, to: '0x20c0000000000000000000000000000000000000' }],
        chainId: tempo.id,
        feePayer: true,
        gas: 100_000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
        nonce: 1,
      } as never,
      { serializer: Transaction.serialize },
    )
    const envelope = TxEnvelopeTempo.deserialize(requested as TxEnvelopeTempo.Serialized)
    const feePayerSignature = Secp256k1.sign({
      payload: TxEnvelopeTempo.getFeePayerSignPayload(envelope, { sender: envelope.from! }),
      privateKey: feePayerPrivateKey,
    })
    return {
      requested,
      signed: TxEnvelopeTempo.serialize(envelope, { feePayerSignature }),
    }
  }

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

  test('behavior: accepts a fee payer signature for the requested transaction', async () => {
    const store = setup()
    const { requested, signed } = await sponsoredTransaction('0x1234')
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number }
      return Response.json({ id: body.id, jsonrpc: '2.0', result: signed })
    })
    const baseRequests: { method: string; params?: unknown }[] = []
    const hash = `0x${'11'.repeat(32)}` as `0x${string}`
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://relay.example.com',
      store,
      transports: {
        [tempo.id]: custom({
          async request({ method, params }) {
            baseRequests.push({ method, params })
            return hash
          },
        }),
      },
    })

    const result = await client.request({
      method: 'eth_sendRawTransaction',
      params: [requested],
    })

    expect(result).toMatchInlineSnapshot(
      `"0x1111111111111111111111111111111111111111111111111111111111111111"`,
    )
    expect(baseRequests.map((request) => request.method)).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransaction",
      ]
    `)
    const sent = baseRequests[0]?.params as readonly unknown[] | undefined
    expect(sent?.[0]).toBe(signed)
  })

  test('error: rejects a fee payer signature for a different transaction', async () => {
    const store = setup()
    const { requested } = await sponsoredTransaction('0x1234')
    const { signed } = await sponsoredTransaction('0x5678')
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number }
      return Response.json({ id: body.id, jsonrpc: '2.0', result: signed })
    })
    const baseRequests: unknown[] = []
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://relay.example.com',
      store,
      transports: {
        [tempo.id]: custom({
          async request(request) {
            baseRequests.push(request)
            return null
          },
        }),
      },
    })

    await expect(
      client.request({ method: 'eth_sendRawTransaction', params: [requested] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Fee payer changed the requested transaction intent.]`,
    )
    expect(baseRequests).toMatchInlineSnapshot(`[]`)
  })

  test('error: rejects a filled transaction that changes the requested call', async () => {
    const store = setup()
    const request = {
      calls: [{ data: '0x1234', to: '0x20c0000000000000000000000000000000000000', value: '0x' }],
      chainId: '0x1079',
      feePayer: true,
      from: sender.address,
      type: '0x76',
    } as const
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number }
      return Response.json({
        id: body.id,
        jsonrpc: '2.0',
        result: {
          raw: '0x',
          tx: {
            ...request,
            calls: [{ ...request.calls[0], data: '0x5678' }],
          },
        },
      })
    })
    const baseRequests: unknown[] = []
    const client = Client.fromChainId(tempo.id, {
      chains: [tempo],
      feePayer: 'https://relay.example.com',
      store,
      transports: {
        [tempo.id]: custom({
          async request(request) {
            baseRequests.push(request)
            return null
          },
        }),
      },
    })

    await expect(
      client.request({ method: 'eth_fillTransaction' as never, params: [request] as never }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Fee payer changed the requested transaction intent.]`,
    )
    expect(baseRequests).toMatchInlineSnapshot(`[]`)
  })
})

describe('rawTransactionTransport', () => {
  const serialized = '0x76deadbeef'
  const hash = Hash.keccak256(serialized)
  const receipt = { status: '0x1', transactionHash: hash }

  /**
   * Base transport whose first raw submission is accepted by the node but
   * fails in transit (e.g. a 502 after the node took it), so viem retries it
   * and the node rejects the copy with `rejection`.
   */
  function flaky(
    rejection: string,
    options: { known?: boolean | undefined; mined?: boolean | undefined } = {},
  ) {
    const { known = true, mined = true } = options
    const requests: string[] = []
    let accepted = false
    const transport = custom({
      async request({ method, params }) {
        requests.push(method)
        if (method === 'eth_sendRawTransaction' || method === 'eth_sendRawTransactionSync') {
          if (!accepted) {
            accepted = true
            throw new Error('fetch failed')
          }
          throw { code: -32000, message: rejection }
        }
        const found = known && (params as readonly unknown[])[0] === hash
        if (method === 'eth_getTransactionByHash') return found ? { hash } : null
        if (method === 'eth_getTransactionReceipt') return found && mined ? receipt : null
        return null
      },
    })
    return { requests, transport }
  }

  function client(transport: ReturnType<typeof custom>) {
    return Client.fromChainId(tempo.id, {
      chains: [tempo],
      store: setup(),
      transports: { [tempo.id]: transport },
    })
  }

  test('behavior: waits for the receipt no longer than the sync timeout', async () => {
    const { transport } = flaky('already known', { mined: false })
    const start = Date.now()

    await expect(
      client(transport).request({
        method: 'eth_sendRawTransactionSync' as never,
        params: [serialized, 300] as never,
      }),
    ).rejects.toThrowError('already known')
    expect(Date.now() - start).toBeLessThan(5_000)
  })

  test('behavior: resolves a retried sync submission the node already knows', async () => {
    const { requests, transport } = flaky('already known')

    const result = await client(transport).request({
      method: 'eth_sendRawTransactionSync' as never,
      params: [serialized] as never,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "status": "0x1",
        "transactionHash": "0x8addb664b3fd09d9911a80e8930de7cba6e70ed84ec0514fee6a298d421b11d7",
      }
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        "eth_sendRawTransactionSync",
        "eth_sendRawTransactionSync",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
      ]
    `)
  })

  test('behavior: resolves a retried submission that was already mined', async () => {
    const { transport } = flaky('nonce too low: next nonce 1, tx nonce 0')

    const result = await client(transport).request({
      method: 'eth_sendRawTransaction' as never,
      params: [serialized] as never,
    })

    expect(result).toMatchInlineSnapshot(
      `"0x8addb664b3fd09d9911a80e8930de7cba6e70ed84ec0514fee6a298d421b11d7"`,
    )
  })

  test('error: rethrows a nonce rejection for a transaction the node does not know', async () => {
    const { transport } = flaky('nonce too low: next nonce 1, tx nonce 0', { known: false })

    await expect(
      client(transport).request({
        method: 'eth_sendRawTransaction' as never,
        params: [serialized] as never,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [InvalidInputRpcError: Missing or invalid parameters.
      Double check you have provided the correct parameters.

      Details: nonce too low: next nonce 1, tx nonce 0
      Version: viem@0.0.0-de39e106022f313a16c3b7367d8330753748c516]
    `)
  })
})
