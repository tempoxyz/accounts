import { requestProviders } from 'mipd'
import { Hex } from 'ox'
import { type Address, parseUnits } from 'viem'
import { verifyHash, verifyMessage, verifyTypedData } from 'viem/actions'
import { Actions, Addresses } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, chain, getClient } from '../../test/config.js'
import { url as webauthnUrl } from '../../test/webauthn.constants.js'
import { webAuthn } from './adapters/webAuthn.js'
import * as Expiry from './Expiry.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'
import * as WebAuthnCeremony from './WebAuthnCeremony.js'

const ceremony = WebAuthnCeremony.server({ url: webauthnUrl })

function getProvider(options: Partial<Provider.create.Options> = {}) {
  return Provider.create({
    storage: Storage.idb({ key: crypto.randomUUID() }),
    adapter: webAuthn({ ceremony }),
    ...options,
  })
}

const transferCall = Actions.token.transfer.call({
  to: '0x0000000000000000000000000000000000000001',
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

describe('create', () => {
  test('default: returns an EIP-1193 provider', async () => {
    const provider = getProvider()
    expect(provider).toBeDefined()
    expect(typeof provider.request).toMatchInlineSnapshot(`"function"`)
  })
})

describe('eth_chainId', () => {
  test('default: returns configured chain ID as hex', async () => {
    const provider = getProvider()

    const chainId = await provider.request({ method: 'eth_chainId' })
    expect(chainId).toMatchInlineSnapshot(`"0x1079"`)
  })
})

describe('eth_requestAccounts', () => {
  test('default: returns accounts after registering', async () => {
    const provider = getProvider()

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    const accts = await provider.request({ method: 'eth_requestAccounts' })
    expect(accts).toHaveLength(1)
    expect(accts[0]).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})

describe('wallet_connect', () => {
  test('default: register returns ERC-7846 response', async () => {
    const provider = getProvider()

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
  })

  test('behavior: register preserves existing accounts', async () => {
    const provider = getProvider()

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    expect(result.accounts.length).toMatchInlineSnapshot(`2`)
    // New account is active (first) and differs from the loaded one
    expect(result.accounts[0]!.address).not.toBe(result.accounts[1]!.address)
  })

  test('behavior: login with digest returns signature in capabilities', async () => {
    const provider = getProvider({ chains: [chain] })

    // Register first to create a credential
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { digest: '0xdeadbeef' } }],
    })
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: digest signature is verifiable on-chain', async () => {
    const provider = getProvider({ chains: [chain] })

    // Register and fund
    const regResult = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    const address = regResult.accounts[0]!.address
    await fundAccount(address)

    // Disconnect and login with digest
    await provider.request({ method: 'wallet_disconnect' })
    const digest = '0x00000000000000000000000000000000000000000000000000000000deadbeef' as const
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { digest } }],
    })

    const client = provider.getClient()
    const valid = await verifyHash(client, {
      address,
      hash: digest,
      signature: result.accounts[0]!.capabilities.signature!,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })

  test('behavior: login without digest returns empty capabilities', async () => {
    const provider = getProvider()

    // Register first so a credential exists for login
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })

    const result = await provider.request({ method: 'wallet_connect' })
    expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
  })

  test('behavior: register without digest returns empty capabilities', async () => {
    const provider = getProvider()

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
  })

  test('behavior: register with digest returns signature in capabilities', async () => {
    const provider = getProvider({ chains: [chain] })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', digest: '0xdeadbeef' } }],
    })
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: register digest signature is verifiable on-chain', async () => {
    const provider = getProvider({ chains: [chain] })

    const digest = '0x00000000000000000000000000000000000000000000000000000000deadbeef' as const
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', digest } }],
    })

    const client = provider.getClient()
    const valid = await verifyHash(client, {
      address: result.accounts[0]!.address,
      hash: digest,
      signature: result.accounts[0]!.capabilities.signature!,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })

  test('behavior: signature only on signer account, not others', async () => {
    const provider = getProvider({ chains: [chain] })

    // Register first, then login with digest
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })

    // Login creates a new credential, register another
    await provider.request({ method: 'wallet_connect' })
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    // Now login with digest — signature only on the loaded account
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { digest: '0xabcd' } }],
    })

    const withSig = result.accounts.filter((a) => a.capabilities.signature)
    const withoutSig = result.accounts.filter((a) => !a.capabilities.signature)
    expect(withSig).toHaveLength(1)
    expect(withSig[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    expect(withoutSig.length).toBeGreaterThanOrEqual(1)
  })

  test('behavior: login deduplicates and sets active account', async () => {
    const provider = getProvider()

    // Register then login with same loadAccounts
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    await provider.request({ method: 'wallet_connect' })

    // Deduplicated (same credential returned on login)
    expect(provider.store.getState().accounts.length).toMatchInlineSnapshot(`1`)
    // Active is the loaded account (returned first by eth_accounts)
    const { activeAccount } = provider.store.getState()
    const loadedAddress = provider.store.getState().accounts[activeAccount]!.address
    const result = await provider.request({ method: 'eth_accounts' })
    expect(result[0]).toBe(loadedAddress)
  })
})

