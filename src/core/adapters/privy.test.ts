import { Hex } from 'ox'
import { describe, expect, test } from 'vp/test'

import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { privy } from './privy.js'

const address = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'

const stubSignature = Hex.concat(Hex.padLeft('0x11', 32), Hex.padLeft('0x22', 32), '0x1b')

describe('privy', () => {
  test('default: createAccount delegates registration and signs the requested digest', async () => {
    const { adapter, client } = setup()

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.initCalls).toMatchInlineSnapshot(`1`)
    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x1234",
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
            "label": "Ada",
          },
        ],
        "signature": "0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b",
      }
    `)
  })

  test('default: loadAccounts delegates login and caches embedded wallets for signing', async () => {
    const { adapter, client } = setup()

    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })
    const result = await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x0000000000000000000000000000000000000001",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
    )
  })

  test('default: loadAccounts can provision an external access key', async () => {
    const { adapter, client } = setup()

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

    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x219d0ef7a59d2a40d6ff9e115e32fb6b53eb7fa518ea3364b7b806990fad3944",
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "keyAuthorization": {
          "chainId": "0x1",
          "expiry": "0x7b",
          "keyId": "0x0000000000000000000000000000000000000002",
          "keyType": "secp256k1",
          "limits": undefined,
          "signature": {
            "r": "0x0000000000000000000000000000000000000000000000000000000000000011",
            "s": "0x0000000000000000000000000000000000000000000000000000000000000022",
            "type": "secp256k1",
            "yParity": "0x0",
          },
        },
        "signature": undefined,
      }
    `)
  })

  test('default: authorizeAccessKey signs with the connected Privy account', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    const result = await adapter.actions.authorizeAccessKey!(
      {
        address: other,
        expiry: 123,
        keyType: 'secp256k1',
      },
      { method: 'wallet_authorizeAccessKey', params: [{ expiry: 123 }] },
    )

    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(result).toMatchInlineSnapshot(`
      {
        "keyAuthorization": {
          "chainId": "0x1",
          "expiry": "0x7b",
          "keyId": "0x0000000000000000000000000000000000000002",
          "keyType": "secp256k1",
          "limits": undefined,
          "signature": {
            "r": "0x0000000000000000000000000000000000000000000000000000000000000011",
            "s": "0x0000000000000000000000000000000000000000000000000000000000000022",
            "type": "secp256k1",
            "yParity": "0x0",
          },
        },
        "rootAddress": "0x0000000000000000000000000000000000000001",
      }
    `)
  })

  test('behavior: signing silently restores wallet accounts from an existing session', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
  })

  test('behavior: silent restore does not connect accounts when the provider store is empty', async () => {
    const { adapter, client } = setup()

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Privy account connected.]')

    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: silent restore only reconnects persisted provider accounts', async () => {
    const { adapter, client, store } = setup()
    client.wallets = [client.makeWallet(address), client.makeWallet(other)]
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await adapter.actions.signPersonalMessage(
      { address: other, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', other] },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x0000000000000000000000000000000000000002",
      ]
    `)
    expect(store.getState().accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x0000000000000000000000000000000000000002",
        },
      ]
    `)
  })

  test('behavior: expired sessions clear provider accounts', async () => {
    const { adapter, client, store } = setup({ token: null })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: server session errors clear provider accounts', async () => {
    const { adapter, store } = setup({ signError: { code: 'not_authenticated' } })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('error: signing an unconnected account fails', async () => {
    const { adapter } = setup()
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[Provider.UnauthorizedError: Account "0x0000000000000000000000000000000000000002" not found.]',
    )
  })

  test('disconnect: clears provider accounts and logs the user out of Privy', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.disconnect!()

    expect(client.logoutCalls).toMatchInlineSnapshot(`1`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })
})

function setup(options: setup.Options = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const client = createClient(options)
  const adapter = privy({
    client,
    createAccount: async () => client.makeWallet(address),
    loadAccounts: async () => {
      client.loadCalls++
      return client.wallets
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
    token?: string | null | undefined
    signError?: unknown
  }
}

function createClient(options: setup.Options = {}) {
  const client = {
    initCalls: 0,
    loadCalls: 0,
    logoutCalls: 0,
    signPayloads: [] as Hex.Hex[],
    signWith: [] as string[],
    wallets: [] as privy.EmbeddedWallet[],
    makeWallet(address: string): privy.EmbeddedWallet {
      return {
        address,
        signRawHash: async (hash) => {
          if (options.signError) throw options.signError
          client.signPayloads.push(hash)
          client.signWith.push(address)
          return stubSignature
        },
      }
    },
    auth: {
      logout() {
        client.logoutCalls++
      },
    },
    async getAccessToken() {
      return options.token === undefined ? 'token' : options.token
    },
    initialize() {
      client.initCalls++
    },
  } satisfies privy.Client & {
    initCalls: number
    loadCalls: number
    logoutCalls: number
    signPayloads: Hex.Hex[]
    signWith: string[]
    wallets: privy.EmbeddedWallet[]
    makeWallet: (address: string) => privy.EmbeddedWallet
  }

  client.wallets = [client.makeWallet(address)]

  return client
}
