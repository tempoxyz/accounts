import { Hex, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { custom } from 'viem'
import { Account, KeyAuthorizationManager } from 'viem/tempo'
import { tempoModerato } from 'viem/tempo/chains'
import { describe, expect, test, vi } from 'vp/test'
import * as z from 'zod/mini'

import { accounts } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
import { local } from './adapters/local.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'
import * as Rpc from './zod/rpc.js'

const root = accounts[0]
const admin = accounts[1].address
const rules = {
  maxSlippageBps: 100,
  sources: { [accounts[2].address]: [{ target: accounts[3].address, data: '0x1234' as const }] },
}
const policies = [undefined, 7n, { admins: [admin], rules }, { rules }] as const

for (const method of ['login', 'register'] as const)
  describe(`wallet_connect ${method}`, () => {
    test.each(policies)('signs and returns the complete policy: %s', async (fundingPolicy) => {
      const sign = vi.fn(root.sign)
      const digests: (Hex.Hex | undefined)[] = []
      const provider = Provider.create({
        adapter: local({
          async createAccount({ digest }) {
            digests.push(digest)
            return { accounts: [{ ...root, sign }] }
          },
          async loadAccounts({ digest } = {}) {
            digests.push(digest)
            return {
              accounts: [{ ...root, sign }],
              ...(digest ? { signature: await root.sign({ hash: digest }) } : {}),
            }
          },
        }),
        chains: [tempoModerato],
        storage: Storage.memory(),
      })
      // A cached identity must not select the default admin for a newly selected account.
      provider.store.setState({ accounts: [{ address: admin }], activeAccount: 0 })
      const key = Account.fromWebCryptoP256(await WebCryptoP256.createKeyPair())
      const { accounts: result } = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              method,
              ...(method === 'register' ? { name: 'new' } : { selectAccount: true }),
              authorizeAccessKey: {
                address: key.address,
                keyType: 'p256',
                expiry: 123,
                ...(fundingPolicy !== undefined
                  ? {
                      fundingPolicy: z.encode(Rpc.wallet_authorizeAccessKey.parameters, {
                        expiry: 123,
                        fundingPolicy,
                      }).fundingPolicy,
                    }
                  : {}),
              },
            },
          },
        ],
      })
      const authorization = KeyAuthorization.fromRpc(result[0]!.capabilities.keyAuthorization!)
      const expected =
        typeof fundingPolicy === 'object'
          ? {
              ...fundingPolicy,
              admins: 'admins' in fundingPolicy ? fundingPolicy.admins : [root.address],
            }
          : fundingPolicy
      expect(authorization.fundingPolicy).toEqual(expected)
      expect(authorization.address).toBe(key.address)
      expect(
        SignatureEnvelope.verify(authorization.signature, {
          address: root.address,
          payload: KeyAuthorization.getSignPayload(authorization),
        }),
      ).toMatchInlineSnapshot(`true`)
      const deferred = typeof fundingPolicy === 'object' && !('admins' in fundingPolicy)
      expect(digests.length).toMatchInlineSnapshot(`1`)
      expect(digests[0] !== undefined).toBe(method === 'login' && !deferred)
      expect(sign.mock.calls.length).toBe(method === 'register' || deferred ? 1 : 0)
      if (typeof authorization.fundingPolicy === 'object')
        expect(
          SignatureEnvelope.verify(authorization.signature, {
            address: root.address,
            payload: KeyAuthorization.getSignPayload({
              ...authorization,
              fundingPolicy: {
                ...authorization.fundingPolicy,
                rules: { ...rules, maxSlippageBps: 101 },
              },
            }),
          }),
        ).toMatchInlineSnapshot(`false`)
    })
  })

