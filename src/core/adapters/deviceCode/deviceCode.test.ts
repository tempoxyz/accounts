import { Hex } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { afterEach, expect, test, vi } from 'vp/test'

import { accounts, chain } from '../../../../test/config.js'
import { createDeviceCodeHost, submitVerify } from '../../../../test/deviceCode.js'
import { testKeystore } from '../../../../test/keystore.js'
import { createServer } from '../../../../test/utils.js'
import * as Adapter from '../../Adapter.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import * as Store from '../../Store.js'
import { deviceCode } from './deviceCode.js'

const root = accounts[0]!
const future = 10_000_000_000

afterEach(() => vi.restoreAllMocks())

test.each([{ permissions: undefined }, { permissions: [] }] as const)(
  'non-expiring authorization survives device transport and reload (permissions: %j)',
  async ({ permissions }) => {
    const host = createDeviceCodeHost()
    const server = await createServer(host.listener)
    const storage = Storage.memory()
    const options = {
      accessKey: { keystores: { p256: testKeystore() } },
      adapter: deviceCode({
        name: 'Accounts Test CLI',
        rdns: 'xyz.tempo.accounts.test',
        onPrompt: (prompt) => void submitVerify(prompt),
        url: `${server.url}/auth/device`,
      }),
      chains: [chain] as const,
      storage,
    }
    try {
      const provider = Provider.create(options)
      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: {
                expiry: 0,
                limits: permissions,
                scopes: permissions,
              },
            },
          },
        ],
      })
      const authorization = result.accounts[0]!.capabilities.keyAuthorization!
      expect(authorization.expiry).toBeNull()
      expect(authorization.limits).toEqual(permissions)
      expect(authorization.allowedCalls).toEqual(permissions)
      expect(host.requests()[0]!.params).toMatchObject([
        { capabilities: { authorizeAccessKey: { expiry: 0, address: authorization.address } } },
      ])
      expect(JSON.stringify(host.requests())).not.toContain('"privateKey"')
      expect(
        SignatureEnvelope.verify(SignatureEnvelope.fromRpc(authorization.signature), {
          address: root.address,
          payload: KeyAuthorization.getSignPayload(KeyAuthorization.fromRpc(authorization)),
        }),
      ).toBe(true)

      const reloaded = Provider.create(options)
      await Store.waitForHydration(reloaded.store)
      const record = reloaded.store.getState().accessKeys[0]!
      expect(record.expiry).toBeUndefined()
      expect(record.keyAuthorization!.expiry).toBeUndefined()
      expect(record.limits).toEqual(permissions)
      expect(record.scopes).toEqual(permissions)
      const query = { account: root.address, chainId: chain.id, now: future }
      expect(Boolean(await reloaded.store.accessKeys.select(query))).toBe(permissions === undefined)
      expect(
        await reloaded.store.accessKeys.select({ ...query, chainId: chain.id + 1 }),
      ).toBeUndefined()
      expect(
        Boolean(
          await reloaded.store.accessKeys.select({
            ...query,
            calls: [{ to: root.address, data: '0x12345678' }],
          }),
        ),
      ).toBe(permissions === undefined)

      // Keep the signed authorization until publication so an unused grant can be revoked.
      const revoke = vi
        .fn<NonNullable<Adapter.Instance['actions']['revokeAccessKey']>>()
        .mockResolvedValue(undefined)
      host.setProviderOptions({
        adapter: Adapter.define({}, () => ({
          actions: {
            revokeAccessKey: revoke,
            createAccount: async () => ({ accounts: [root] }),
            loadAccounts: async () => ({ accounts: [root] }),
          },
        })),
      })
      revoke.mockRejectedValue(new Error('revocation rejected'))
      await expect(
        reloaded.request({
          method: 'wallet_revokeAccessKey',
          params: [
            {
              address: root.address,
              accessKeyAddress: record.address,
              keyAuthorization: authorization,
            },
          ],
        }),
      ).rejects.toThrow('revocation rejected')
      expect(reloaded.store.getState().accessKeys).toHaveLength(1)
      revoke.mockResolvedValue(undefined)
      await reloaded.request({
        method: 'wallet_revokeAccessKey',
        params: [
          {
            address: root.address,
            accessKeyAddress: record.address,
            keyAuthorization: authorization,
          },
        ],
      })
      expect(revoke).toHaveBeenCalled()
      expect(revoke.mock.calls[0]![0].keyAuthorization).toEqual(
        KeyAuthorization.fromRpc(authorization),
      )
      expect(reloaded.store.getState().accessKeys).toEqual([])
      const revoked = Provider.create(options)
      await Store.waitForHydration(revoked.store)
      expect(await revoked.store.accessKeys.select(query)).toBeUndefined()
      expect(host.requests()[0]!.method).toBe('wallet_connect')
      expect(
        host
          .requests()
          .slice(1)
          .every((request) => request.method === 'wallet_revokeAccessKey'),
      ).toBe(true)
    } finally {
      await server.closeAsync()
    }
  },
)

test('finite authorization stays finite through device transport and reload', async () => {
  const host = createDeviceCodeHost()
  const server = await createServer(host.listener)
  const storage = Storage.memory()
  const options = {
    accessKey: { keystores: { p256: testKeystore() } },
    adapter: deviceCode({
      name: 'Accounts Test CLI',
      rdns: 'xyz.tempo.accounts.test',
      onPrompt: (prompt) => void submitVerify(prompt),
      url: `${server.url}/auth/device`,
    }),
    chains: [chain] as const,
    storage,
  }
  try {
    const provider = Provider.create(options)
    await provider.request({ method: 'wallet_connect' })
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const result = await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry }],
    })
    expect(result.keyAuthorization.expiry).toBe(Hex.fromNumber(expiry))
    const reloaded = Provider.create(options)
    await Store.waitForHydration(reloaded.store)
    expect(reloaded.store.getState().accessKeys[0]!.expiry).toBe(expiry)
    const query = { account: root.address, chainId: chain.id }
    expect(await reloaded.store.accessKeys.select({ ...query, now: expiry - 1 })).toBeDefined()
    expect(await reloaded.store.accessKeys.select({ ...query, now: expiry + 1 })).toBeUndefined()
  } finally {
    await server.closeAsync()
  }
})

test.each(['deny', 'timeout'] as const)(
  '%s leaves no non-expiring authorization after reload',
  async (action) => {
    const host = createDeviceCodeHost({ pollingInterval: 10 })
    const server = await createServer(host.listener)
    const storage = Storage.memory()
    const options = {
      accessKey: { keystores: { p256: testKeystore() } },
      adapter: deviceCode({
        name: 'Accounts Test CLI',
        rdns: 'xyz.tempo.accounts.test',
        onPrompt: (prompt) => {
          if (action === 'deny') void submitVerify(prompt, { action })
        },
        timeout: action === 'timeout' ? 100 : 1000,
        url: `${server.url}/auth/device`,
      }),
      chains: [chain] as const,
      storage,
    }
    try {
      const provider = Provider.create(options)
      await expect(
        provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { authorizeAccessKey: { expiry: 0 } } }],
        }),
      ).rejects.toThrow(action === 'deny' ? 'User denied' : 'Timed out')
      const reloaded = Provider.create(options)
      await Store.waitForHydration(reloaded.store)
      expect(reloaded.store.getState().accessKeys).toEqual([])
      expect(reloaded.store.getState().accounts).toEqual([])
    } finally {
      await server.closeAsync()
    }
  },
)
