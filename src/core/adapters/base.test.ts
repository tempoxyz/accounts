import { Hex } from 'ox'
import { hashTypedData } from 'viem'
import { tempoLocalnet } from 'viem/chains'
import { Account as TempoAccount } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts as core_accounts, getClient, privateKeys } from '../../../test/config.js'
import * as Account from '../Account.js'
import type * as Adapter from '../Adapter.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { base } from './base.js'

const account = core_accounts[0]
const account_other = core_accounts[1]
const address = account.address
const other = account_other.address

describe('base', () => {
  test('default: loadAccounts returns discovered accounts', async () => {
    const { adapter } = setup()

    const result = await adapter.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: undefined,
    })

    expect(result.accounts.map(({ address, keyType }) => ({ address, keyType })))
      .toMatchInlineSnapshot(`
        [
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "keyType": "secp256k1",
          },
        ]
      `)
  })

  test('default: createAccount returns created accounts', async () => {
    const { adapter } = setup({
      createAccount: async () => resultFor(account_other),
    })

    const result = await adapter.actions.createAccount(
      { name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(result.accounts.map(({ address, keyType }) => ({ address, keyType })))
      .toMatchInlineSnapshot(`
        [
          {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
            "keyType": "secp256k1",
          },
        ]
      `)
  })

  test('behavior: personalSign passes hashMessage digest and signs when source does not', async () => {
    const calls: Adapter.loadAccounts.Parameters[] = []
    const { adapter } = setup({
      loadAccounts: async (parameters) => {
        calls.push(parameters)
        return resultFor(account)
      },
    })

    const result = await adapter.actions.loadAccounts(
      { personalSign: { message: 'hello' } },
      { method: 'wallet_connect', params: undefined },
    )

    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "digest": "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
          "personalSign": {
            "message": "hello",
          },
        },
      ]
    `)
    expect(result.personalSign).toMatchInlineSnapshot(`
      {
        "message": "hello",
      }
    `)
    expect(result.signature).toBeDefined()
  })

  test('behavior: digest and authorizeAccessKey use separate signatures', async () => {
    const digest = Hex.padLeft('0x12', 32)
    const calls: Adapter.loadAccounts.Parameters[] = []
    const { adapter } = setup({
      loadAccounts: async (parameters) => {
        calls.push(parameters)
        return resultFor(account)
      },
    })

    const result = await adapter.actions.loadAccounts(
      {
        authorizeAccessKey: {
          address: other,
          expiry: 123,
          keyType: 'secp256k1',
        },
        digest,
      },
      { method: 'wallet_connect', params: undefined },
    )

    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "authorizeAccessKey": {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
            "expiry": 123,
            "keyType": "secp256k1",
          },
          "digest": "0x0000000000000000000000000000000000000000000000000000000000000012",
        },
      ]
    `)
    expect(result.signature).toBeDefined()
    expect(result.keyAuthorization?.signature).toBeDefined()
    expect(result.keyAuthorization?.signature === result.signature).toMatchInlineSnapshot(`false`)
  })

  test('behavior: authorizeAccessKey alone signs the key authorization digest', async () => {
    const calls: Adapter.loadAccounts.Parameters[] = []
    const { adapter } = setup({
      loadAccounts: async (parameters) => {
        calls.push(parameters)
        return resultFor(account)
      },
    })

    const result = await adapter.actions.loadAccounts(
      {
        authorizeAccessKey: {
          address: other,
          expiry: 123,
          keyType: 'secp256k1',
        },
      },
      { method: 'wallet_connect', params: undefined },
    )

    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "authorizeAccessKey": {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
            "expiry": 123,
            "keyType": "secp256k1",
          },
          "digest": "0x9bf3842ede9b89ac0c5a205e9bccc794d0a2b4dd6514b11bc5956e7c6def249d",
        },
      ]
    `)
    expect(result.signature).toMatchInlineSnapshot(`undefined`)
    expect(result.keyAuthorization?.keyId).toMatchInlineSnapshot(
      `"0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650"`,
    )
  })

  test('behavior: source-provided signature is reused for authorizeAccessKey-only connect', async () => {
    const signature =
      '0xc5ceff480315bbfda10d12f23517af0f0d691d414a018e90a89106ea0a20d3c8057ac0761363effad2c00aeb3c0d7f3f811ee0226e27426879d5105093f8e7d71c'
    const { adapter } = setup({
      loadAccounts: async () => ({
        ...resultFor(account),
        signature,
      }),
    })

    const result = await adapter.actions.loadAccounts(
      {
        authorizeAccessKey: {
          address: other,
          expiry: 123,
          keyType: 'secp256k1',
        },
      },
      { method: 'wallet_connect', params: undefined },
    )

    expect(result.keyAuthorization?.signature).toMatchInlineSnapshot(`
      {
        "r": "0xc5ceff480315bbfda10d12f23517af0f0d691d414a018e90a89106ea0a20d3c8",
        "s": "0x057ac0761363effad2c00aeb3c0d7f3f811ee0226e27426879d5105093f8e7d7",
        "type": "secp256k1",
        "yParity": "0x1",
      }
    `)
  })

  test('error: personalSign and digest cannot both be requested', async () => {
    const { adapter } = setup()

    await expect(
      adapter.actions.loadAccounts(
        {
          digest: '0x1234',
          personalSign: { message: 'hello' },
        },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[ProviderRpcError: \`digest\` and \`personalSign\` cannot both be set on \`wallet_connect\`.]`,
    )
  })

  test('error: createAccount throws when unsupported', async () => {
    const { adapter } = setup()

    await expect(
      adapter.actions.createAccount(
        { name: 'Ada' },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnsupportedMethodError: \`createAccount\` not configured on adapter.]`,
    )
  })

  test('error: connect requiring a signature rejects unsigned account results', async () => {
    const { adapter } = setup({
      loadAccounts: async () => ({
        accounts: [{ address }],
      }),
    })

    await expect(
      adapter.actions.loadAccounts(
        { personalSign: { message: 'hello' } },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Connected account cannot sign.]`,
    )
  })

  test('default: authorizeAccessKey signs with resolved account', async () => {
    const { adapter, store } = setup()
    store.setState({ accounts: [storeAccountFor(account)], activeAccount: 0 })

    const result = await adapter.actions.authorizeAccessKey!(
      {
        address: other,
        expiry: 123,
        keyType: 'secp256k1',
      },
      { method: 'wallet_authorizeAccessKey', params: [{ expiry: 123 }] },
    )

    expect({
      chainId: result.keyAuthorization.chainId,
      keyId: result.keyAuthorization.keyId,
      keyType: result.keyAuthorization.keyType,
      rootAddress: result.rootAddress,
      signed: !!result.keyAuthorization.signature,
    }).toMatchInlineSnapshot(`
      {
        "chainId": "0x539",
        "keyId": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        "keyType": "secp256k1",
        "rootAddress": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "signed": true,
      }
    `)
  })

  test('default: signs personal messages with resolved account', async () => {
    const { adapter, store } = setup()
    store.setState({ accounts: [storeAccountFor(account)], activeAccount: 0 })

    const result = await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(!!result).toMatchInlineSnapshot(`true`)
  })

  test('default: signs typed data with resolved account', async () => {
    const { adapter, store } = setup()
    store.setState({ accounts: [storeAccountFor(account)], activeAccount: 0 })
    const data = {
      domain: { name: 'Tempo' },
      message: { value: 'hello' },
      primaryType: 'Message',
      types: {
        Message: [{ name: 'value', type: 'string' }],
      },
    } as const

    const result = await adapter.actions.signTypedData(
      { address, data: JSON.stringify(data) },
      { method: 'eth_signTypedData_v4', params: [address, JSON.stringify(data)] },
    )

    expect(!!result).toMatchInlineSnapshot(`true`)
    expect(hashTypedData(data)).toMatchInlineSnapshot(
      `"0x000c5fe9b9bfeb5fbf1e40fa0dd7fe5e1c9896e4ecb892bd20f162e3ea66278a"`,
    )
  })
})

function setup(overrides: Partial<base.Options> = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: tempoLocalnet.id, storage })
  const adapter = base({
    getAccount: (options) => Account.find({ ...options, signable: true, store }),
    getClient: () => getClient({ chain: tempoLocalnet }) as never,
    loadAccounts: async () => resultFor(account),
    resolveAccount: async (parameters = {}) =>
      Account.find({ ...parameters, signable: true, store }),
    store,
    storage,
    ...overrides,
  })
  return { adapter, store, storage }
}

function resultFor(account: TempoAccount.Account): base.ConnectResult {
  return {
    account,
    accounts: [storeAccountFor(account)],
  }
}

function storeAccountFor(account: TempoAccount.Account): Account.Store {
  const index = core_accounts.findIndex((a) => a.address === account.address)
  return {
    address: account.address,
    keyType: 'secp256k1',
    privateKey: privateKeys[index]!,
  }
}