describe('wallet_authorizeAccessKey', () => {
  test.each(policies)(
    'returns an authorization for an app-owned WebCrypto key: %s',
    async (fundingPolicy) => {
      const provider = Provider.create({
        adapter: local({ loadAccounts: async () => ({ accounts: [root] }) }),
        chains: [tempoModerato],
        storage: Storage.memory(),
      })
      await provider.request({ method: 'wallet_connect' })
      const manager = KeyAuthorizationManager.memory()
      const key = Account.fromWebCryptoP256(await WebCryptoP256.createKeyPair(), {
        access: root.address,
        keyAuthorizationManager: manager,
      })
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          z.encode(Rpc.wallet_authorizeAccessKey.parameters, {
            address: key.accessKeyAddress,
            keyType: 'p256',
            expiry: 123,
            fundingPolicy,
          }),
        ],
      })
      const authorization = KeyAuthorization.fromRpc(result.keyAuthorization)
      manager.set(
        { address: root.address, accessKey: key.accessKeyAddress, chainId: tempoModerato.id },
        authorization,
      )
      expect(
        await manager.get({
          address: root.address,
          accessKey: key.accessKeyAddress,
          chainId: tempoModerato.id,
        }),
      ).toEqual(authorization)
      expect(result.rootAddress).toBe(root.address)
      expect(
        SignatureEnvelope.verify(authorization.signature, {
          address: root.address,
          payload: KeyAuthorization.getSignPayload(authorization),
        }),
      ).toMatchInlineSnapshot(`true`)
    },
  )

  test('rejects an explicit empty admin list before signing', async () => {
    const sign = vi.fn(root.sign)
    const provider = Provider.create({
      adapter: local({ loadAccounts: async () => ({ accounts: [{ ...root, sign }] }) }),
      chains: [tempoModerato],
      storage: Storage.memory(),
    })
    await provider.request({ method: 'wallet_connect' })
    await expect(
      provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            address: admin,
            expiry: 123,
            fundingPolicy: { admins: [], rules },
          },
        ],
      }),
    ).rejects.toThrow()
    await expect(
      provider.store.accessKeys.authorize({
        account: { ...root, sign },
        chainId: tempoModerato.id,
        parameters: { address: admin, expiry: 123, fundingPolicy: { admins: [], rules } },
      }),
    ).rejects.toThrow('admin')
    expect(sign).not.toHaveBeenCalled()
  })
})

describe('prepareAuthorization', () => {
  test.each(['address', 'privateKey', 'managed'] as const)(
    'preserves funding policies for %s keys',
    async (material) => {
      const { keyAuthorization } = await AccessKey.prepareAuthorization({
        chainId: 1,
        expiry: 123,
        fundingPolicy: { admins: [admin], rules },
        ...(material === 'address'
          ? { address: admin }
          : material === 'privateKey'
            ? { privateKey: `0x${'01'.repeat(32)}` as const }
            : {}),
      })
      expect(keyAuthorization.fundingPolicy).toEqual({ admins: [admin], rules })
    },
  )
})

test('eth_fillTransaction preserves the inline policy before funding-source discovery', async () => {
  const provider = Provider.create({
    chains: [tempoModerato],
    storage: Storage.memory(),
    transports: {
      [tempoModerato.id]: custom(
        {
          async request(request) {
            expect(request.method).toMatchInlineSnapshot(`"eth_fillTransaction"`)
            const [transaction] = request.params as [{ keyAuthorization: KeyAuthorization.Rpc }]
            expect(transaction.keyAuthorization.fundingPolicy).toEqual({
              admins: [root.address],
              rules,
            })
            const authorization = KeyAuthorization.fromRpc(transaction.keyAuthorization)
            expect(
              SignatureEnvelope.verify(authorization.signature, {
                address: root.address,
                payload: KeyAuthorization.getSignPayload(authorization),
              }),
            ).toMatchInlineSnapshot(`true`)
            throw new Error('Policy reached the funding transport')
          },
        },
        { retryCount: 0 },
      ),
    },
  })
  const authorization = KeyAuthorization.from({
    address: admin,
    type: 'p256',
    chainId: BigInt(tempoModerato.id),
    expiry: 123,
    fundingPolicy: { admins: [root.address], rules },
  })
  const signature = await root.sign({ hash: KeyAuthorization.getSignPayload(authorization) })
  await expect(
    provider.request({
      method: 'eth_fillTransaction',
      params: [
        {
          from: root.address,
          keyAuthorization: KeyAuthorization.toRpc(
            KeyAuthorization.from(authorization, { signature }),
          ),
        },
      ],
    }),
  ).rejects.toThrow('Policy reached the funding transport')
})
