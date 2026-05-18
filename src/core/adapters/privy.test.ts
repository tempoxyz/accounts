import { Address as core_Address, Hex, Secp256k1, Signature } from 'ox'
import { describe, expect, test } from 'vp/test'

import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { privy } from './privy.js'

// Deterministic test keys so addresses and signatures are reproducible across
// runs. Real signing is required by upcoming signer-recovery validation, and
// keeps the mocks honest about what the production adapter sees from Privy.
const privateKeyA = Hex.padLeft('0x01', 32)
const privateKeyB = Hex.padLeft('0x02', 32)
const address = core_Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey: privateKeyA }))
const other = core_Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey: privateKeyB }))

function signWithKey(privateKey: Hex.Hex, payload: Hex.Hex): Hex.Hex {
  const signature = Secp256k1.sign({ payload, privateKey })
  return Signature.toHex(signature)
}

function privateKeyForAddress(walletAddress: string): Hex.Hex {
  if (core_Address.from(walletAddress) === address) return privateKeyA
  if (core_Address.from(walletAddress) === other) return privateKeyB
  throw new Error(`No test private key for ${walletAddress}`)
}

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
    	      "address": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
    	      "label": "Ada",
    	    },
    	  ],
    	  "signature": "0xced9d002f487622c7e218274065c327bdfe274ea7da91349bb48fe7c4495baeb71cc6b2f9b3d5f34e5b404cec0ed0dcb085f990a7b7a7f4cb81a5e8abb76aa981b",
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
    	  "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
    	]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0xe5ddc160e4c8f92de507c7db9b982d4f9b7197bfa421864aeadc586bc96b09ae0ba0c5b131650ae4994cff1839341d00f3735ef5abc62ac8fe2cf50f65208e2a1b"`,
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
    	  "0xe77ac2b1d13a90cbd8c4912ff18d0d044cc89c5c6781941001640b8d251f3783",
    	]
    `)
    expect(result).toMatchInlineSnapshot(`
    	{
    	  "accounts": [
    	    {
    	      "address": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
    	    },
    	  ],
    	  "keyAuthorization": {
    	    "chainId": "0x1",
    	    "expiry": "0x7b",
    	    "keyId": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
    	    "keyType": "secp256k1",
    	    "limits": undefined,
    	    "signature": {
    	      "r": "0xb364cd8e50555239adf9f7d655b018ea386764d44ed9b56e894f4a101f0b1a6b",
    	      "s": "0x4910cc8497358eb73a08df09c9cfb2618e3c949b3847ab310ad7ab0d76a9c624",
    	      "type": "secp256k1",
    	      "yParity": "0x1",
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
    	    "keyId": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
    	    "keyType": "secp256k1",
    	    "limits": undefined,
    	    "signature": {
    	      "r": "0xb364cd8e50555239adf9f7d655b018ea386764d44ed9b56e894f4a101f0b1a6b",
    	      "s": "0x4910cc8497358eb73a08df09c9cfb2618e3c949b3847ab310ad7ab0d76a9c624",
    	      "type": "secp256k1",
    	      "yParity": "0x1",
    	    },
    	  },
    	  "rootAddress": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
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
    	  "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
    	]
    `)
    expect(store.getState().accounts).toMatchInlineSnapshot(`
    	[
    	  {
    	    "address": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
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

  test('behavior: silent restore yields No Privy account connected when persisted address is missing', async () => {
    const { adapter, client, store } = setup()
    // Persisted address that is NOT linked on the Privy user.
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: No Privy account connected.]')

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
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

  test('error: secp256k1_sign result must be 65 bytes', async () => {
    const { adapter } = setup({ signResult: '0x1234' })
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[ProviderRpcError: Privy provider returned a malformed secp256k1_sign result (expected 65 bytes, got 2).]',
    )
  })

  test('error: signing for an unconnected address while others are connected throws Unauthorized', async () => {
    const { adapter } = setup()
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "${other}" not found.]`,
    )
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

  test('disconnect: clears provider accounts and logs the user out of Privy', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.disconnect!()

    expect(client.logoutCalls).toMatchInlineSnapshot(`1`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: restore surfaces user.get session errors as `Privy session expired.`', async () => {
    const { adapter, store } = setup({
      userGetError: Object.assign(new Error('boom'), { code: 'session_expired' }),
    })
    // Let the boot-time `void restore()` settle against an empty store first.
    await new Promise((resolve) => setTimeout(resolve, 150))
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: restore surfaces getEthereumProvider session errors as `Privy session expired.`', async () => {
    const { adapter, store } = setup({
      getEthereumProviderError: Object.assign(new Error('boom'), {
        code: 'embedded_wallet_before_logged_in',
      }),
    })
    // Let the boot-time `void restore()` settle against an empty store first.
    await new Promise((resolve) => setTimeout(resolve, 150))
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('error: signature recovered from a different key is rejected as Unauthorized', async () => {
    const { adapter } = setup({ signWithPrivateKey: privateKeyB })
    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Privy provider returned a signature for "${other}" that does not match the requested wallet "${address}".]`,
    )
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
    /** Force the test wallet to sign with this private key (for wrong-signer tests). */
    signWithPrivateKey?: Hex.Hex | undefined
    /** Make `client.user.get` throw on every call, to test restore-side session errors. */
    userGetError?: unknown
    /** Make `client.embeddedWallet.getEthereumProvider` throw, to test restore-side session errors. */
    getEthereumProviderError?: unknown
  }
}

type MockClient = privy.Client & {
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

function createClient(options: setup.Options = {}) {
  const client: MockClient = {
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
          async request(req: {
            method: string
            params?: readonly unknown[] | undefined
          }): Promise<unknown> {
            if (req.method !== 'secp256k1_sign') throw new Error(`unexpected method: ${req.method}`)
            if (options.signError) throw options.signError
            const hash = (req.params as readonly Hex.Hex[])[0] as Hex.Hex
            client.signPayloads.push(hash)
            client.signWith.push(address)
            if (options.signResult !== undefined) return options.signResult
            const privateKey =
              options.signWithPrivateKey ??
              (() => {
                try {
                  return privateKeyForAddress(address)
                } catch {
                  return privateKeyA
                }
              })()
            return signWithKey(privateKey, hash)
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
      },
    },
    embeddedWallet: {
      async getEthereumProvider(parameters: {
        wallet: privy.LinkedAccount
        entropyId: string
        entropyIdVerifier: string
      }) {
        if (options.getEthereumProviderError) throw options.getEthereumProviderError
        const wallet_address = parameters.wallet.address as string
        return {
          async request(req: { method: string; params?: readonly unknown[] | undefined }) {
            if (req.method !== 'secp256k1_sign') throw new Error(`unexpected method: ${req.method}`)
            if (options.signError) throw options.signError
            const hash = (req.params as readonly Hex.Hex[])[0] as Hex.Hex
            client.signPayloads.push(hash)
            client.signWith.push(wallet_address)
            if (options.signResult !== undefined) return options.signResult
            const privateKey =
              options.signWithPrivateKey ??
              (() => {
                try {
                  return privateKeyForAddress(wallet_address)
                } catch {
                  return privateKeyA
                }
              })()
            return signWithKey(privateKey, hash)
          },
        }
      },
    },
    async getAccessToken() {
      return options.token === undefined ? 'token' : options.token
    },
    initialize() {
      client.initCalls++
    },
    user: {
      async get() {
        client.restoreCalls++
        if (options.userGetError) throw options.userGetError
        return { user: { id: 'user_1', linked_accounts: client.linkedAccounts.slice() } }
      },
    },
  }

  client.wallets = [client.makeWallet(address)]
  client.addLinkedWallet(address)

  return client
}
