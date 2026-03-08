import { Hex, Provider as core_Provider } from 'ox'
import { type Address, createClient, custom, http, parseUnits } from 'viem'
import { verifyHash, verifyMessage, verifyTypedData, waitForTransactionReceipt } from 'viem/actions'
import { tempo, tempoModerato } from 'viem/chains'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vitest'

import { headlessWebAuthn, secp256k1 } from '../../test/adapters.js'
import { accounts, chain } from '../../test/config.js'
import * as Provider from './Provider.js'

const adapters = [
  { name: 'headlessWebAuthn', adapter: headlessWebAuthn },
  { name: 'secp256k1', adapter: secp256k1 },
] as const

describe.each(adapters)('$name', ({ adapter }) => {
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
    const client = createClient({ chain, transport: http() })
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

    test('behavior: returns active account first', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })

      const result = await provider.request({ method: 'eth_requestAccounts' })
      expect(result.length).toMatchInlineSnapshot(`2`)
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

    test('behavior: register preserves existing accounts and sets activeAccount', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts.length).toMatchInlineSnapshot(`2`)
      expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
      expect(provider.store.getState().accounts.length).toMatchInlineSnapshot(`2`)
    })

    test('behavior: login preserves existing accounts and deduplicates', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      await provider.request({ method: 'wallet_connect' })

      expect(provider.store.getState().accounts.length).toBeGreaterThanOrEqual(1)
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
      const client = createClient({ chain, transport: custom(provider) })

      await connect(provider)
      const digest = '0xdeadbeef' as const
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
      const client = createClient({ chain, transport: custom(provider) })

      const digest = '0xdeadbeef' as const
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

    test('behavior: signature only on signer account, not others', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { digest: '0xabcd' } }],
      })

      const withSig = result.accounts.filter((a) => a.capabilities.signature)
      const withoutSig = result.accounts.filter((a) => !a.capabilities.signature)
      expect(withSig.length).toMatchInlineSnapshot(`1`)
      expect(withSig[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
      expect(withoutSig.length).toBeGreaterThanOrEqual(1)
      expect(withoutSig[0]!.capabilities).toMatchInlineSnapshot(`{}`)
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

      const client = createClient({ chain, transport: custom(provider) })
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
            "atomic": {
              "status": "supported",
            },
          },
          "0xa5bf": {
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
      const client = createClient({ chain, transport: custom(provider) })

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
      const client = createClient({ chain, transport: custom(provider) })

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

  describe('rpc proxy', () => {
    test('error: proxies unknown methods to RPC client', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await expect(provider.request({ method: 'eth_blockNumber' } as any)).rejects.toThrow()
    })
  })
})
