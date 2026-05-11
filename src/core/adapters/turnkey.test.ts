import { Hex } from 'ox'
import { describe, expect, test } from 'vp/test'

import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { turnkey } from './turnkey.js'

const address = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'

describe('turnkey', () => {
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

  test('default: loadAccounts delegates login and caches wallet accounts for signing', async () => {
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

  test('default: authorizeAccessKey signs with the connected Turnkey account', async () => {
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

    expect(client.fetchCalls).toMatchInlineSnapshot(`1`)
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

    expect(client.fetchCalls).toMatchInlineSnapshot(`1`)
    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
  })

  test('behavior: silent restore does not connect accounts when the provider store is empty', async () => {
    const { adapter, client } = setup()

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Turnkey account connected.]')

    expect(client.fetchCalls).toMatchInlineSnapshot(`0`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: silent restore only reconnects persisted provider accounts', async () => {
    const { adapter, client, store } = setup()
    client.wallets = [
      {
        accounts: [
          { address, addressFormat: 'ADDRESS_FORMAT_ETHEREUM' },
          { address: other, addressFormat: 'ADDRESS_FORMAT_ETHEREUM' },
        ],
      },
    ]
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

  test('behavior: silent restore ignores non-Ethereum wallet accounts', async () => {
    const { adapter, client, store } = setup()
    client.wallets = [
      {
        accounts: [
          {
            address,
            addressFormat: 'ADDRESS_FORMAT_SUI',
          },
        ],
      },
    ]
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Turnkey account connected.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: expired sessions clear provider accounts', async () => {
    const { adapter, client, store } = setup({ session: { expiry: 1 } })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

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
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Turnkey session expired.]')

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
})

function setup(options: setup.Options = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const client = createClient(options)
  const adapter = turnkey({
    client,
    createAccount: async () => ({ address }),
    loadAccounts: async () => {
      client.loadCalls++
      return [{ address }]
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
    signError?: unknown
  }
}

function createClient(options: setup.Options = {}) {
  const client = {
    fetchCalls: 0,
    initCalls: 0,
    loadCalls: 0,
    signPayloads: [] as Hex.Hex[],
    signWith: [] as string[],
    wallets: [{ accounts: [{ address, addressFormat: 'ADDRESS_FORMAT_ETHEREUM' }] }],
    async fetchWallets() {
      client.fetchCalls++
      return client.wallets
    },
    async getSession() {
      return options.session === undefined
        ? { expiry: Math.floor(Date.now() / 1000) + 60 }
        : options.session
    },
    httpClient: {
      async signRawPayload(parameters: turnkey.SignRawPayloadParameters) {
        if (options.signError) throw options.signError
        client.signPayloads.push(parameters.payload)
        client.signWith.push(parameters.signWith)
        return {
          r: Hex.padLeft('0x11', 32),
          s: Hex.padLeft('0x22', 32),
          v: '27',
        }
      },
    },
    init() {
      client.initCalls++
    },
    logout() {},
  } satisfies turnkey.Client & {
    fetchCalls: number
    initCalls: number
    loadCalls: number
    signPayloads: Hex.Hex[]
    signWith: string[]
    wallets: turnkey.Wallet[]
  }

  return client
}
