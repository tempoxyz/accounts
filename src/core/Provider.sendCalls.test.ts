import { Hex } from 'ox'
import { custom } from 'viem'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const address = '0x0000000000000000000000000000000000000001'
const hash = Hex.padLeft('0x01', 32)
// Only the receipt fields consumed by the batch response are needed here.
const receipt = { status: '0x1', transactionHash: hash }

afterEach(() => vi.restoreAllMocks())

describe.each([false, true])('wallet_sendCalls (sync=%s)', (sync) => {
  test.each([
    {
      name: 'explicit alternate chain',
      active: tempo.id,
      requested: tempoModerato.id,
      next: tempo.id,
    },
    {
      name: 'omitted chain',
      active: tempoModerato.id,
      requested: undefined,
      next: tempoModerato.id,
    },
    {
      name: 'omitted chain with a switch during submission',
      active: tempoModerato.id,
      requested: undefined,
      next: tempo.id,
    },
  ])('keeps the transaction chain for $name', async ({ active, requested, next }) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const send = vi.fn(async (parameters: Adapter.sendTransaction.Parameters) => {
      started.resolve()
      await finish.promise
      return parameters
    })
    const requests: { chainId: number; method: string; params: unknown }[] = []
    const provider = Provider.create({
      adapter: Adapter.define({ name: 'Test Wallet', rdns: 'test.send-calls' }, () => ({
        actions: {
          async createAccount() {
            return { accounts: [{ address }] }
          },
          async loadAccounts() {
            return { accounts: [{ address }] }
          },
          async sendTransaction(parameters) {
            await send(parameters)
            return hash
          },
          async sendTransactionSync(parameters) {
            await send(parameters)
            return receipt as never
          },
        },
      })),
      chains: [tempo, tempoModerato],
      mpp: false,
      storage: Storage.memory(),
      transports: Object.fromEntries(
        [tempo, tempoModerato].map((chain) => [
          chain.id,
          custom(
            {
              async request({ method, params }) {
                requests.push({ chainId: chain.id, method, params })
                if (method === 'eth_getTransactionReceipt' && chain.id === tempoModerato.id)
                  return receipt
                throw new Error(`Unexpected RPC on chain ${chain.id}: ${method}`)
              },
            },
            { retryCount: 0 },
          ),
        ]),
      ),
    })
    await provider.ready()
    provider.store.setState({ accounts: [{ address }], chainId: active })

    const pending = provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [{ to: address, data: '0x1234' }],
          capabilities: { sync },
          ...(requested !== undefined ? { chainId: Hex.fromNumber(requested) } : {}),
        },
      ],
    })
    await Promise.race([started.promise, pending])
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: Hex.fromNumber(next) }],
    })
    finish.resolve()
    const result = await pending
    const status = await provider.request({ method: 'wallet_getCallsStatus', params: [result.id] })

    expect(send.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "calls": [
              {
                "data": "0x1234",
                "to": "0x0000000000000000000000000000000000000001",
              },
            ],
            "chainId": 42431,
            "from": "0x0000000000000000000000000000000000000001",
          },
        ],
      ]
    `)
    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "chainId": 42431,
          "method": "eth_getTransactionReceipt",
          "params": [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        },
      ]
    `)
    if (sync)
      expect(result).toMatchInlineSnapshot(`
        {
          "atomic": true,
          "capabilities": {
            "sync": true,
          },
          "chainId": "0xa5bf",
          "id": "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000a5bfeb79a93fa2a5c84373680167d9d61731a7028aa29a638392603e0b3ae07cd1e6",
          "receipts": [
            {
              "status": "0x1",
              "transactionHash": "0x0000000000000000000000000000000000000000000000000000000000000001",
            },
          ],
          "status": 200,
          "version": "2.0.0",
        }
      `)
    else
      expect(result).toMatchInlineSnapshot(`
        {
          "capabilities": {
            "sync": false,
          },
          "id": "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000a5bfeb79a93fa2a5c84373680167d9d61731a7028aa29a638392603e0b3ae07cd1e6",
        }
      `)
    expect(status).toMatchInlineSnapshot(`
      {
        "atomic": true,
        "chainId": "0xa5bf",
        "id": "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000a5bfeb79a93fa2a5c84373680167d9d61731a7028aa29a638392603e0b3ae07cd1e6",
        "receipts": [
          {
            "status": "0x1",
            "transactionHash": "0x0000000000000000000000000000000000000000000000000000000000000001",
          },
        ],
        "status": 200,
        "version": "2.0.0",
      }
    `)
  })

  test.each([
    { name: 'captured chain', chainId: undefined, chainId_expected: BigInt(tempoModerato.id) },
    { name: 'explicit chain', chainId: BigInt(tempo.id), chainId_expected: BigInt(tempo.id) },
    { name: 'explicit zero chain', chainId: 0n, chainId_expected: 0n },
  ])(
    'keeps the transaction chain through default-key authorization with $name',
    async ({ chainId, chainId_expected }) => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
      const started = Promise.withResolvers<void>()
      const finish = Promise.withResolvers<void>()
      const authorize = vi.fn(
        async (
          parameters: Adapter.authorizeAccessKey.Parameters,
        ): Promise<Adapter.authorizeAccessKey.ReturnType> => {
          started.resolve()
          await finish.promise
          return {
            rootAddress: address,
            keyAuthorization: {
              chainId: Hex.fromNumber(parameters.chainId ?? provider.store.getState().chainId),
              expiry: '0xffffffff',
              keyId: address,
              keyType: 'secp256k1',
              signature: { type: 'secp256k1', r: '0x01', s: '0x01', yParity: '0x0' },
            },
          }
        },
      )
      const send = vi.fn((parameters: Adapter.sendTransaction.Parameters) => parameters)
      const requests: { chainId: number; method: string; params: unknown }[] = []
      const provider = Provider.create({
        accessKey: {
          authorize: {
            ...(chainId !== undefined ? { chainId } : {}),
            expiry: 4_294_967_295,
            scopes: [{ address, selector: '0x12345678' }],
          },
        },
        adapter: Adapter.define({ name: 'Test Wallet', rdns: 'test.send-calls' }, () => ({
          actions: {
            async createAccount() {
              return { accounts: [{ address }] }
            },
            async loadAccounts() {
              return { accounts: [{ address }] }
            },
            authorizeAccessKey: authorize,
            async sendTransaction(parameters) {
              send(parameters)
              return hash
            },
            async sendTransactionSync(parameters) {
              send(parameters)
              return receipt as never
            },
          },
        })),
        chains: [tempo, tempoModerato],
        mpp: false,
        storage: Storage.memory(),
        transports: Object.fromEntries(
          [tempo, tempoModerato].map((chain) => [
            chain.id,
            custom(
              {
                async request({ method, params }) {
                  requests.push({ chainId: chain.id, method, params })
                  if (method === 'eth_getTransactionReceipt' && chain.id === tempoModerato.id)
                    return receipt
                  throw new Error(`Unexpected RPC on chain ${chain.id}: ${method}`)
                },
              },
              { retryCount: 0 },
            ),
          ]),
        ),
      })
      await provider.ready()
      provider.store.setState({ accounts: [{ address }], chainId: tempoModerato.id })

      const pending = provider.request({
        method: 'wallet_sendCalls',
        params: [{ calls: [{ to: address, data: '0x12345678' }], capabilities: { sync } }],
      })
      await Promise.race([started.promise, pending])
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: Hex.fromNumber(tempo.id) }],
      })
      expect(send.mock.calls).toMatchInlineSnapshot(`[]`)
      expect(provider.store.getState().chainId).toMatchInlineSnapshot(`4217`)
      finish.resolve()
      const result = await pending
      const status = await provider.request({
        method: 'wallet_getCallsStatus',
        params: [result.id],
      })

      expect(authorize.mock.calls).toEqual([
        [
          {
            chainId: chainId_expected,
            expiry: 4_294_967_295,
            scopes: [{ address, selector: '0x12345678' }],
          },
          {
            method: 'wallet_authorizeAccessKey',
            params: [
              {
                chainId: Hex.fromNumber(chainId_expected),
                expiry: 4_294_967_295,
                scopes: [{ address, selector: '0x12345678' }],
              },
            ],
          },
        ],
      ])
      expect(await authorize.mock.results[0]?.value).toEqual({
        rootAddress: address,
        keyAuthorization: {
          chainId: Hex.fromNumber(chainId_expected),
          expiry: '0xffffffff',
          keyId: address,
          keyType: 'secp256k1',
          signature: { type: 'secp256k1', r: '0x01', s: '0x01', yParity: '0x0' },
        },
      })
      expect(send.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "calls": [
              {
                "data": "0x12345678",
                "to": "0x0000000000000000000000000000000000000001",
              },
            ],
            "chainId": 42431,
            "from": "0x0000000000000000000000000000000000000001",
          },
        ],
      ]
    `)
      expect(requests).toMatchInlineSnapshot(`
      [
        {
          "chainId": 42431,
          "method": "eth_getTransactionReceipt",
          "params": [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        },
      ]
    `)
      if (sync)
        expect(result).toMatchInlineSnapshot(`
        {
          "atomic": true,
          "capabilities": {
            "sync": true,
          },
          "chainId": "0xa5bf",
          "id": "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000a5bfeb79a93fa2a5c84373680167d9d61731a7028aa29a638392603e0b3ae07cd1e6",
          "receipts": [
            {
              "status": "0x1",
              "transactionHash": "0x0000000000000000000000000000000000000000000000000000000000000001",
            },
          ],
          "status": 200,
          "version": "2.0.0",
        }
      `)
      else
        expect(result).toMatchInlineSnapshot(`
        {
          "capabilities": {
            "sync": false,
          },
          "id": "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000a5bfeb79a93fa2a5c84373680167d9d61731a7028aa29a638392603e0b3ae07cd1e6",
        }
      `)
      expect(status).toMatchInlineSnapshot(`
      {
        "atomic": true,
        "chainId": "0xa5bf",
        "id": "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000a5bfeb79a93fa2a5c84373680167d9d61731a7028aa29a638392603e0b3ae07cd1e6",
        "receipts": [
          {
            "status": "0x1",
            "transactionHash": "0x0000000000000000000000000000000000000000000000000000000000000001",
          },
        ],
        "status": 200,
        "version": "2.0.0",
      }
    `)
    },
  )
})