describe('wallet_disconnect', () => {
  test('default: clears state', async () => {
    const provider = getProvider()

    await connect(provider)
    await provider.request({ method: 'wallet_disconnect' })

    expect(provider.store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })
})

describe('events', () => {
  test('behavior: does not emit accountsChanged on duplicate login', async () => {
    const provider = getProvider()

    await connect(provider)

    const events: unknown[] = []
    provider.on('accountsChanged', (accts) => events.push(accts))

    await provider.request({ method: 'wallet_connect' })

    expect(events).toMatchInlineSnapshot(`[]`)
  })
})

describe('eth_sendTransaction', () => {
  test('default: sends transaction and returns hash', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ calls: [transferCall] }],
    })

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('eth_sendTransactionSync', () => {
  test('default: sends transaction and returns receipt', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall] }],
    })

    const {
      blockHash,
      blockNumber,
      cumulativeGasUsed,
      effectiveGasPrice,
      gasUsed,
      logs,
      logsBloom,
      transactionHash,
      transactionIndex,
      from,
      to,
      feePayer,
      ...rest
    } = receipt
    expect(blockHash).toBeDefined()
    expect(blockNumber).toBeDefined()
    expect(cumulativeGasUsed).toBeDefined()
    expect(effectiveGasPrice).toBeDefined()
    expect(gasUsed).toBeDefined()
    expect(logs).toBeInstanceOf(Array)
    expect(logsBloom).toBeDefined()
    expect(transactionHash).toBeDefined()
    expect(transactionIndex).toBeDefined()
    expect(from).toMatch(/^0x[0-9a-f]{40}$/)
    expect(to).toMatch(/^0x[0-9a-f]{40}$/)
    expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/)
    expect(rest).toMatchInlineSnapshot(`
      {
        "contractAddress": null,
        "feeToken": "0x20c0000000000000000000000000000000000000",
        "status": "0x1",
        "type": "0x76",
      }
    `)
  })
})

describe('eth_signTransaction', () => {
  test('default: signs transaction and returns serialized', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const signed = await provider.request({
      method: 'eth_signTransaction',
      params: [{ calls: [transferCall] }],
    })

    expect(signed).toMatch(/^0x/)
  })

  test('behavior: signed transaction can be sent via eth_sendRawTransactionSync', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const signed = await provider.request({
      method: 'eth_signTransaction',
      params: [{ calls: [transferCall] }],
    })

    const receipt = await provider.request({
      method: 'eth_sendRawTransactionSync',
      params: [signed],
    })

    expect(receipt.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
  })
})

describe('wallet_sendCalls', () => {
  test('default: sends calls and returns id', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [transferCall],
        },
      ],
    })

    expect(result.id).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: with sync capability returns id and sync capability', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

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
  })

  test('behavior: sync false uses async path', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const result = await provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [transferCall],
          capabilities: { sync: false },
        },
      ],
    })

    expect(result.id).toMatch(/^0x[0-9a-f]+$/)
    expect(result.capabilities).toMatchInlineSnapshot(`
      {
        "sync": false,
      }
    `)
  })
})

describe('personal_sign', () => {
  test('default: signs a message and returns signature', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)

    const message = Hex.fromString('hello world')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, address],
    })

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: signature is verifiable on-chain', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const message = Hex.fromString('hello world')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, address],
    })

    const client = provider.getClient()
    const valid = await verifyMessage(client, {
      address,
      message: { raw: message },
      signature,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
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
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typedData)],
    })

    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: signature is verifiable on-chain', async () => {
    const provider = getProvider({ chains: [chain] })

    const address = await connect(provider)
    await fundAccount(address)

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typedData)],
    })

    const client = provider.getClient()
    const valid = await verifyTypedData(client, {
      address,
      signature,
      ...typedData,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })
})

