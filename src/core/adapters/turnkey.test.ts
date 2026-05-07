import { tempoLocalnet } from 'viem/chains'
import { describe, expect, test } from 'vp/test'

import { accounts, getClient } from '../../../test/config.js'
import * as Account from '../Account.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { turnkey } from './turnkey.js'

describe('turnkey', () => {
  test('loadAccounts: selects the first embedded Ethereum account', async () => {
    const { adapter } = setup({
      wallets: [
        {
          source: 'connected',
          accounts: [{ address: accounts[1]!.address, addressFormat: 'ADDRESS_FORMAT_ETHEREUM' }],
        },
        {
          source: 'embedded',
          accounts: [{ address: accounts[0]!.address, addressType: 'ADDRESS_TYPE_ETHEREUM' }],
        },
      ],
    })

    const result = await adapter.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: undefined,
    })

    expect(result.accounts.map((account) => account.address)).toMatchInlineSnapshot(`
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ]
    `)
  })

  test('createAccount: provisions an Ethereum wallet through React helpers', async () => {
    const wallets: turnkey.Wallet[] = []
    const calls: string[] = []
    const { adapter } = setup({
      wallets,
      createWallet: async () => {
        calls.push('createWallet')
        wallets.push({
          walletId: 'wallet-id',
          source: 'embedded',
          accounts: [{ address: accounts[0]!.address, addressFormat: 'ADDRESS_FORMAT_ETHEREUM' }],
        })
      },
      refreshWallets: () => calls.push('refreshWallets'),
    })

    const result = await adapter.actions.createAccount(
      { name: 'test' },
      { method: 'wallet_connect', params: undefined },
    )

    expect({ calls, accounts: result.accounts }).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        ],
        "calls": [
          "createWallet",
          "refreshWallets",
        ],
      }
    `)
  })

  test('loadAccounts: signs digest capabilities with raw payload signing', async () => {
    const requests: turnkey.SignRawPayloadParameters[] = []
    const { adapter } = setup({
      signRawPayload: async (parameters) => {
        requests.push(parameters)
        return {
          r: `0x${'11'.repeat(32)}`,
          s: `0x${'22'.repeat(32)}`,
          v: 27,
        }
      },
      walletAccount: { address: accounts[0]!.address },
    })

    const result = await adapter.actions.loadAccounts(
      { digest: `0x${'aa'.repeat(32)}` },
      { method: 'wallet_connect', params: undefined },
    )

    expect({ requests, signature: result.signature }).toMatchInlineSnapshot(`
      {
        "requests": [
          {
            "encoding": "PAYLOAD_ENCODING_HEXADECIMAL",
            "hashFunction": "HASH_FUNCTION_NO_OP",
            "organizationId": undefined,
            "payload": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "signWith": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "stampWith": undefined,
          },
        ],
        "signature": "0x111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222221b",
      }
    `)
  })

  test('signTypedData: uses Turnkey EIP-712 raw-payload signing by default', async () => {
    const requests: turnkey.SignRawPayloadParameters[] = []
    const { adapter } = setup({
      signRawPayload: async (parameters) => {
        requests.push(parameters)
        return `0x${'33'.repeat(65)}`
      },
      walletAccount: { address: accounts[0]!.address },
    })

    const signature = await adapter.actions.signTypedData(
      {
        address: accounts[0]!.address,
        data: '{"domain":{},"types":{},"primaryType":"Test","message":{}}',
      },
      {
        method: 'eth_signTypedData_v4',
        params: [
          accounts[0]!.address,
          '{"domain":{},"types":{},"primaryType":"Test","message":{}}',
        ],
      },
    )

    expect({ requests, signature }).toMatchInlineSnapshot(`
      {
        "requests": [
          {
            "encoding": "PAYLOAD_ENCODING_EIP712",
            "hashFunction": "HASH_FUNCTION_NOT_APPLICABLE",
            "organizationId": undefined,
            "payload": "{"domain":{},"types":{},"primaryType":"Test","message":{}}",
            "signWith": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "stampWith": undefined,
          },
        ],
        "signature": "0x3333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333",
      }
    `)
  })

  test('switchChain: forwards to an injected provider', async () => {
    const requests: unknown[] = []
    const { adapter } = setup({
      provider: {
        request: async (request) => {
          requests.push(request)
          return undefined
        },
      },
    })

    await adapter.actions.switchChain?.({ chainId: tempoLocalnet.id })

    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "method": "wallet_switchEthereumChain",
          "params": [
            {
              "chainId": "0x539",
            },
          ],
        },
      ]
    `)
  })
})

function setup(options: turnkey.Options) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: tempoLocalnet.id, storage })
  const adapter = turnkey(options)({
    getAccount: (options) => Account.find({ ...options, store }) as never,
    getClient: () => getClient({ chain: tempoLocalnet }) as never,
    storage,
    store,
  })
  return { adapter, store }
}
