import { Address as core_Address, Hex, Secp256k1, Signature } from 'ox'
import { BaseError, decodeFunctionData, encodeEventTopics } from 'viem'
import type { Address } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import * as Provider from '../Provider.js'
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
  test.each(['mpp', 'explicit mpp', 'fill'] as const)(
    '%s rejects retained keys after session expiry',
    async (path) => {
      const client = createClient({ token: null })
      const provider = Provider.create({
        adapter: privy({ client, loadAccounts: async () => [address] }),
        storage: Storage.memory(),
      })
      const chainId = provider.store.getState().chainId
      await provider.store.accessKeys.authorize({
        account: Account.fromSecp256k1(privateKeyA),
        chainId,
        parameters: { privateKey: privateKeyB, expiry: 9999999999 },
      })
      provider.store.setState({ accounts: [{ address }], activeAccount: 0 })
      const key = provider.store.getState().accessKeys[0]!
      const request =
        path === 'fill'
          ? provider.request({
              method: 'eth_fillTransaction',
              params: [{ from: address, to: other }],
            })
          : provider
              .getMppxParameters(path === 'explicit mpp' ? { accessKey: key.address } : {})
              .resolveAccount({
                account: { address, type: 'json-rpc' },
                chainId,
                operation: { kind: 'authorizePaymentChannel' },
              })
      await expect(request).rejects.toThrow('Privy session expired')
      expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    },
  )

  test.each(['send', 'fill', 'mpp', 'personal_sign'] as const)(
    '%s rejects a warm cache after the Privy user changes',
    async (path) => {
      const client = createClient()
      const provider = Provider.create({
        adapter: privy({ client, loadAccounts: async () => undefined }),
        storage: Storage.memory(),
      })
      await provider.request({ method: 'wallet_connect' })
      const chainId = provider.store.getState().chainId
      await provider.store.accessKeys.authorize({
        account: Account.fromSecp256k1(privateKeyA),
        chainId,
        parameters: { privateKey: privateKeyB, expiry: 9999999999 },
      })
      client.userId = 'user_2'
      client.wallets = [client.makeWallet(other)]
      const request =
        path === 'mpp'
          ? provider.getMppxParameters().resolveAccount({
              account: { address, type: 'json-rpc' },
              chainId,
              operation: { kind: 'authorizePaymentChannel' },
            })
          : path === 'personal_sign'
            ? provider.request({ method: 'personal_sign', params: ['0x1234', address] })
            : provider.request({
                method: path === 'send' ? 'eth_sendTransaction' : 'eth_fillTransaction',
                params: [{ from: address, to: other }],
              })
      await expect(request).rejects.toThrow('Privy session changed')
      expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
      expect(provider.store.getState().accounts).toMatchInlineSnapshot(`[]`)
      await provider.request({ method: 'wallet_connect' })
      expect(provider.store.getState().accounts.map((account) => account.address)).toEqual([other])
      await provider.request({ method: 'personal_sign', params: ['0x1234', other] })
      expect(client.signWith).toEqual([other])
    },
  )

  test('reconnecting after a user switch replaces cached accounts', async () => {
    const { adapter, client, store } = setup()
    await connect({ adapter, store })
    client.userId = 'user_2'
    client.wallets = [client.makeWallet(other)]
    const result = await adapter.actions.loadAccounts(
      {},
      { method: 'wallet_connect', params: undefined },
    )
    expect(result.accounts.map((account) => account.address)).toEqual([other])
  })

  test('rejects a user switch while loading wallet providers', async () => {
    const { adapter, client } = setup()
    const getProvider = client.embeddedWallet.getEthereumProvider
    client.embeddedWallet.getEthereumProvider = async (parameters) => {
      const provider = await getProvider(parameters)
      client.userId = 'user_2'
      return provider
    }
    await expect(
      adapter.actions.loadAccounts({}, { method: 'wallet_connect', params: undefined }),
    ).rejects.toThrow('Privy session changed')
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
  })

  test('connect retains its loaded owner after a concurrent clear', async () => {
    const { adapter, client, store } = setup()
    await connect({ adapter, store })
    const wallet = client.wallets[0]!
    const request = wallet.provider.request.bind(wallet.provider)
    wallet.provider.request = async (parameters) => {
      client.userId = 'other-user'
      await expect(adapter.assertAccount!({ address })).rejects.toThrow('Privy session changed')
      client.userId = 'user_1'
      return request(parameters)
    }
    const result = await adapter.actions.loadAccounts(
      { digest: '0x1234' },
      { method: 'wallet_connect', params: undefined },
    )
    store.setState({ accounts: result.accounts, activeAccount: 0 })
    client.userId = 'other-user'
    await expect(adapter.assertAccount!({ address })).rejects.toThrow('Privy session changed')
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('reconnect clears stale accounts on user lookup session errors', async () => {
    const { adapter, client, store } = setup()
    await connect({ adapter, store })
    client.user.get = async () => {
      throw Object.assign(new Error('session expired'), { code: 'session_expired' })
    }
    await expect(connect({ adapter, store })).rejects.toThrow('Privy session expired')
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('validates the Privy session before retained-key use', async () => {
    const { adapter, client, store } = setup({ token: null })
    store.setState({ accounts: [{ address }], activeAccount: 0 })
    await expect(adapter.assertAccount!({ address })).rejects.toThrow('Privy session expired')
    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

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

  test('default: createAccount falls back to loadAccounts when not provided', async () => {
    const { adapter, client } = setup({ createAccount: false })

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.createCalls).toMatchInlineSnapshot(`0`)
    expect(client.loadCalls).toMatchInlineSnapshot(`1`)
    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x1234",
      ]
    `)
    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
          "label": "Ada",
        },
      ]
    `)
  })

  test('default: createAccount can select the active embedded wallet', async () => {
    const { adapter, client } = setup({ createAddresses: [other] })
    client.addWallet(other)

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
      ]
    `)
    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
          "label": "Ada",
        },
      ]
    `)
  })

  test('default: loadAccounts delegates login and caches embedded wallets for signing', async () => {
    const { adapter, client, store } = setup()

    await connect({ adapter, store })
    const result = await adapter.actions.signPersonalMessage!(
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

  test('default: loadAccounts can select and order embedded wallets', async () => {
    const { adapter, client } = setup({ loadAddresses: [other, address] })
    client.addWallet(other)

    const result = await adapter.actions.loadAccounts(
      { digest: '0x1234' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(client.signWith).toMatchInlineSnapshot(`
      [
        "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
      ]
    `)
    expect(result.accounts).toMatchInlineSnapshot(`
      [
        {
          "address": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
        },
        {
          "address": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
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

  test('default: signs transactions with the provider-backed Privy account', async () => {
    const { adapter, client, store } = setup()
    await connect({ adapter, store })

    const result = await adapter.actions.signTransaction!(
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
        "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
      ]
    `)
    expect(client.signPayloads).toMatchInlineSnapshot(`
      [
        "0x62f087d34b8a023e0461eb1b9a01267ba5b8400c13d2ffdac615ccec872cc288",
      ]
    `)
    expect(result).toMatchInlineSnapshot(
      `"0x76f86a010101825208d8d7942b5ad5c4795c026514f8317c7a215e218dccd6cf0180c0808080808080c0b8418b0c18077cb78666296a4c0e8149935124f70d7820ec4e4ae81de428659d6c305c098dea43ccb536e813bb1c136eab5e96611de69489be6291169b2bb2318cde1b"`,
    )
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
    expect(client.restoreCalls).toMatchInlineSnapshot(`4`)
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

  test('error: secp256k1 access key requires external key material', async () => {
    const { adapter, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.authorizeAccessKey!(
        { expiry: 123, keyType: 'secp256k1' },
        { method: 'wallet_authorizeAccessKey', params: [{ expiry: 123, keyType: 'secp256k1' }] },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`keyType: "secp256k1"\` requires externally generated key material; provide \`publicKey\` or \`address\`.]`,
    )
  })

  test('revokeAccessKey retains the key until confirmation', async () => {
    let confirm!: () => void
    const confirmation = new Promise<void>((resolve) => {
      confirm = resolve
    })
    const { adapter, client, store } = setup({ confirmation })
    const keys = [{ access: address, address: other, chainId: 1, keyType: 'secp256k1' }] as never
    store.setState({ accounts: [{ address }], activeAccount: 0, accessKeys: keys })
    let finished = false
    const pending = adapter.actions.revokeAccessKey!(
      { accessKeyAddress: other, address },
      { method: 'wallet_revokeAccessKey', params: [{ accessKeyAddress: other, address }] },
    ).then(() => {
      finished = true
    })
    for (let i = 0; i < 100 && client.transactions.length === 0; i++) await Promise.resolve()
    expect(client.transactions.length).toMatchInlineSnapshot(`1`)
    expect(finished).toMatchInlineSnapshot(`false`)
    expect(store.getState().accessKeys).toEqual(keys)
    confirm()
    await pending
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test.each(['pending', 'reverted'] as const)(
    'revokeAccessKey rejects a %s receipt without removing the key',
    async (receiptStatus) => {
      const { adapter, store } = setup({ receiptStatus })
      const keys = [{ access: address, address: other, chainId: 1, keyType: 'secp256k1' }] as never
      store.setState({ accounts: [{ address }], activeAccount: 0, accessKeys: keys })
      await expect(
        adapter.actions.revokeAccessKey!(
          { accessKeyAddress: other, address },
          { method: 'wallet_revokeAccessKey', params: [{ accessKeyAddress: other, address }] },
        ),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Access-key revocation is not confirmed]`,
      )
      expect(store.getState().accessKeys).toEqual(keys)
    },
  )

  test('default: revokeAccessKey revokes with the connected Privy account', async () => {
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
          "account": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
          "args": [
            "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
          ],
          "functionName": "revokeKey",
          "to": "0xaAAAaaAA00000000000000000000000000000000",
        }
      `)
    expect(store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: revokeAccessKey targets an explicit chainId', async () => {
    const { adapter, client, store } = setup()
    store.setState({
      accounts: [{ address }],
      activeAccount: 0,
      accessKeys: [1, 4217].map(
        (chainId) =>
          ({
            access: address,
            address: other,
            chainId,
            keyType: 'secp256k1',
          }) as never,
      ),
    })

    await adapter.actions.revokeAccessKey!(
      { accessKeyAddress: other, address, chainId: 4217n },
      {
        method: 'wallet_revokeAccessKey',
        params: [{ accessKeyAddress: other, address, chainId: '0x1079' }],
      },
    )

    expect({
      accessKeys: store.getState().accessKeys,
      clientOptions: client.clientOptions,
    }).toMatchInlineSnapshot(`
      {
        "accessKeys": [
          {
            "access": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
            "address": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
            "chainId": 1,
            "keyType": "secp256k1",
          },
        ],
        "clientOptions": [
          {
            "chainId": 4217,
            "feePayer": undefined,
          },
        ],
      }
    `)
  })

  test('behavior: revokeAccessKey forwards a fee payer URL', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.revokeAccessKey!(
      { accessKeyAddress: other, address, feePayer: 'https://example.com/fee-payer' },
      {
        method: 'wallet_revokeAccessKey',
        params: [{ accessKeyAddress: other, address, feePayer: 'https://example.com/fee-payer' }],
      },
    )

    expect({
      clientOptions: client.clientOptions,
      transactions: client.transactions,
    }).toMatchInlineSnapshot(`
      {
        "clientOptions": [
          {
            "chainId": 1,
            "feePayer": "https://example.com/fee-payer",
          },
        ],
        "transactions": [
          {
            "account": {
              "address": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
              "sign": [Function],
              "signTransaction": [Function],
              "source": "privy",
              "type": "local",
            },
            "data": "0x5ae7ab320000000000000000000000002b5ad5c4795c026514f8317c7a215e218dccd6cf",
            "feePayer": true,
            "throwOnReceiptRevert": true,
            "to": "0xaAAAaaAA00000000000000000000000000000000",
          },
        ],
      }
    `)
  })

  test('error: revokeAccessKey preserves local state on external fee payer errors', async () => {
    const transactionError = new BaseError('revoke failed', {
      cause: Object.assign(new Error('execution reverted'), {
        data: { errorName: 'KeyAlreadyRevoked' },
      }),
    })
    const { adapter, store } = setup({ transactionError })
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

    await expect(
      adapter.actions.revokeAccessKey!(
        { accessKeyAddress: other, address, feePayer: 'https://example.com/fee-payer' },
        {
          method: 'wallet_revokeAccessKey',
          params: [{ accessKeyAddress: other, address, feePayer: 'https://example.com/fee-payer' }],
        },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [ContractFunctionExecutionError: revoke failed

      Contract Call:
        address:   0xaAAAaaAA00000000000000000000000000000000
        function:  revokeKey(address keyId)
        args:               (0x2b5ad5c4795c026514f8317c7a215e218dccd6cf)
        sender:    0x7e5f4552091a69125d5dfcb7b8c2659029395bdf

      Docs: https://viem.sh/docs/contract/writeContract
      Details: execution reverted
      Version: viem@0.0.0-9a2b41b10a791e5ee55eab66110139e2043ccf26]
    `)

    expect(store.getState().accessKeys).toMatchInlineSnapshot(`
      [
        {
          "access": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
          "address": "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf",
          "chainId": 1,
          "keyType": "secp256k1",
        },
      ]
    `)
  })

  test('behavior: revokeAccessKey forwards default fee sponsorship', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.revokeAccessKey!(
      { accessKeyAddress: other, address, feePayer: true },
      {
        method: 'wallet_revokeAccessKey',
        params: [{ accessKeyAddress: other, address, feePayer: true }],
      },
    )

    expect({
      clientOptions: client.clientOptions,
      transactions: client.transactions,
    }).toMatchInlineSnapshot(`
      {
        "clientOptions": [
          {
            "chainId": 1,
            "feePayer": undefined,
          },
        ],
        "transactions": [
          {
            "account": {
              "address": "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
              "sign": [Function],
              "signTransaction": [Function],
              "source": "privy",
              "type": "local",
            },
            "data": "0x5ae7ab320000000000000000000000002b5ad5c4795c026514f8317c7a215e218dccd6cf",
            "feePayer": true,
            "throwOnReceiptRevert": true,
            "to": "0xaAAAaaAA00000000000000000000000000000000",
          },
        ],
      }
    `)
  })

  test('behavior: signing silently restores wallet accounts via the Privy SDK', async () => {
    const { adapter, client, store } = setup()
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.signPersonalMessage!(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(client.restoreCalls).toMatchInlineSnapshot(`4`)
    expect(client.loadCalls).toMatchInlineSnapshot(`0`)
  })

  test('behavior: silent restore does not connect accounts when the provider store is empty', async () => {
    const { adapter, client } = setup()

    await expect(
      adapter.actions.signPersonalMessage!(
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
    client.addWallet(other)
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await adapter.actions.signPersonalMessage!(
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
      adapter.actions.signPersonalMessage!(
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
      adapter.actions.signPersonalMessage!(
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
      adapter.actions.signPersonalMessage!(
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
      adapter.actions.signPersonalMessage!(
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
      adapter.actions.signPersonalMessage!(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: silent restore clears stale persisted accounts when Privy no longer has them', async () => {
    const { adapter, client, store } = setup()
    // Persisted address that is NOT linked on the Privy user.
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage!(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[Provider.DisconnectedError: Privy session no longer matches persisted accounts.]',
    )

    expect(client.signPayloads).toMatchInlineSnapshot(`[]`)
    // Stale persisted accounts are wiped so the adapter and store agree.
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: failed account selection does not poison silent restore cache', async () => {
    const { adapter, store } = setup({ loadAddresses: [other] })
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await expect(
      adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Privy callback returned address "${other}" that was not found in the user's embedded wallets.]`,
    )

    await expect(
      adapter.actions.signPersonalMessage!(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[Provider.DisconnectedError: Privy session no longer matches persisted accounts.]',
    )
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: failed empty createAccount selection does not poison silent restore cache', async () => {
    const { adapter, store } = setup({ createAddresses: [] })
    store.setState({ accounts: [{ address: other }], activeAccount: 0 })

    await expect(
      adapter.actions.createAccount(
        { digest: '0x1234', name: 'Ada' },
        { method: 'wallet_connect', params: undefined },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.DisconnectedError: Privy returned no wallet.]`,
    )

    await expect(
      adapter.actions.signPersonalMessage!(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toMatchInlineSnapshot(
      '[Provider.DisconnectedError: Privy session no longer matches persisted accounts.]',
    )
    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('error: silent restore rejects non-hex secp256k1_sign results', async () => {
    const { adapter, store } = setup({ signResult: 'not-hex' })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage!(
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

  test('error: malformed secp256k1_sign result is rejected by signer recovery', async () => {
    const { adapter, store } = setup({ signResult: '0x1234' })
    await connect({ adapter, store })

    await expect(
      adapter.actions.signPersonalMessage!(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot(
      `[Provider.UnauthorizedError: Privy provider returned a signature for "unknown" that does not match the requested wallet "${address}".]`,
    )
  })

  test('error: signing for an unconnected address while others are connected throws Unauthorized', async () => {
    const { adapter, store } = setup()
    await connect({ adapter, store })

    await expect(
      adapter.actions.signPersonalMessage!(
        { address: other, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', other] },
      ),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "${other}" not found.]`,
    )
  })

  test('error: unsupported secp256k1_sign maps to UnsupportedMethodError', async () => {
    const { adapter, store } = setup({
      signError: { code: 4200, message: 'Method not supported' },
    })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage!(
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

  test('behavior: restore surfaces silent-restore session errors as `Privy session expired.`', async () => {
    const { adapter, store } = setup({
      restoreError: Object.assign(new Error('boom'), { code: 'session_expired' }),
    })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage!(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: Privy session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('error: signature recovered from a different key is rejected as Unauthorized', async () => {
    const { adapter, store } = setup({ signWithPrivateKey: privateKeyB })
    await connect({ adapter, store })

    await expect(
      adapter.actions.signPersonalMessage!(
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
    getClient: ((clientOptions: unknown) => {
      client.clientOptions.push(clientOptions)
      return {
        chain: { id: 1 },
        sendTransactionSync: async (parameters: unknown) => {
          client.transactions.push(parameters)
          if (options.transactionError) throw options.transactionError
          await options.confirmation
          return {
            status: options.receiptStatus ?? 'success',
            logs: [
              {
                data: '0x',
                topics: encodeEventTopics({
                  abi: Abis.accountKeychain,
                  eventName: 'KeyRevoked',
                  args: { account: address, publicKey: other },
                }),
              },
            ],
          }
        },
        sendTransaction: async (parameters: unknown) => {
          client.transactions.push(parameters)
          if (options.transactionError) throw options.transactionError
          return Hex.padLeft('0x1', 32)
        },
      }
    }) as never,
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
    /** Pass `false` to omit the adapter's `createAccount` callback (tests fallback to `loadAccounts`). */
    createAccount?: false | undefined
    createAddresses?: readonly Address[] | undefined
    loadAddresses?: readonly Address[] | undefined
    /** Make the mock client's `user.get` throw, to test restore-side session errors. */
    restoreError?: unknown
    token?: string | null | undefined
    signError?: unknown
    /** Make the mock wallet client transaction fail. */
    transactionError?: unknown
    confirmation?: Promise<void> | undefined
    receiptStatus?: 'success' | 'pending' | 'reverted' | undefined
    /** Override the value returned by the embedded provider's `secp256k1_sign`. */
    signResult?: unknown
    /** Force the test wallet to sign with this private key (for wrong-signer tests). */
    signWithPrivateKey?: Hex.Hex | undefined
  }
}

type MockClient = privy.Client & {
  clientOptions: unknown[]
  createCalls: number
  initCalls: number
  loadCalls: number
  logoutCalls: number
  logoutWith: (string | undefined)[]
  restoreCalls: number
  userId: string
  signPayloads: Hex.Hex[]
  signWith: string[]
  transactions: unknown[]
  wallets: privy.EmbeddedWallet[]
  makeWallet: (address: string) => privy.EmbeddedWallet
  addWallet: (address: string) => void
}

function createClient(options: setup.Options = {}) {
  const client: MockClient = {
    clientOptions: [] as unknown[],
    createCalls: 0,
    initCalls: 0,
    loadCalls: 0,
    logoutCalls: 0,
    logoutWith: [] as (string | undefined)[],
    restoreCalls: 0,
    userId: 'user_1',
    signPayloads: [] as Hex.Hex[],
    signWith: [] as string[],
    transactions: [] as unknown[],
    wallets: [] as privy.EmbeddedWallet[],
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
    /** Adds an embedded wallet so silent restore (`user.get`) returns it. */
    addWallet(address: string) {
      client.wallets.push(client.makeWallet(address))
    },
    auth: {
      logout(parameters?: { userId: string } | undefined) {
        client.logoutCalls++
        client.logoutWith.push(parameters?.userId)
      },
    },
    embeddedWallet: {
      async getEthereumProvider({ wallet }) {
        const existing = client.wallets.find(
          (w) => core_Address.from(w.address) === core_Address.from(wallet.address as string),
        )
        return (existing ?? client.makeWallet(wallet.address as string)).provider
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
        if (options.restoreError) throw options.restoreError
        return {
          user: {
            id: client.userId,
            linked_accounts: client.wallets.map((wallet, index) => ({
              address: wallet.address,
              chain_type: 'ethereum',
              connector_type: 'embedded',
              type: 'wallet',
              wallet_client_type: 'privy',
              wallet_index: index,
            })),
          },
        }
      },
    },
  }

  client.addWallet(address)

  return client
}
