import { Hex, PublicKey } from 'ox'
import { describe, expect, test } from 'vp/test'

import { accounts as core_accounts } from '../../../test/config.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { turnkey } from './turnkey.js'

const account = core_accounts[0]
const account_other = core_accounts[1]
const address = account.address
const other = account_other.address

describe('turnkey', () => {
  test('default: createAccount delegates registration and stores Turnkey signing metadata', async () => {
    const { adapter, client } = setup()

    const result = await adapter.actions.createAccount(
      { name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.initCalls).toMatchInlineSnapshot(`1`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "keyType": "secp256k1",
            "label": "Ada",
            "publicKey": "0x038318535b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed75",
            "source": "turnkey",
          },
        ],
      }
    `)
  })

  test('default: loadAccounts delegates login and stores Turnkey signing metadata', async () => {
    const { adapter, client } = setup()

    const connected = await adapter.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: undefined,
    })

    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(connected.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "keyType": "secp256k1",
          "publicKey": "0x038318535b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed75",
          "source": "turnkey",
        },
      ]
    `)
  })

  test('default: signs with stored Turnkey metadata through signRawPayload', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [toStoreAccount(account)], activeAccount: 0 })

    const result = await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
      ]
    `)
    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
    )
  })

  test('behavior: normalizes prefixed signature parts and hex recovery values', async () => {
    const { adapter, client, store } = setup({
      signature: {
        r: Hex.padLeft('0x33', 32),
        s: Hex.padLeft('0x44', 32),
        v: '0x1c',
      },
    })
    store.setState({ accounts: [toStoreAccount(account_other)], activeAccount: 0 })

    const result = await adapter.actions.signPersonalMessage(
      { address: other, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', other] },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x000000000000000000000000000000000000000000000000000000000000003300000000000000000000000000000000000000000000000000000000000000441c"`,
    )
  })

  test('behavior: store-only signing does not connect an empty provider store', async () => {
    const { adapter, client } = setup()

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Turnkey account connected.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: old persisted accounts without public keys must reconnect', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Turnkey account must reconnect.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: missing sessions clear provider accounts', async () => {
    const { adapter, client, store } = setup({ session: null })
    store.setState({ accounts: [toStoreAccount(account)], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Turnkey session expired.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: expired sessions clear provider accounts', async () => {
    const { adapter, client, store } = setup({ session: { expiry: 1 } })
    store.setState({ accounts: [toStoreAccount(account)], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Turnkey session expired.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: server session errors clear provider accounts', async () => {
    const { adapter, store } = setup({
      signError: { details: [{ turnkeyErrorCode: 'API_KEY_EXPIRED' }] },
    })
    store.setState({ accounts: [toStoreAccount(account)], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Turnkey session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: nested server session errors clear provider accounts', async () => {
    const { adapter, store } = setup({
      signError: { cause: { code: 'NO_SESSION_FOUND' } },
    })
    store.setState({ accounts: [toStoreAccount(account)], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Turnkey session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: unknown Turnkey signing errors do not clear provider accounts', async () => {
    const { adapter, store } = setup({ signError: { code: 'SOMETHING_ELSE' } })
    const account_store = toStoreAccount(account)
    store.setState({ accounts: [account_store], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot(`
      {
        "code": "SOMETHING_ELSE",
      }
    `)

    expect(store.getState().accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "keyType": "secp256k1",
          "publicKey": "0x038318535b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed75",
          "source": "turnkey",
        },
      ]
    `)
  })

  test('error: signing an unconnected account fails', async () => {
    const { adapter, store } = setup()
    const connected = await adapter.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: undefined,
    })
    store.setState({ accounts: connected.accounts, activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot(
      `[Provider.UnauthorizedError: Account "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650" not found.]`,
    )
  })

  test('default: disconnect logs out and clears provider state', async () => {
    const { adapter, client, store } = setup()
    store.setState({
      accessKeys: [
        {
          access: address,
          address: other,
          keyType: 'secp256k1',
        },
      ],
      accounts: [toStoreAccount(account)],
      activeAccount: 0,
    })

    await adapter.actions.disconnect?.()

    expect(client.logoutCalls).toMatchInlineSnapshot(`1`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })
})

function setup(options: setup.Options = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const client = createClient(options)
  const adapter = turnkey({
    client,
    createAccount: async () => toWalletAccount(account),
    loadAccounts: async () => {
      client.loadCalls++
      return [toWalletAccount(account)]
    },
  })({
    getAccount: (() => {
      throw new Error('not implemented')
    }) as never,
    getClient: (() => ({ chain: { id: 1 } })) as never,
    storage,
    store,
  })
  return { adapter, client, store }
}

declare namespace setup {
  type Options = {
    session?: turnkey.Session | null | undefined
    signature?: turnkey.SignatureResponse | undefined
    signError?: unknown
  }
}

function createClient(options: setup.Options = {}) {
  const state = {
    initCalls: 0,
    loadCalls: 0,
    signPayloads: [] as Hex.Hex[],
    signWith: [] as string[],
    logoutCalls: 0,
  }
  const client = {
    get initCalls() {
      return state.initCalls
    },
    get loadCalls() {
      return state.loadCalls
    },
    set loadCalls(value: number) {
      state.loadCalls = value
    },
    get signPayloads() {
      return state.signPayloads
    },
    get signWith() {
      return state.signWith
    },
    get logoutCalls() {
      return state.logoutCalls
    },
    getSession: async () =>
      options.session === undefined
        ? { expiry: Math.floor(Date.now() / 1000) + 60 }
        : options.session,
    httpClient: {
      signRawPayload: async (parameters: turnkey.SignRawPayloadParameters) => {
        if (options.signError) throw options.signError
        state.signPayloads.push(parameters.payload)
        state.signWith.push(parameters.signWith)
        return (
          options.signature ?? {
            r: Hex.padLeft('0x11', 32).slice(2),
            s: Hex.padLeft('0x22', 32).slice(2),
            v: '27',
          }
        )
      },
    },
    init: () => {
      state.initCalls++
    },
    logout: () => {
      state.logoutCalls++
    },
  } satisfies turnkey.Client & {
    initCalls: number
    loadCalls: number
    logoutCalls: number
    signPayloads: Hex.Hex[]
    signWith: string[]
  }

  return client
}

function toWalletAccount(account: (typeof core_accounts)[number]): turnkey.WalletAccount {
  return {
    address: account.address,
    addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
    publicKey: PublicKey.toHex(PublicKey.compress(PublicKey.from(account.publicKey))),
  }
}

function toStoreAccount(account: (typeof core_accounts)[number]): turnkey.Account {
  const walletAccount = toWalletAccount(account)
  const publicKey = walletAccount.publicKey
  Hex.assert(publicKey, { strict: true })
  return {
    address: account.address,
    keyType: 'secp256k1',
    publicKey,
    source: 'turnkey',
  }
}
