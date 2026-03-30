import { Hex, Provider as core_Provider, WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { type Address, createClient, custom, parseUnits } from 'viem'
import {
  getBalance,
  sendTransactionSync,
  signMessage,
  verifyHash,
  verifyMessage,
  verifyTypedData,
  waitForTransactionReceipt,
} from 'viem/actions'
import { tempo, tempoModerato } from 'viem/chains'
import { Account as TempoAccount, Actions, Addresses } from 'viem/tempo'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { headlessWebAuthn, secp256k1 } from '../../test/adapters.js'
import { accounts, chain, getClient, http } from '../../test/config.js'
import { createServer, type Server } from '../../test/utils.js'
import * as Handler from '../server/Handler.js'
import * as Expiry from './Expiry.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const adapters = [
  { name: 'headlessWebAuthn', adapter: headlessWebAuthn },
  { name: 'secp256k1', adapter: secp256k1 },
] as const

describe.each(adapters)('$name', ({ adapter }: (typeof adapters)[number]) => {
  const transferCall = Actions.token.transfer.call({
    to: '0x0000000000000000000000000000000000000001',
    token: Addresses.pathUsd,
    amount: parseUnits('1', 6),
  })

  /** Connects via login (or register if login returns no accounts), returns the active account address. */
  async function connect(provider: ReturnType<typeof Provider.create>) {
    const login = await provider.request({ method: 'wallet_connect' })
    if (login.accounts.length > 0) return login.accounts[0]!.address
    const register = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    return register.accounts[0]!.address
  }

  /** Funds an address with PathUSD from the pre-funded test account. */
  async function fund(address: Address) {
    const client = getClient()
    await Actions.token.transferSync(client, {
      account: accounts[0]!,
      feeToken: Addresses.pathUsd,
      to: address,
      token: Addresses.pathUsd,
      amount: parseUnits('10', 6),
    })
  }

  describe('create', () => {
    test('default: returns an EIP-1193 provider', async () => {
      const provider = Provider.create({ adapter: adapter() })
      expect(typeof provider.request).toMatch(/function/)
    })
  })

  describe('eth_chainId', () => {
    test('default: returns configured chain ID as hex', async () => {
      const provider = Provider.create({ adapter: adapter() })
      const chainId = await provider.request({ method: 'eth_chainId' })
      expect(chainId).toMatchInlineSnapshot(`"0x1079"`)
    })
  })

  describe('eth_accounts', () => {
    test('default: returns empty array initially', async () => {
      const provider = Provider.create({ adapter: adapter() })
      const accounts = await provider.request({ method: 'eth_accounts' })
      expect(accounts).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: returns accounts after connecting', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      const result = await provider.request({ method: 'eth_accounts' })
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('eth_requestAccounts', () => {
    test('default: returns accounts after connecting', async () => {
      const provider = Provider.create({ adapter: adapter() })
      await connect(provider)
      const result = await provider.request({ method: 'eth_requestAccounts' })
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('wallet_connect', () => {
    test('default: without capabilities calls loadAccounts', async () => {
      const provider = Provider.create({ adapter: adapter() })
      const result = await provider.request({ method: 'wallet_connect' })
      for (const account of result.accounts) {
        expect(account.address).toMatch(/^0x[0-9a-f]{40}$/i)
        expect(account.capabilities).toMatchInlineSnapshot(`{}`)
      }
    })

    test('behavior: with register capability calls createAccount', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts.length).toMatchInlineSnapshot(`1`)
      expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
    })

    test('behavior: register passes name to createAccount', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', name: 'alice' } }],
      })
      expect(provider.store.getState().accounts.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: register defaults name to "default"', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(provider.store.getState().accounts.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: login sets activeAccount to loaded account', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      const login = await provider.request({ method: 'wallet_connect' })
      const result = await provider.request({ method: 'wallet_connect' })
      expect(result.accounts[0]!.address).toBe(login.accounts[0]!.address)
    })

    test('behavior: login with digest returns signature in account capabilities', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { digest: '0x1234' } }],
      })
      expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: digest signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      await connect(provider)
      const digest = '0x00000000000000000000000000000000000000000000000000000000deadbeef' as const
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { digest } }],
      })

      const valid = await verifyHash(client, {
        address: result.accounts[0]!.address,
        hash: digest,
        signature: result.accounts[0]!.capabilities.signature!,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('behavior: login without digest returns empty capabilities', async () => {
      const provider = Provider.create({ adapter: adapter() })
      await connect(provider)
      const result = await provider.request({ method: 'wallet_connect' })
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
    })

    test('behavior: register without digest returns empty capabilities', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
    })

    test('behavior: register with digest returns signature in capabilities', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', digest: '0x1234' } }],
      })
      expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: register digest signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const digest = '0x00000000000000000000000000000000000000000000000000000000deadbeef' as const
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', digest } }],
      })

      const valid = await verifyHash(client, {
        address: result.accounts[0]!.address,
        hash: digest,
        signature: result.accounts[0]!.capabilities.signature!,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })
  })

  describe('wallet_disconnect', () => {
    test('default: disconnects and clears accounts', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      await provider.request({ method: 'wallet_disconnect' })

      const accounts = await provider.request({ method: 'eth_accounts' })
      expect(accounts).toMatchInlineSnapshot(`[]`)
    })
  })

  describe('wallet_switchEthereumChain', () => {
    test('default: switches chain', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
      })

      const chainId = await provider.request({ method: 'eth_chainId' })
      expect(chainId).toMatchInlineSnapshot(`"0xa5bf"`)
    })

    test('error: throws for unconfigured chain', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await expect(
        provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedChainIdError: Chain 1 not configured.]`,
      )
    })
  })

  describe('events', () => {
    test('behavior: emits accountsChanged on connect', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const events: unknown[] = []
      provider.on('accountsChanged', (accounts) => events.push(accounts))

      const connected = await connect(provider)

      expect(events).toEqual([[connected]])
    })

    test('behavior: emits connect on status change', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const events: unknown[] = []
      provider.on('connect', (info) => events.push(info))

      await connect(provider)

      expect(events).toMatchInlineSnapshot(`
        [
          {
            "chainId": "0x1079",
          },
        ]
      `)
    })

    test('behavior: emits disconnect on disconnect', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)

      const events: unknown[] = []
      provider.on('disconnect', (error) => events.push(error))

      await provider.request({ method: 'wallet_disconnect' })

      expect(events.length).toMatchInlineSnapshot(`1`)
      expect(events[0]).toBeInstanceOf(core_Provider.DisconnectedError)
    })

    test('behavior: does not emit accountsChanged on duplicate login', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)

      const events: unknown[] = []
      provider.on('accountsChanged', (accounts) => events.push(accounts))

      await provider.request({ method: 'wallet_connect' })

      expect(events).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: emits chainChanged on switch', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const events: unknown[] = []
      provider.on('chainChanged', (chainId) => events.push(chainId))

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
      })

      expect(events).toMatchInlineSnapshot(`
        [
          "0xa5bf",
        ]
      `)
    })
  })

  describe('eth_sendTransaction', () => {
    test('default: sends transaction and returns hash', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    })

    test('behavior: transaction is confirmed on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      })

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })

      const {
        blockHash,
        blockNumber,
        cumulativeGasUsed,
        effectiveGasPrice,
        feePayer,
        from,
        gasUsed,
        logs,
        logsBloom,
        transactionHash,
        transactionIndex,
        ...rest
      } = receipt
      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(typeof blockNumber).toMatch(/bigint/)
      expect(typeof cumulativeGasUsed).toMatch(/bigint/)
      expect(typeof effectiveGasPrice).toMatch(/bigint/)
      expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(from).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(typeof gasUsed).toMatch(/bigint/)
      for (const log of logs) expect(log.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(logsBloom).toMatch(/^0x/)
      expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(typeof transactionIndex).toMatch(/number/)
      expect(rest).toMatchInlineSnapshot(`
        {
          "contractAddress": null,
          "feeToken": "0x20c0000000000000000000000000000000000000",
          "status": "success",
          "to": "0x20c0000000000000000000000000000000000000",
          "type": "0x76",
        }
      `)
    })
  })

  describe('eth_sendTransactionSync', () => {
    test('default: sends transaction and returns receipt', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      const {
        blockHash,
        blockNumber,
        cumulativeGasUsed,
        effectiveGasPrice,
        feePayer,
        from,
        gasUsed,
        logs,
        logsBloom,
        transactionHash,
        transactionIndex,
        ...rest
      } = receipt
      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(blockNumber).toMatch(/^0x/)
      expect(cumulativeGasUsed).toMatch(/^0x/)
      expect(effectiveGasPrice).toMatch(/^0x/)
      expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(from).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(gasUsed).toMatch(/^0x/)
      for (const log of logs) expect(log.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(logsBloom).toMatch(/^0x/)
      expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(transactionIndex).toMatch(/^0x/)
      expect(rest).toMatchInlineSnapshot(`
        {
          "contractAddress": null,
          "feeToken": "0x20c0000000000000000000000000000000000000",
          "status": "0x1",
          "to": "0x20c0000000000000000000000000000000000000",
          "type": "0x76",
        }
      `)
    })
  })

  describe('eth_signTransaction', () => {
    test('default: signs transaction and returns serialized', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(signed).toMatch(/^0x/)
    })

    test('behavior: signed transaction can be sent via eth_sendRawTransactionSync', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall] }],
      })

      const receipt = await provider.request({
        method: 'eth_sendRawTransactionSync',
        params: [signed],
      })

      const {
        blockHash,
        blockNumber,
        cumulativeGasUsed,
        effectiveGasPrice,
        // @ts-expect-error
        feePayer,
        from,
        gasUsed,
        logs,
        logsBloom,
        transactionHash,
        transactionIndex,
        ...rest
      } = receipt
      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(blockNumber).toMatch(/^0x/)
      expect(cumulativeGasUsed).toMatch(/^0x/)
      expect(effectiveGasPrice).toMatch(/^0x/)
      expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(from).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(gasUsed).toMatch(/^0x/)
      for (const log of logs) expect(log.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(logsBloom).toMatch(/^0x/)
      expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(transactionIndex).toMatch(/^0x/)
      expect(rest).toMatchInlineSnapshot(`
        {
          "contractAddress": null,
          "feeToken": "0x20c0000000000000000000000000000000000000",
          "status": "0x1",
          "to": "0x20c0000000000000000000000000000000000000",
          "type": "0x76",
        }
      `)
    })

    test('error: throws when not connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'eth_signTransaction',
          params: [{ calls: [transferCall] }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('wallet_sendCalls', () => {
    test('default: sends calls and returns id', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [{ calls: [transferCall] }],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: with sync capability returns id and receipt is available', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { sync: true },
          },
        ],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)
      expect(result.capabilities).toMatchInlineSnapshot(`
        {
          "sync": true,
        }
      `)
      expect(result.atomic).toMatchInlineSnapshot(`true`)
      expect(result.chainId).toMatch(/^0x[0-9a-f]+$/)
      expect(result.status).toMatchInlineSnapshot(`200`)
      expect(result.version).toMatchInlineSnapshot(`"2.0.0"`)
      expect(result.receipts?.length).toMatchInlineSnapshot(`1`)
      expect(result.receipts?.[0]?.status).toMatchInlineSnapshot(`"0x1"`)
    })
  })

  describe('wallet_getCallsStatus', () => {
    test('default: returns encoded status for a sent call batch', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const { id } = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { sync: true },
          },
        ],
      })

      const result = await provider.request({
        method: 'wallet_getCallsStatus',
        params: [id],
      })

      expect(result.atomic).toMatchInlineSnapshot(`true`)
      expect(result.chainId).toMatch(/^0x[0-9a-f]+$/)
      expect(result.status).toMatchInlineSnapshot(`200`)
      expect(result.version).toMatchInlineSnapshot(`"2.0.0"`)
      expect(result.receipts?.length).toMatchInlineSnapshot(`1`)
      expect(result.receipts?.[0]?.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('error: throws for unsupported id format', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'wallet_getCallsStatus',
          params: ['0xdeadbeef'],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InternalError: \`id\` not supported]`,
      )
    })
  })

  describe('wallet_getCapabilities', () => {
    test('default: returns atomic supported for all chains', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({ method: 'wallet_getCapabilities' })
      expect(result).toMatchInlineSnapshot(`
        {
          "0x1079": {
            "accessKeys": {
              "status": "supported",
            },
            "atomic": {
              "status": "supported",
            },
          },
          "0xa5bf": {
            "accessKeys": {
              "status": "supported",
            },
            "atomic": {
              "status": "supported",
            },
          },
        }
      `)
    })

    test('behavior: filters by chainIds', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getCapabilities',
        params: [connected, [Hex.fromNumber(tempoModerato.id)]],
      })
      expect(result).toMatchInlineSnapshot(`
        {
          "0xa5bf": {
            "accessKeys": {
              "status": "supported",
            },
            "atomic": {
              "status": "supported",
            },
          },
        }
      `)
    })

    test('behavior: returns empty object for unknown chainIds', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getCapabilities',
        params: [connected, ['0x1']],
      })
      expect(result).toMatchInlineSnapshot(`{}`)
    })

    test('error: throws UnauthorizedError for unconnected address', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await expect(
        provider.request({
          method: 'wallet_getCapabilities',
          params: ['0x0000000000000000000000000000000000000001'],
        }),
      ).rejects.toThrow(core_Provider.UnauthorizedError)
    })

    test('behavior: succeeds with connected address', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getCapabilities',
        params: [connected],
      })
      expect(Object.keys(result).length).toMatchInlineSnapshot(`2`)
      expect(result[Hex.fromNumber(tempo.id)]!.atomic.status).toMatchInlineSnapshot(`"supported"`)
    })
  })

  describe('wallet_getBalances', () => {
    test('error: throws when no tokens provided', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await connect(provider)

      await expect(
        provider.request({ method: 'wallet_getBalances' }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InvalidParamsError: \`tokens\` is required.]`,
      )
    })

    test('default: returns token balances with metadata', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await connect(provider)

      const result = await provider.request({
        method: 'wallet_getBalances',
        params: [{ tokens: ['0x20c0000000000000000000000000000000000001'] }],
      })

      expect(result.length).toMatchInlineSnapshot(`1`)
      expect(result[0]!.address).toMatchInlineSnapshot(
        `"0x20c0000000000000000000000000000000000001"`,
      )
      expect(typeof result[0]!.name).toMatch(/string/)
      expect(typeof result[0]!.symbol).toMatch(/string/)
      expect(typeof result[0]!.decimals).toMatchInlineSnapshot(`"number"`)
      expect(result[0]!.balance).toMatch(/^0x/)
    })

    test('behavior: accepts explicit account param', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getBalances',
        params: [
          {
            account: connected,
            tokens: ['0x20c0000000000000000000000000000000000001'],
          },
        ],
      })

      expect(result.length).toMatchInlineSnapshot(`1`)
      expect(result[0]!.balance).toMatch(/^0x/)
    })

    test('error: throws DisconnectedError when no accounts connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'wallet_getBalances',
          params: [{ tokens: ['0x20c0000000000000000000000000000000000001'] }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('eth_signTypedData_v4', () => {
    const typedData = {
      domain: { name: 'Test', version: '1', chainId: 1 },
      types: {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
      primaryType: 'Person' as const,
      message: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000000' },
    }

    test('default: signs typed data and returns signature', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [connected, JSON.stringify(typedData)],
      })

      expect(signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const connected = await connect(provider)

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [connected, JSON.stringify(typedData)],
      })

      const valid = await verifyTypedData(client, {
        address: connected,
        signature,
        ...typedData,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('error: throws when not connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'eth_signTypedData_v4',
          params: ['0x0000000000000000000000000000000000000001', JSON.stringify(typedData)],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('personal_sign', () => {
    test('default: signs a message and returns signature', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)

      const message = Hex.fromString('hello world')
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, connected],
      })

      expect(signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const connected = await connect(provider)

      const message = Hex.fromString('hello world')
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, connected],
      })

      const valid = await verifyMessage(client, {
        address: connected,
        message: { raw: message },
        signature,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('error: throws when not connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'personal_sign',
          params: [Hex.fromString('hello'), '0x0000000000000000000000000000000000000001'],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('persistence', () => {
    test('behavior: new provider hydrates accounts from shared storage', async () => {
      const storage = Storage.memory({ key: 'persist-test' })

      const provider1 = Provider.create({ adapter: adapter(), storage })
      await connect(provider1)

      const accts1 = await provider1.request({ method: 'eth_accounts' })
      expect(accts1.length).toBeGreaterThanOrEqual(1)

      // Create a second provider with the same storage — it should hydrate.
      const provider2 = Provider.create({ adapter: adapter(), storage })

      // Wait for hydration + reconnection.
      await new Promise((resolve) => setTimeout(resolve, 200))

      const accts2 = await provider2.request({ method: 'eth_accounts' })
      expect(accts2.length).toBeGreaterThanOrEqual(1)
      expect(accts2[0]).toBe(accts1[0])
    })

    test('behavior: concurrent providers with different storage keys are isolated', async () => {
      const providerA = Provider.create({
        adapter: adapter(),
        storage: Storage.memory({ key: 'provider-a' }),
      })
      const providerB = Provider.create({
        adapter: adapter(),
        storage: Storage.memory({ key: 'provider-b' }),
      })

      await connect(providerA)

      const acctsA = await providerA.request({ method: 'eth_accounts' })
      const acctsB = await providerB.request({ method: 'eth_accounts' })

      expect(acctsA.length).toBeGreaterThanOrEqual(1)
      expect(acctsB).toMatchInlineSnapshot(`[]`)
    })
  })

  describe('reconnection', () => {
    test('behavior: hydrated provider has accounts available', async () => {
      const storage = Storage.memory({ key: 'reconnect' })

      const provider1 = Provider.create({ adapter: adapter(), storage })
      await connect(provider1)

      const provider2 = Provider.create({ adapter: adapter(), storage })

      // Wait for hydration.
      await new Promise((resolve) => setTimeout(resolve, 200))

      const accts = await provider2.request({ method: 'eth_accounts' })
      expect(accts.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('viem compatibility', () => {
    test('behavior: works with viem custom() transport', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const client = provider.getClient()

      // Read action: getBalance
      const balance = await getBalance(client, { address })
      expect(balance).toBeGreaterThanOrEqual(0n)
    })

    test('behavior: WalletClient can sign messages', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)

      const client = createClient({
        account: address,
        chain,
        transport: custom(provider),
      })

      const signature = await signMessage(client, {
        account: address,
        message: 'hello',
      })
      expect(signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: WalletClient can send transactions', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const client = createClient({
        account: address,
        chain,
        transport: custom(provider),
      })

      const receipt = await sendTransactionSync(client, {
        account: address,
        to: '0x0000000000000000000000000000000000000001',
        value: 0n,
      })
      expect(receipt.status).toBe('success')
    })
  })

  describe('wallet_authorizeAccessKey', () => {
    test('behavior: without publicKey or address requires a connected account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'wallet_authorizeAccessKey',
          params: [{ expiry: Expiry.days(1) }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No active account.]`,
      )
    })

    test('default: grants an access key and returns its address', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const rootAddress = await connect(provider)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(result.keyAuthorization.keyId).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(result.rootAddress).toBe(rootAddress)
    })

    test('behavior: granted access key is used for sendTransactionSync', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('behavior: with expiry option', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry }],
      })
      expect(result.keyAuthorization.keyId).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(result.keyAuthorization.expiry).toBe(Hex.fromNumber(expiry))
    })

    test('behavior: expired access key falls back to root account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(provider.store.getState().accessKeys.length).toBe(1)

      // Expire the access key by mutating the store.
      const { accessKeys } = provider.store.getState()
      provider.store.setState({
        accessKeys: accessKeys.map((k) => ({
          ...k,
          expiry: Math.floor(Date.now() / 1000) - 1,
        })),
      })

      // Transaction should still succeed via root account fallback.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      // Verify transaction was sent by the root account, not the access key.
      expect(receipt.from.toLowerCase()).toBe(address.toLowerCase())

      // Expired access key should be removed from the store.
      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: with limits option', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('5', 6)) }],
          },
        ],
      })
      expect(result.keyAuthorization.limits).toMatchInlineSnapshot(`
        [
          {
            "limit": "0x4c4b40",
            "token": "0x20c0000000000000000000000000000000000000",
          },
        ]
      `)

      // Transaction within limit should succeed.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('exceeding access key limits falls back to root account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      // Grant access key with a tiny limit (0.01 PUSD).
      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('0.01', 6)) }],
          },
        ],
      })

      // Transfer 1 PUSD — exceeds access key limit, falls back to root account.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toBe('0x1')
      expect(receipt.from.toLowerCase()).toBe(address.toLowerCase())
    })

    test('behavior: access key is removed after key-auth error (spending limit exceeded)', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      // Grant access key with a tiny limit.
      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('0.01', 6)) }],
          },
        ],
      })

      expect(provider.store.getState().accessKeys).toHaveLength(1)

      // Transfer exceeds limit — key-auth error — access key should be removed.
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    })
  })

  describe('wallet_revokeAccessKey', () => {
    test('default: revokes a granted access key', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const connected = (await provider.request({ method: 'eth_accounts' }))[0]!
      const { keyAuthorization } = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      await provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address: connected, accessKeyAddress: keyAuthorization.address }],
      })

      // After revoking, sendTransactionSync should use root key (still works)
      const address = (await provider.request({ method: 'eth_accounts' }))[0]!
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })
  })

  describe('wallet_connect with authorizeAccessKey', () => {
    test('default: grants access key during register', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              method: 'register',
              authorizeAccessKey: { expiry: Math.floor(Date.now() / 1000) + 3600 },
            },
          },
        ],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
      expect(result.accounts[0]!.capabilities.keyAuthorization!.keyId).toMatch(/^0x[0-9a-f]{40}$/i)

      // Access key should be provisioned — sendTransactionSync should work
      const address = result.accounts[0]!.address
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('behavior: authorizeAccessKey with expiry during register', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', authorizeAccessKey: { expiry } } }],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: authorizeAccessKey during login', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      // Register first
      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })

      // Login with authorizeAccessKey
      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: { authorizeAccessKey: { expiry: Math.floor(Date.now() / 1000) + 3600 } },
          },
        ],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)

      const address = result.accounts[0]!.address
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })
  })

  describe('Provider.create authorizeAccessKey option', () => {
    test('default: wallet_connect auto-authorizes access key', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        authorizeAccessKey: () => ({ expiry: Expiry.days(1) }),
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
      expect(result.accounts[0]!.capabilities.keyAuthorization!.keyId).toMatch(/^0x[0-9a-f]{40}$/i)
    })

    test('behavior: auto-authorized access key can send transactions', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        authorizeAccessKey: () => ({ expiry: Expiry.days(1) }),
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      const address = result.accounts[0]!.address
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('behavior: explicit authorizeAccessKey overrides default', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        authorizeAccessKey: () => ({ expiry: Expiry.days(7) }),
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', authorizeAccessKey: { expiry } } }],
      })
      expect(result.accounts[0]!.capabilities.keyAuthorization!.expiry).toBe(Hex.fromNumber(expiry))
    })

    test('behavior: login auto-authorizes access key', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        authorizeAccessKey: () => ({ expiry: Expiry.days(1) }),
      })

      await connect(provider)
      const result = await provider.request({ method: 'wallet_connect' })
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
    })

    test('behavior: without option, wallet_connect does not auto-authorize', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeUndefined()
    })
  })

  describe('wallet_authorizeAccessKey with external key', () => {
    test('default: grants access key for an external key', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ ...accessKeyAccount, expiry: Expiry.days(1) }],
      })
      expect(result.keyAuthorization.keyId).toBe(accessKeyAccount.address)
      expect(result.keyAuthorization.keyType).toBe('p256')
    })

    test('behavior: external key authorization can be used to send a transaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const rootAddress = await connect(provider)
      await fund(rootAddress)

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ ...accessKeyAccount, expiry: Expiry.days(1) }],
      })

      const client = provider.getClient()
      const receipt = await sendTransactionSync(client, {
        account: TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress }),
        calls: [transferCall],
        keyAuthorization: KeyAuthorization.fromRpc(result.keyAuthorization),
      })
      expect(receipt.status).toBe('success')
    })
  })

  describe('wallet_connect with external authorizeAccessKey', () => {
    test('default: external key authorization via register', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const connectResult = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              method: 'register',
              authorizeAccessKey: { expiry, ...accessKeyAccount },
            },
          },
        ],
      })

      const rootAddress = connectResult.accounts[0]!.address
      const keyAuthorization = connectResult.accounts[0]!.capabilities.keyAuthorization
      expect(keyAuthorization).toBeDefined()
      expect(keyAuthorization!.keyId).toBe(accessKeyAccount.address)

      await fund(rootAddress)

      const client = provider.getClient()
      const receipt = await sendTransactionSync(client, {
        account: TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress }),
        calls: [transferCall],
        keyAuthorization: KeyAuthorization.fromRpc(keyAuthorization!),
      })
      expect(receipt.status).toBe('success')
    })

    test('behavior: external key authorization via login', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const rootAddress = await connect(provider)
      await fund(rootAddress)

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const loginResult = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: { expiry, ...accessKeyAccount },
            },
          },
        ],
      })

      const keyAuthorization = loginResult.accounts[0]!.capabilities.keyAuthorization
      expect(keyAuthorization).toBeDefined()

      const client = provider.getClient()
      const receipt = await sendTransactionSync(client, {
        account: TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress }),
        calls: [transferCall],
        keyAuthorization: KeyAuthorization.fromRpc(keyAuthorization!),
      })
      expect(receipt.status).toBe('success')
    })
  })

  describe('feePayer', () => {
    const feePayerAccount = accounts[0]!
    let server: Server

    beforeAll(async () => {
      server = await createServer(
        Handler.feePayer({
          account: feePayerAccount,
          chains: [chain],
          transports: { [chain.id]: http() },
        }).listener,
      )
    })

    afterAll(() => {
      server.close()
    })

    test('default: feePayer URL on eth_sendTransaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: server.url }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer URL on eth_sendTransactionSync', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('2', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: server.url }],
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer URL on eth_signTransaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall], feePayer: server.url }],
      })

      expect(signed).toMatch(/^0x/)
    })

    test('behavior: feePayer: true uses default from Provider.create', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayerUrl: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: true }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer: true on eth_sendTransactionSync', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayerUrl: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('3', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: true }],
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: no feePayer does not use fee payer', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
    })
  })
})
