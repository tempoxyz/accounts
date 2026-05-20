import { Hex, PublicKey } from 'ox'
import { decodeFunctionData } from 'viem'
import type { Address } from 'viem/accounts'
import { Abis } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts } from '../../../test/config.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { turnkey } from './turnkey.js'

const account = accounts[0]
const account_2 = accounts[1]
const address = account.address
const other = account_2.address

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
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "label": "Ada",
          },
        ],
        "signature": "0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b",
      }
    `)
  })

  test('default: createAccount falls back to loadAccounts', async () => {
    const { adapter, client } = setup({ createAccount: false })

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.createCalls).toMatchInlineSnapshot(`0`)
    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "label": "Ada",
          },
        ],
        "signature": "0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b",
      }
    `)
  })

  test('default: createAccount can select the active fetched wallet account', async () => {
    const { adapter, client } = setup({ createAddresses: [other] })
    client.wallets = [
      {
        accounts: [toWalletAccount(account), toWalletAccount(account_2)],
      },
    ]

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
            "label": "Ada",
          },
        ],
        "signature": "0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b",
      }
    `)
  })

  test('default: loadAccounts returns accounts for store-backed signing', async () => {
    const { adapter, client, store } = setup()

    await connect({ adapter, store })
    const result = await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
    )
  })

  test('default: loadAccounts can select and order fetched wallet accounts', async () => {
    const { adapter, client } = setup({ loadAddresses: [other, address] })
    client.wallets = [
      {
        accounts: [toWalletAccount(account), toWalletAccount(account_2)],
      },
    ]

    const result = await adapter.actions.loadAccounts(
      { digest: '0x1234' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
          },
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "signature": "0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b",
      }
    `)
  })

  test('default: signs transactions with a hydrated Tempo account', async () => {
    const { adapter, client, store } = setup()

    await connect({ adapter, store })
    const result = await adapter.actions.signTransaction(
      {
        chainId: 1,
        from: address,
        gas: 21_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: other,
        value: 1n,
      },
      { method: 'eth_signTransaction', params: [{ from: address }] },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x1d573a406538a466857ad6ac07f34eac6ede297aba6e85116a1e9a7cda46d9f2",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x76f86a010101825208d8d7948c8d35429f74ec245f8ef2f4fd1e551cff97d6500180c0808080808080c0b841000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
    )
  })

  test('default: accepts prefixed Turnkey public keys', async () => {
    const { adapter, client, store } = setup()
    const walletAccount = toWalletAccount(account)
    client.wallets = [
      {
        accounts: [
          {
            ...walletAccount,
            publicKey: `0x${walletAccount.publicKey}`,
          },
        ],
      },
    ]

    await connect({ adapter, store })
    const result = await adapter.actions.signTransaction(
      {
        chainId: 1,
        from: address,
        gas: 21_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: other,
        value: 1n,
      },
      { method: 'eth_signTransaction', params: [{ from: address }] },
    )

    expect(result).toMatchInlineSnapshot(
      `"0x76f86a010101825208d8d7948c8d35429f74ec245f8ef2f4fd1e551cff97d6500180c0808080808080c0b841000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
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
        "0xea47721547363fc82a5dca62b4544e4718d861b3df10bfac65d30102594b5c26",
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "keyAuthorization": {
          "chainId": "0x1",
          "expiry": "0x7b",
          "keyId": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
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
          "keyId": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
          "keyType": "secp256k1",
          "limits": undefined,
          "signature": {
            "r": "0x0000000000000000000000000000000000000000000000000000000000000011",
            "s": "0x0000000000000000000000000000000000000000000000000000000000000022",
            "type": "secp256k1",
            "yParity": "0x0",
          },
        },
        "rootAddress": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('default: revokeAccessKey revokes with the connected Turnkey account', async () => {
    const { adapter, client, store } = setup()
    store.setState({
      accounts: [{ address }],
      activeAccount: 0,
      accessKeys: [
        {
          access: address,
          address: other,
          chainId: 1,
          keyType: 'secp256k1',
        } as never,
      ],
    })

    await adapter.actions.revokeAccessKey!(
      { accessKeyAddress: other, address },
      { method: 'wallet_revokeAccessKey', params: [{ accessKeyAddress: other, address }] },
    )

    const transaction = client.transactions[0] as
      | { account: { address: Address }; data: Hex.Hex; to: Address }
      | undefined
    const decoded = transaction
      ? decodeFunctionData({ abi: Abis.accountKeychain, data: transaction.data })
      : undefined
    expect(
      transaction &&
        decoded && {
          account: transaction.account.address,
          args: decoded.args,
          functionName: decoded.functionName,
          to: transaction.to,
        },
    ).toMatchInlineSnapshot(`
        {
          "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "args": [
            "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
          ],
          "functionName": "revokeKey",
          "to": "0xaAAAaaAA00000000000000000000000000000000",
        }
      `)
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
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

  test('behavior: silent restore uses persisted provider accounts', async () => {
    const { adapter, client, store } = setup()
    client.wallets = [
      {
        accounts: [toWalletAccount(account), toWalletAccount(account_2)],
      },
    ]
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await adapter.actions.signPersonalMessage(
      { address: other, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', other] },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
      ]
    `)
    expect(store.getState().accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        },
      ]
    `)
  })

  test('behavior: silent restore rejects connected accounts missing from Turnkey metadata', async () => {
    const { adapter, client, store } = setup()
    client.wallets = [
      {
        accounts: [
          {
            address,
            addressFormat: 'ADDRESS_FORMAT_SUI',
            publicKey: toWalletAccount(account).publicKey,
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
    ).rejects.toMatchInlineSnapshot(
      '[RpcResponse.InternalError: Connected Turnkey account "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" was not found in fetched Turnkey wallet accounts. Reconnect with Turnkey.]',
    )

    expect(client.fetchCalls).toMatchInlineSnapshot(`1`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        },
      ]
    `)
  })

  test('behavior: reconnecting refreshes wallet account metadata', async () => {
    const { adapter, client, store } = setup()

    await connect({ adapter, store })
    client.wallets = [
      {
        accounts: [toWalletAccount(account), toWalletAccount(account_2)],
      },
    ]
    await connect({ adapter, store })

    await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.fetchCalls).toMatchInlineSnapshot(`2`)
    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750",
      ]
    `)
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
    const { adapter, store } = setup()
    await connect({ adapter, store })

    await expect(
      adapter.actions.signPersonalMessage(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot(
      `[Provider.UnauthorizedError: Account "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650" not found.]`,
    )
  })

  test('error: rejects a Turnkey wallet account with mismatched address and public key', async () => {
    const { adapter, client, store } = setup()
    client.wallets = [
      {
        accounts: [
          {
            ...toWalletAccount(account_2),
            address,
          },
        ],
      },
    ]
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signTransaction(
        { from: address },
        { method: 'eth_signTransaction', params: [{ from: address }] },
      ),
    ).rejects.toMatchInlineSnapshot(
      `[RpcResponse.InternalError: Turnkey account publicKey does not match address "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".]`,
    )
  })

  test('error: rejects a selected address missing from fetched wallet accounts', async () => {
    const { adapter } = setup({ loadAddresses: [other] })

    await expect(
      adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined }),
    ).rejects.toMatchInlineSnapshot(
      `[RpcResponse.InternalError: Turnkey callback returned address "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650" that was not found in fetched wallet accounts.]`,
    )
  })
})

function setup(options: setup.Options = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const client = createClient(options)
  const adapter = turnkey({
    client,
    ...(options.createAccount === false
      ? {}
      : {
          createAccount: async () => {
            client.createCalls++
            return options.createAddresses
          },
        }),
    loadAccounts: async () => {
      client.loadCalls++
      return options.loadAddresses
    },
  })({
    getAccount: (() => {
      throw new Error('not implemented')
    }) as never,
    getClient: (() => ({
      chain: { id: 1 },
      sendTransaction: async (parameters: unknown) => {
        client.transactions.push(parameters)
        return Hex.padLeft('0x1', 32)
      },
    })) as never,
    storage,
    store,
  })
  return { adapter, client, store }
}

async function connect(options: Pick<ReturnType<typeof setup>, 'adapter' | 'store'>) {
  const { adapter, store } = options
  const loaded = await adapter.actions.loadAccounts(undefined, {
    method: 'wallet_connect',
    params: undefined,
  })
  store.setState({ accounts: loaded.accounts, activeAccount: 0 })
  return loaded
}

declare namespace setup {
  type Options = {
    createAccount?: boolean | undefined
    createAddresses?: readonly Address[] | undefined
    loadAddresses?: readonly Address[] | undefined
    session?: turnkey.Session | null | undefined
    signError?: unknown
  }
}

function createClient(options: setup.Options = {}) {
  type WalletShape = {
    accounts: { address: string; addressFormat?: string | undefined; publicKey: string }[]
  }
  const state = {
    createCalls: 0,
    fetchCalls: 0,
    initCalls: 0,
    loadCalls: 0,
    signPayloads: [] as Hex.Hex[],
    signWith: [] as string[],
    transactions: [] as unknown[],
    wallets: [{ accounts: [toWalletAccount(account)] }] as WalletShape[],
  }
  const client = {
    get fetchCalls() {
      return state.fetchCalls
    },
    get createCalls() {
      return state.createCalls
    },
    set createCalls(value: number) {
      state.createCalls = value
    },
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
    get transactions() {
      return state.transactions
    },
    get wallets() {
      return state.wallets
    },
    set wallets(value: WalletShape[]) {
      state.wallets = value
    },
    fetchWallets: async () => {
      state.fetchCalls++
      return state.wallets as readonly turnkey.Wallet[]
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
        return {
          r: Hex.padLeft('0x11', 32),
          s: Hex.padLeft('0x22', 32),
          v: '27',
        }
      },
    },
    init: () => {
      state.initCalls++
    },
    logout: () => {},
  } satisfies turnkey.Client & {
    createCalls: number
    fetchCalls: number
    initCalls: number
    loadCalls: number
    signPayloads: Hex.Hex[]
    signWith: string[]
    transactions: unknown[]
    wallets: WalletShape[]
  }

  return client
}

function toWalletAccount(account: (typeof accounts)[number]): turnkey.WalletAccount {
  return {
    address: account.address,
    addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
    publicKey: PublicKey.toHex(PublicKey.compress(PublicKey.from(account.publicKey))).slice(2),
  }
}
