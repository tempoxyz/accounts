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

    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
    expect(client.restoreCalls).toMatchInlineSnapshot(`1`)
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

  test('behavior: signing silently restores wallet accounts via the Privy SDK', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.restoreCalls).toMatchInlineSnapshot(`1`)
    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
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
    expect(client.restoreCalls).toMatchInlineSnapshot(`0`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: silent restore only reconnects persisted provider accounts', async () => {
    const { adapter, client, store } = setup()
    client.addLinkedWallet(other)
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
    const { adapter, store } = setup({ signError: { code: 'embedded_wallet_request_error' } })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: session errors are recognized via fuzzy code match', async () => {
    const { adapter, store } = setup({ signError: { code: 'session_invalid_token' } })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: session errors are recognized via nested cause messages', async () => {
    const inner = new Error('User must be logged in to sign.')
    const outer = new Error('Wallet operation failed', { cause: inner })
    const { adapter, store } = setup({ signError: outer })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: session errors are recognized via message fallback', async () => {
    const { adapter, store } = setup({
      signError: Object.assign(new Error('User must be logged in to sign.'), {}),
    })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: silent restore clears store when persisted address is no longer in user', async () => {
    const { adapter, client, store } = setup()
    // Persisted address that is NOT linked on the Privy user.
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Privy account connected.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('error: silent restore rejects malformed wallet addresses', async () => {
    const { adapter, client, store } = setup()
    client.addLinkedWallet('0xnot-an-address')
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toThrowError(/Address.*invalid/i)
  })

  test('error: silent restore rejects non-hex secp256k1_sign results', async () => {
    const { adapter, store } = setup({ signResult: 'not-hex' })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[ProviderRpcError: Privy provider returned a non-hex secp256k1_sign result.]',
    )
  })

  test('error: app-returned wallet with malformed address is rejected at connect', async () => {
    const { adapter, client } = setup()
    client.wallets = [client.makeWallet('0xnot-an-address')]

    await expect(
      adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined }),
    ).rejects.toThrowError(/Address.*invalid/i)
  })

  test('error: app-provided provider secp256k1_sign result is hex-validated', async () => {
    const { adapter } = setup({ signResult: 'not-hex' })
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[ProviderRpcError: Privy provider returned a non-hex secp256k1_sign result.]',
    )
  })

  test('error: signing an unconnected account fails', async () => {
    const { adapter } = setup()
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Privy account connected.]')
  })

  test('error: unsupported secp256k1_sign maps to UnsupportedMethodError', async () => {
    const { adapter, store } = setup({ signError: { code: 4200, message: 'Method not supported' } })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[Provider.UnsupportedMethodError: Privy adapter requires raw secp256k1 hash signing via `secp256k1_sign` for Tempo transactions and access keys.]',
    )
  })

  test('disconnect: clears provider accounts even when logout throws', async () => {
    const { adapter, store } = setup({ logoutError: new Error('logout failed') })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(adapter.actions.disconnect!()).rejects.toThrowError('logout failed')
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('init: a failed initialize is retried on the next call', async () => {
    const { adapter, client } = setup({ initError: new Error('init failed') })

    await expect(
      adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined }),
    ).rejects.toThrowError('init failed')
    expect(client.initCalls).toMatchInlineSnapshot(`1`)

    // Second call should retry initialize and succeed.
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })
    expect(client.initCalls).toMatchInlineSnapshot(`2`)
  })

  test('disconnect: clears provider accounts and logs the user out of Privy', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.disconnect!()

    expect(client.logoutCalls).toMatchInlineSnapshot(`1`)
    expect(client.logoutWith).toMatchInlineSnapshot(`
      [
        "user_1",
      ]
    `)
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
    /** Override the value returned by the embedded provider's `secp256k1_sign`. */
    signResult?: unknown
    /** Make `client.auth.logout` throw, to test disconnect cleanup. */
    logoutError?: unknown
    /** Make `client.initialize` throw on the next call (then resolve). */
    initError?: unknown
  }
}

function createClient(options: setup.Options = {}) {
  const client = {
    initCalls: 0,
    loadCalls: 0,
    logoutCalls: 0,
    logoutWith: [] as (string | undefined)[],
    restoreCalls: 0,
    signPayloads: [] as Hex.Hex[],
    signWith: [] as string[],
    wallets: [] as privy.EmbeddedWallet[],
    /** Linked accounts returned by `client.user.get` to drive silent restore. */
    linkedAccounts: [] as privy.LinkedAccount[],
    makeWallet(address: string): privy.EmbeddedWallet {
      return {
        address,
        provider: {
          async request(req: { method: string; params?: readonly unknown[] | undefined }) {
            if (req.method !== 'secp256k1_sign') throw new Error(`unexpected method: ${req.method}`)
            if (options.signError) throw options.signError
            const hash = (req.params as readonly Hex.Hex[])[0] as Hex.Hex
            client.signPayloads.push(hash)
            client.signWith.push(address)
            return options.signResult ?? stubSignature
          },
        },
      }
    },
    /** Registers an embedded ETH wallet so silent restore picks it up via `user.get`. */
    addLinkedWallet(address: string, wallet_index = client.linkedAccounts.length) {
      client.linkedAccounts.push({
        type: 'wallet',
        wallet_client_type: 'privy',
        connector_type: 'embedded',
        chain_type: 'ethereum',
        address,
        wallet_index,
      })
    },
    auth: {
      logout(parameters?: { userId: string } | undefined) {
        client.logoutCalls++
        client.logoutWith.push(parameters?.userId)
        if (options.logoutError) throw options.logoutError
      },
    },
    embeddedWallet: {
      async getEthereumProvider(parameters: {
        wallet: privy.LinkedAccount
        entropyId: string
        entropyIdVerifier: string
      }) {
        const wallet_address = parameters.wallet.address as string
        return {
          async request(req: { method: string; params?: readonly unknown[] | undefined }) {
            if (req.method !== 'secp256k1_sign') throw new Error(`unexpected method: ${req.method}`)
            if (options.signError) throw options.signError
            const hash = (req.params as readonly Hex.Hex[])[0] as Hex.Hex
            client.signPayloads.push(hash)
            client.signWith.push(wallet_address)
            return options.signResult ?? stubSignature
          },
        }
      },
    },
    async getAccessToken() {
      return options.token === undefined ? 'token' : options.token
    },
    initialize() {
      client.initCalls++
      if (options.initError && client.initCalls === 1) throw options.initError
    },
    user: {
      async get() {
        client.restoreCalls++
        return { user: { id: 'user_1', linked_accounts: client.linkedAccounts.slice() } }
      },
    },
  } satisfies privy.Client & {
    initCalls: number
    loadCalls: number
    logoutCalls: number
    logoutWith: (string | undefined)[]
    restoreCalls: number
    signPayloads: Hex.Hex[]
    signWith: string[]
    wallets: privy.EmbeddedWallet[]
    linkedAccounts: privy.LinkedAccount[]
    makeWallet: (address: string) => privy.EmbeddedWallet
    addLinkedWallet: (address: string, wallet_index?: number) => void
  }

  client.wallets = [client.makeWallet(address)]
  client.addLinkedWallet(address)

  return client
}
