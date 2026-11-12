import { Hex } from 'ox'
import { custom } from 'viem'
import { sendTransactionSync } from 'viem/actions'
import { Actions } from 'viem/tempo'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { vi } from 'vitest'
import { afterEach, beforeEach, describe, expect, test } from 'vp/test'

import * as Adapter from './Adapter.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

vi.mock('viem/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem/actions')>()),
  sendTransactionSync: vi.fn(),
}))

const address = '0x1111111111111111111111111111111111111111'
const key = '0x2222222222222222222222222222222222222222'
const token = '0x20c0000000000000000000000000000000000001'
const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
const parameters = {
  address,
  accessKeyAddress: key,
  limits: [{ token, limit: '0x0' }],
} as const

beforeEach(() => {
  vi.mocked(sendTransactionSync).mockReset()
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled'))
})

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

async function setup() {
  const sign = vi.fn(async () => {
    throw new Error('Signing disabled')
  })
  const account = { address, type: 'local', sign } as const
  const getAccount = vi.fn(() => ({ account }) as never)
  const request = vi.fn(async () => {
    throw new Error('RPC disabled')
  })
  const actions: Adapter.Instance['actions'] = {
    async createAccount() {
      return { accounts: [{ address }] }
    },
    async loadAccounts() {
      return { accounts: [{ address }] }
    },
  }
  const provider = Provider.create({
    adapter: Adapter.define({ name: 'Synthetic wallet', rdns: 'test.update-access-key' }, () => ({
      actions,
      getAccount,
    })),
    chains: [tempo, tempoModerato],
    mpp: false,
    storage: Storage.memory(),
    transports: {
      [tempo.id]: custom({ request }, { retryCount: 0 }),
      [tempoModerato.id]: custom({ request }, { retryCount: 0 }),
    },
  })
  await provider.ready()
  provider.store.setState({
    accounts: [{ address }],
    activeAccount: 0,
    accessKeys: [tempo.id, tempoModerato.id].map((chainId) => ({
      access: address,
      address: key,
      chainId,
      keyType: 'secp256k1',
      limits: [{ token, limit: 9n }],
      permissionSemantics: 1,
    })),
  })
  return { account, actions, getAccount, provider, request, sign }
}

describe('wallet_updateAccessKey fallback', () => {
  test.each(['pending', 'reverted'] as const)('rejects a %s receipt', async (status) => {
    const fixture = await setup()
    const before = structuredClone(fixture.provider.store.getState())
    vi.mocked(sendTransactionSync).mockResolvedValueOnce({ status, transactionHash: hash } as never)

    const request = fixture.provider.request({
      method: 'wallet_updateAccessKey',
      params: [parameters],
    })
    await expect(request).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.ResourceUnavailableError: Access-key update is not confirmed]`,
    )
    await expect(request).rejects.toMatchObject({
      code: -32002,
      data: { chainId: tempo.id, status, transactionHash: hash },
    })

    expect(sendTransactionSync).toHaveBeenCalledTimes(1)
    expect(fixture.provider.store.getState()).toEqual(before)
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(fixture.request).not.toHaveBeenCalled()
  })

  test.each([undefined, tempoModerato.id])(
    'returns success only after a confirmed receipt (chainId: %s)',
    async (chainId) => {
      const fixture = await setup()
      const before = structuredClone(fixture.provider.store.getState())
      vi.mocked(sendTransactionSync).mockResolvedValueOnce({ status: 'success' } as never)

      expect(
        await fixture.provider.request({
          method: 'wallet_updateAccessKey',
          params: [
            {
              ...parameters,
              ...(chainId !== undefined ? { chainId: Hex.fromNumber(chainId) } : {}),
            },
          ],
        }),
      ).toMatchInlineSnapshot('undefined')
      expect(sendTransactionSync).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ chain: expect.objectContaining({ id: chainId ?? tempo.id }) }),
        {
          account: fixture.account,
          calls: [Actions.accessKey.updateLimit.call({ accessKey: key, token, limit: 0n })],
        },
      )
      expect(fixture.provider.store.getState()).toEqual(before)
      expect(fixture.getAccount).toHaveBeenCalledExactlyOnceWith({ address })
      expect(fixture.sign).not.toHaveBeenCalled()
      expect(fixture.request).not.toHaveBeenCalled()
    },
  )

  test('propagates submission failures without reporting success or changing state', async () => {
    const fixture = await setup()
    const before = structuredClone(fixture.provider.store.getState())
    vi.mocked(sendTransactionSync).mockRejectedValueOnce(new Error('Submission failed.'))

    await expect(
      fixture.provider.request({ method: 'wallet_updateAccessKey', params: [parameters] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[RpcResponse.InternalError: Submission failed.]`)
    expect(sendTransactionSync).toHaveBeenCalledTimes(1)
    expect(fixture.provider.store.getState()).toEqual(before)
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(fixture.request).not.toHaveBeenCalled()
  })

  test('rejects an unconfigured chain before selecting an adapter account or submitting', async () => {
    const fixture = await setup()
    const before = structuredClone(fixture.provider.store.getState())

    await expect(
      fixture.provider.request({
        method: 'wallet_updateAccessKey',
        params: [{ ...parameters, chainId: '0x1' }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnsupportedChainIdError: Chain 1 not configured.]`,
    )
    expect(fixture.getAccount).not.toHaveBeenCalled()
    expect(sendTransactionSync).not.toHaveBeenCalled()
    expect(fixture.provider.store.getState()).toEqual(before)
  })

  test('rejects an unconnected account before selecting an adapter account or submitting', async () => {
    const fixture = await setup()
    const before = structuredClone(fixture.provider.store.getState())

    await expect(
      fixture.provider.request({
        method: 'wallet_updateAccessKey',
        params: [{ ...parameters, address: '0x3333333333333333333333333333333333333333' }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "0x3333333333333333333333333333333333333333" not found.]`,
    )
    expect(fixture.getAccount).not.toHaveBeenCalled()
    expect(sendTransactionSync).not.toHaveBeenCalled()
    expect(fixture.provider.store.getState()).toEqual(before)
  })

  test('preserves adapter-defined updates that return no receipt', async () => {
    const fixture = await setup()
    fixture.actions.updateAccessKey = vi.fn(async () => {})

    expect(
      await fixture.provider.request({ method: 'wallet_updateAccessKey', params: [parameters] }),
    ).toMatchInlineSnapshot('undefined')
    expect(fixture.actions.updateAccessKey).toHaveBeenCalledTimes(1)
    expect(fixture.getAccount).not.toHaveBeenCalled()
    expect(sendTransactionSync).not.toHaveBeenCalled()
    expect(fixture.sign).not.toHaveBeenCalled()
    expect(fixture.request).not.toHaveBeenCalled()
  })
})
