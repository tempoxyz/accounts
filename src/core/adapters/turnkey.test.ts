import { Hex, PublicKey } from 'ox'
import { hashMessage } from 'viem'
import type { Address } from 'viem/accounts'
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
    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          "label": "Ada",
        },
      ]
    `)
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
    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        },
        {
          "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        },
      ]
    `)
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
    expect(result.keyAuthorization?.keyId).toMatchInlineSnapshot(
      `"0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650"`,
    )
  })

  test('behavior: getAccount silently restores and materializes a local signer', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    const { account } = await adapter.getAccount!({ address })
    if (account.type === 'json-rpc') throw new Error('Expected local signer account.')
    const result = await account.sign!({ hash: hashMessage({ raw: '0x68656c6c6f' }) })

    expect(client.fetchCalls).toMatchInlineSnapshot(`1`)
    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000000221b"`,
    )
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

    await expect(adapter.getAccount!({ address })).rejects.toMatchInlineSnapshot(
      '[RpcResponse.InternalError: Connected Turnkey account "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" was not found in fetched Turnkey wallet accounts. Reconnect with Turnkey.]',
    )

    expect(client.fetchCalls).toMatchInlineSnapshot(`1`)
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: expired sessions clear provider accounts', async () => {
    const { adapter, client, store } = setup({ session: { expiry: 1 } })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(adapter.getAccount!({ address })).rejects.toMatchInlineSnapshot(
      '[Provider.DisconnectedError: Turnkey session expired.]',
    )

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
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

    await expect(adapter.getAccount!({ address })).rejects.toMatchInlineSnapshot(
      `[RpcResponse.InternalError: Turnkey account publicKey does not match address "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".]`,
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
    getClient: (() => ({ chain: { id: 1 } })) as never,
    storage,
    store,
  })
  return { adapter, client, store }
}

declare namespace setup {
  type Options = {
    createAccount?: boolean | undefined
    createAddresses?: readonly Address[] | undefined
    loadAddresses?: readonly Address[] | undefined
    session?: turnkey.Session | null | undefined
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
    wallets: [{ accounts: [toWalletAccount(account)] }] as WalletShape[],
  }
  return {
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
    wallets: WalletShape[]
  }
}

function toWalletAccount(account: (typeof accounts)[number]): turnkey.WalletAccount {
  return {
    address: account.address,
    addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
    publicKey: PublicKey.toHex(PublicKey.compress(PublicKey.from(account.publicKey))).slice(2),
  }
}
