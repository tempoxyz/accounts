import { Hex } from 'ox'
import { describe, expect, test } from 'vp/test'

import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { privy } from './privy.js'

const address = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'
const signature = Hex.concat(Hex.padLeft('0x11', 32), Hex.padLeft('0x22', 32), '0x1b')

describe('privy', () => {
  test('default: createAccount delegates registration and raw-signs the requested digest', async () => {
    const { adapter, client, provider } = setup()

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.initCalls).toMatchInlineSnapshot(`1`)
    expect(provider.requests).toMatchInlineSnapshot(`
      [
        {
          "method": "secp256k1_sign",
          "params": [
            "0x1234",
          ],
        },
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

  test('default: loadAccounts delegates login and caches providers for personal signing', async () => {
    const { adapter, client, provider } = setup()

    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })
    const result = await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.initCalls).toMatchInlineSnapshot(`1`)
    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(provider.signPayloads).toMatchInlineSnapshot(`
      [
        "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
    )
  })

  test('default: loadAccounts can provision an external access key', async () => {
    const { adapter, provider } = setup()

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

    expect(provider.signPayloads).toMatchInlineSnapshot(`
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

  test('default: authorizeAccessKey restores persisted accounts through the Privy client', async () => {
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

    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
    expect(client.providerCalls.map((wallet) => wallet.address)).toMatchInlineSnapshot(`
      [
        "0x0000000000000000000000000000000000000001",
      ]
    `)
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

  test('default: restore can use an app-provided silent account loader', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 1, storage })
    store.setState({ accounts: [{ address }], activeAccount: 0 })
    const provider = createProvider()
    const client = createClient({ accounts: [] })
    let restoreCalls = 0
    let loadCalls = 0
    const adapter = privy({
      client,
      createAccount: async () => ({ address, provider }),
      loadAccounts: async () => {
        loadCalls++
        return []
      },
      restoreAccounts: async () => {
        restoreCalls++
        return [{ address, provider }]
      },
    })({
      getAccount: (() => {
        throw new Error('not implemented')
      }) as never,
      getClient: (() => ({ chain: { id: 1 } })) as never,
      storage,
      store,
    })

    await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(loadCalls).toMatchInlineSnapshot(`0`)
    expect(restoreCalls).toMatchInlineSnapshot(`1`)
    expect(provider.signPayloads).toMatchInlineSnapshot(`
      [
        "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
      ]
    `)
  })

  test('default: signTypedData hashes typed data before raw signing', async () => {
    const { adapter, provider } = setup()
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    const data = JSON.stringify({
      domain: { name: 'Tempo' },
      message: { value: 'hello' },
      primaryType: 'Message',
      types: { Message: [{ name: 'value', type: 'string' }] },
    })
    await adapter.actions.signTypedData(
      { address, data },
      { method: 'eth_signTypedData_v4', params: [address, data] },
    )

    expect(provider.signPayloads).toMatchInlineSnapshot(`
      [
        "0x000c5fe9b9bfeb5fbf1e40fa0dd7fe5e1c9896e4ecb892bd20f162e3ea66278a",
      ]
    `)
  })

  test('behavior: restored accounts must match persisted provider state', async () => {
    const { adapter, store } = setup({ accounts: [] })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Privy account connected.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: missing restored signer clears all provider accounts', async () => {
    const { adapter, store } = setup()
    store.setState({ accounts: [{ address }, { address: other }], activeAccount: 1 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Privy account connected.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: Privy session errors clear provider accounts', async () => {
    const { adapter, store } = setup({
      requestError: { code: 'attempted_rpc_call_before_logged_in', message: 'Not logged in' },
    })
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session disconnected.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: createAccount requires the callback to leave a valid Privy session', async () => {
    const { adapter, store } = setup({ accessToken: null })

    await expect(
      adapter.actions.createAccount(
        { digest: '0x1234', name: 'Ada' },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session disconnected.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('error: raw signing is required for digest signatures', async () => {
    const { adapter } = setup({ rawSigning: false })

    await expect(
      adapter.actions.createAccount(
        { digest: '0x1234', name: 'Ada' },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[Provider.UnsupportedMethodError: Privy adapter requires raw secp256k1 hash signing via `secp256k1_sign` for Tempo transactions and access keys.]',
    )
  })

  test('default: disconnect logs out the current Privy user and clears provider state', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.disconnect!()

    expect(client.logoutCalls).toMatchInlineSnapshot(`
      [
        {
          "userId": "user_1",
        },
      ]
    `)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('default: disconnect supports no-argument Core logout shapes', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 1, storage })
    let logoutCalls = 0
    const client = {
      auth: {
        logout() {
          logoutCalls++
        },
      },
      async getAccessToken() {
        return 'token'
      },
      embeddedWallet: {
        async getProvider() {
          return createProvider()
        },
      },
      user: {
        async get() {
          return { user: { id: 'user_1' } }
        },
      },
    }
    const adapter = privy({
      client,
      createAccount: async () => ({ address, provider: createProvider() }),
      loadAccounts: async () => [],
    })({
      getAccount: (() => {
        throw new Error('not implemented')
      }) as never,
      getClient: (() => ({ chain: { id: 1 } })) as never,
      storage,
      store,
    })

    await adapter.actions.disconnect!()

    expect(logoutCalls).toMatchInlineSnapshot(`1`)
  })

})

function setup(options: setup.Options = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const provider = createProvider(options)
  const accounts = options.accounts ?? [{ address, provider }]
  const client = createClient({
    accessToken: options.accessToken,
    accounts,
  })
  const adapter = privy({
    client,
    createAccount: async () => ({ address, provider }),
    loadAccounts: async () => {
      client.loadCalls++
      return accounts
    },
  })({
    getAccount: (() => {
      throw new Error('not implemented')
    }) as never,
    getClient: (() => ({ chain: { id: 1 } })) as never,
    storage,
    store,
  })
  return { adapter, client, provider, store }
}

declare namespace setup {
  type Options = {
    accessToken?: string | null | undefined
    accounts?: readonly privy.WalletAccount[] | undefined
    rawSigning?: boolean | undefined
    requestError?: unknown
  }
}

function createProvider(options: setup.Options = {}) {
  const provider = {
    requests: [] as { method: string; params?: unknown[] | undefined }[],
    signPayloads: [] as Hex.Hex[],
    async request(parameters: { method: string; params?: unknown[] | undefined }) {
      if (options.requestError) throw options.requestError
      provider.requests.push(parameters)

      if (parameters.method === 'secp256k1_sign') {
        if (options.rawSigning === false) throw { code: 4200, message: 'Unsupported method' }
        const payload = parameters.params?.[0]
        if (typeof payload === 'string') provider.signPayloads.push(payload as Hex.Hex)
        return signature
      }

      if (parameters.method === 'personal_sign') return signature
      if (parameters.method === 'eth_signTypedData_v4') return signature
      throw { code: 4200, message: 'Unsupported method' }
    },
  } satisfies privy.EthereumProvider & {
    requests: { method: string; params?: unknown[] | undefined }[]
    signPayloads: Hex.Hex[]
  }

  return provider
}

function createClient(options: createClient.Options = {}) {
  const { accessToken = 'token', accounts = [] } = options
  const linked = accounts.map((account, index) =>
    linkedAccount({ address: account.address, index }),
  )
  const client = {
    initCalls: 0,
    loadCalls: 0,
    logoutCalls: [] as { userId: string }[],
    providerCalls: [] as privy.EmbeddedWallet[],
    auth: {
      logout(parameters?: { userId: string } | undefined) {
        if (parameters?.userId) client.logoutCalls.push({ userId: parameters.userId })
      },
    },
    embeddedWallet: {
      async getProvider(wallet: privy.EmbeddedWallet) {
        client.providerCalls.push(wallet)
        const account = accounts.find((account) => account.address === wallet.address)
        if (!account) throw { code: 'embedded_wallet_does_not_exist' }
        return account.provider
      },
    },
    async getAccessToken() {
      return accessToken
    },
    initialize() {
      client.initCalls++
    },
    user: {
      async get() {
        return { user: { id: 'user_1', linked_accounts: linked } }
      },
    },
  } satisfies privy.Client & {
    initCalls: number
    loadCalls: number
    logoutCalls: { userId: string }[]
    providerCalls: privy.EmbeddedWallet[]
  }

  return client
}

declare namespace createClient {
  type Options = {
    accessToken?: string | null | undefined
    accounts?: readonly privy.WalletAccount[] | undefined
  }
}

function linkedAccount(parameters: { address: string; index: number }): privy.LinkedAccount {
  const { address, index } = parameters
  return {
    address,
    chain_type: 'ethereum',
    connector_type: 'embedded',
    recovery_method: 'privy',
    type: 'wallet',
    wallet_client_type: 'privy',
    wallet_index: index,
  }
}