describe('wallet_authorizeAccessKey', () => {
  test('default: grants an access key and returns its address', async () => {
    const provider = getProvider({ chains: [chain] })
    const rootAddress = await connect(provider)

    const result = await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry: Expiry.days(1) }],
    })
    expect(result.keyAuthorization.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(result.rootAddress).toBe(rootAddress)
  })

  test('behavior: granted access key is used for sendTransactionSync', async () => {
    const provider = getProvider({ chains: [chain] })
    const address = await connect(provider)
    await fundAccount(address)

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
    const provider = getProvider({ chains: [chain] })
    await connect(provider)

    const expiry = Math.floor(Date.now() / 1000) + 3600
    const result = await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry }],
    })
    expect(result.keyAuthorization.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(result.keyAuthorization.expiry).toBe(Hex.fromNumber(expiry))
  })

  test('behavior: with limits option', async () => {
    const provider = getProvider({ chains: [chain] })
    const address = await connect(provider)
    await fundAccount(address)

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

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall] }],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
  })
})

describe('wallet_revokeAccessKey', () => {
  test('default: revokes a granted access key', async () => {
    const provider = getProvider({ chains: [chain] })
    await connect(provider)

    const connected = (await provider.request({ method: 'eth_accounts' }))[0]!
    const { keyAuthorization } = await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry: Expiry.days(1) }],
    })

    await provider.request({
      method: 'wallet_revokeAccessKey',
      params: [{ address: connected, accessKeyAddress: keyAuthorization.keyId }],
    })

    await fundAccount(connected)

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall] }],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
  })
})

describe('wallet_connect with authorizeAccessKey', () => {
  test('default: grants access key during register', async () => {
    const provider = getProvider({ chains: [chain] })

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
    expect(result.accounts[0]!.capabilities.keyAuthorization!.address).toMatch(/^0x[0-9a-f]{40}$/i)

    const address = result.accounts[0]!.address
    await fundAccount(address)

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall] }],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
  })

  test('behavior: authorizeAccessKey with expiry during register', async () => {
    const provider = getProvider({ chains: [chain] })

    const expiry = Math.floor(Date.now() / 1000) + 3600
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', authorizeAccessKey: { expiry } } }],
    })
    expect(result.accounts.length).toBeGreaterThanOrEqual(1)
  })

  test('behavior: authorizeAccessKey during login', async () => {
    const provider = getProvider({ chains: [chain] })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

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
    await fundAccount(address)

    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall] }],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
  })

  test('behavior: authorizeAccessKey with digest during register', async () => {
    const provider = getProvider({ chains: [chain] })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            method: 'register',
            digest: '0xdeadbeef',
            authorizeAccessKey: { expiry: Math.floor(Date.now() / 1000) + 3600 },
          },
        },
      ],
    })
    expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
  })
})

describe('eip-6963', () => {
  test('default: announces provider when adapter has icon, name, and rdns', async () => {
    const discovered: { info: { icon: string; name: string; rdns: string; uuid: string } }[] = []
    const unsubscribe = requestProviders((detail) => discovered.push(detail as never))

    getProvider({
      adapter: webAuthn({
        ceremony,
        icon: 'data:image/svg+xml,<svg></svg>',
        name: 'Test Wallet',
        rdns: 'com.example.test',
      }),
    })

    // Wait a tick for the event to fire
    await new Promise((resolve) => setTimeout(resolve, 0))

    const match = discovered.find((d) => d.info.rdns === 'com.example.test')!
    expect(match.info.name).toMatchInlineSnapshot(`"Test Wallet"`)
    expect(match.info.rdns).toMatchInlineSnapshot(`"com.example.test"`)
    expect(match.info.icon).toMatchInlineSnapshot(`"data:image/svg+xml,<svg></svg>"`)
    expect(match.info.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    unsubscribe?.()
  })

  test('behavior: defaults icon and rdns when not provided', async () => {
    const discovered: { info: { icon: string; name: string; rdns: string } }[] = []
    const unsubscribe = requestProviders((detail) => discovered.push(detail as never))

    getProvider({
      adapter: webAuthn({ ceremony, name: 'My Wallet' }),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const info = discovered[discovered.length - 1]!.info
    expect(info.name).toMatchInlineSnapshot(`"My Wallet"`)
    expect(info.rdns).toMatchInlineSnapshot(`"com.mywallet"`)
    expect(info.icon).toMatch(/^data:image\/svg\+xml,/)

    unsubscribe?.()
  })
})

/** Funds an account with fee tokens so it can send transactions. */
async function fundAccount(address: Address) {
  const client = getClient()
  await Actions.token.transferSync(client, {
    account: accounts[0]!,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}

/** Registers a new account and returns its address. */
async function connect(provider: ReturnType<typeof getProvider>) {
  const result = await provider.request({
    method: 'wallet_connect',
    params: [{ capabilities: { method: 'register' } }],
  })
  return result.accounts[0]!.address
}
