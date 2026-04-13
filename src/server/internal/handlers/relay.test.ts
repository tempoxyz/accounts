import type { RpcRequest } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { parseUnits } from 'viem'
import { fillTransaction, sendTransactionSync } from 'viem/actions'
import { Actions, Addresses, Capabilities, Tick, Transaction } from 'viem/tempo'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, addresses, chain, getClient, http } from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import { relay } from './relay.js'

const userAccount = accounts[9]!
const feePayerAccount = accounts[0]!
const recipient = accounts[7]!

/** Case-insensitive lookup into balanceDiffs keyed by address. */
function findDiffs(
  balanceDiffs: Capabilities.FillTransactionCapabilities['balanceDiffs'],
  address: string,
) {
  return Object.entries(balanceDiffs ?? {}).find(
    ([addr]) => addr.toLowerCase() === address.toLowerCase(),
  )?.[1]
}

/** A simple transfer call for tests that just need a valid transaction. */
const transferCall = () =>
  Actions.token.transfer.call({
    token: addresses.alphaUsd,
    to: recipient.address,
    amount: 1n,
  })

describe('behavior: without feePayer', () => {
  let client: ReturnType<typeof getClient<typeof chain>>
  let server: Server

  beforeAll(async () => {
    // Fund userAccount with alphaUsd for fees + transfers.
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: addresses.alphaUsd,
      amount: parseUnits('100', 6),
      to: userAccount.address,
    })
    await Actions.fee.setUserToken(rpc, { account: userAccount, token: addresses.alphaUsd })

    server = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  test('default: returns filled transaction with capabilities', async () => {
    const { transaction } = await fillTransaction(client, {
      account: userAccount.address,
      calls: [transferCall()],
    })

    expect(transaction.gas).toBeDefined()
    expect(transaction.nonce).toBeDefined()
  })

  test('behavior: proxies other methods to RPC node', async () => {
    const chainId = await client.request({ method: 'eth_chainId' })
    expect(Number(chainId)).toMatchInlineSnapshot(`${chain.id}`)
  })
})

describe('behavior: capabilities', () => {
  let server: Server
  let client: ReturnType<typeof getClient<typeof chain>>

  beforeAll(async () => {
    server = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  test('default: returns fee and sponsored info', async () => {
    const result = await fillTransaction(client, {
      account: userAccount.address,
      calls: [transferCall()],
    })
    const meta = result.capabilities

    expect(meta?.fee).toBeDefined()
    expect(meta?.fee?.decimals).toBe(6)
    expect(meta?.fee?.symbol).toBe('AlphaUSD')
    expect(meta?.sponsored).toBe(false)
  })

  test('behavior: token transfer produces balance diffs', async () => {
    const sender = accounts[6]!
    const recipient = accounts[7]!
    const token = addresses.alphaUsd

    // Mint tokens to sender (enough for transfer + fee).
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token,
      amount: 1_000_000n,
      to: sender.address,
    })
    // Set fee token so relay doesn't need pathUSD balance.
    await Actions.fee.setUserToken(rpc, { account: sender, token })

    const { data, to: callTo } = Actions.token.transfer.call({
      token,
      to: recipient.address,
      amount: 100n,
    })
    const result = await fillTransaction(client, {
      account: sender.address,
      to: callTo,
      data,
    })

    const meta = result.capabilities
    const senderDiffs = findDiffs(meta?.balanceDiffs, sender.address)!
    const tokenDiff = senderDiffs.find((d) => d.address.toLowerCase() === token.toLowerCase())!
    expect(tokenDiff.decimals).toBe(6)
    expect(tokenDiff.direction).toBe('outgoing')
    expect(tokenDiff.formatted).toBe('0.0001')
    expect(tokenDiff.symbol).toBe('AlphaUSD')
    expect(tokenDiff.value).toBe('0x64')
  })

  test('behavior: approve + dex swap + transfer produces balance diffs', async () => {
    const sender = accounts[8]!
    const recipient = accounts[7]!

    // Set up token pair + DEX liquidity.
    const rpc = getClient({ account: accounts[0]! })
    const { token: quote } = await Actions.token.createSync(rpc, {
      name: 'Test Quote',
      symbol: 'TQUOTE',
      currency: 'USD',
    })
    const { token: base } = await Actions.token.createSync(rpc, {
      name: 'Test Base',
      symbol: 'TBASE',
      currency: 'USD',
      quoteToken: quote,
    })
    await sendTransactionSync(rpc, {
      calls: [
        Actions.token.grantRoles.call({ token: base, role: 'issuer', to: rpc.account!.address }),
        Actions.token.grantRoles.call({ token: quote, role: 'issuer', to: rpc.account!.address }),
        Actions.token.mint.call({
          token: base,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.mint.call({
          token: quote,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: base,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: quote,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
      ],
    })
    await Actions.dex.createPairSync(rpc, { base })
    await Actions.dex.placeSync(rpc, {
      token: base,
      amount: parseUnits('500', 6),
      type: 'sell',
      tick: Tick.fromPrice('1.001'),
    })

    // Fund sender with quote tokens + fee tokens.
    await Actions.token.mintSync(rpc, {
      token: quote,
      amount: parseUnits('1000', 6),
      to: sender.address,
    })
    await Actions.token.mintSync(rpc, {
      token: addresses.alphaUsd,
      amount: parseUnits('1000', 6),
      to: sender.address,
    })
    await Actions.fee.setUserToken(getClient({ account: sender }), { token: addresses.alphaUsd })

    const buyAmount = parseUnits('10', 6)
    const result = await fillTransaction(client, {
      account: sender.address,
      calls: [
        Actions.token.approve.call({
          token: quote,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('100', 6),
        }),
        Actions.dex.buy.call({
          tokenIn: quote,
          tokenOut: base,
          amountOut: buyAmount,
          maxAmountIn: parseUnits('100', 6),
        }),
        Actions.token.transfer.call({
          token: base,
          to: recipient.address,
          amount: buyAmount,
        }),
      ],
    })
    const meta = result.capabilities

    const diffs = findDiffs(meta?.balanceDiffs, sender.address)!
    expect(diffs).toHaveLength(1)

    const quoteDiff = diffs[0]!
    expect(quoteDiff.address.toLowerCase()).toBe(quote.toLowerCase())
    expect(quoteDiff.direction).toBe('outgoing')
    expect(quoteDiff.symbol).toBe('TQUOTE')
    expect(quoteDiff.name).toBe('Test Quote')
    expect(quoteDiff.decimals).toBe(6)
    // No base diff — bought and immediately transferred out (net zero).
    expect(diffs.find((d) => d.address.toLowerCase() === base.toLowerCase())).toBeUndefined()
  })

  test('behavior: approval covered by transfer is suppressed', async () => {
    const sender = accounts[6]!
    const recipient = accounts[7]!
    const token = addresses.alphaUsd

    // approve(100) + transfer(100) to same spender → approval fully covered.
    const result = await fillTransaction(client, {
      account: sender.address,
      calls: [
        Actions.token.approve.call({
          token,
          spender: recipient.address,
          amount: 100n,
        }),
        Actions.token.transfer.call({
          token,
          to: recipient.address,
          amount: 100n,
        }),
      ],
    })
    const meta = result.capabilities

    const diffs = findDiffs(meta?.balanceDiffs, sender.address)!
    const tokenDiff = diffs.find((d) => d.address.toLowerCase() === token.toLowerCase())!
    // Only the transfer shows — approval is fully covered.
    expect(tokenDiff.value).toBe('0x64')
    expect(tokenDiff.direction).toBe('outgoing')
  })

  test('behavior: uncovered approval shows as outgoing', async () => {
    const sender = accounts[6]!
    const spender = accounts[7]!
    const token = addresses.alphaUsd

    // approve(200) + transfer(50) to same spender → 150 uncovered approval.
    const result = await fillTransaction(client, {
      account: sender.address,
      calls: [
        Actions.token.approve.call({
          token,
          spender: spender.address,
          amount: 200n,
        }),
        Actions.token.transfer.call({
          token,
          to: spender.address,
          amount: 50n,
        }),
      ],
    })
    const meta = result.capabilities

    const diffs = findDiffs(meta?.balanceDiffs, sender.address)!
    const tokenDiff = diffs.find((d) => d.address.toLowerCase() === token.toLowerCase())!
    // transfer(50) + uncovered approval(150) = 200 outgoing.
    expect(tokenDiff.value).toBe('0xc8')
    expect(tokenDiff.direction).toBe('outgoing')
  })
})

describe('behavior: AMM resolution', () => {
  let server: Server
  let client: ReturnType<typeof getClient<typeof chain>>

  beforeAll(async () => {
    server = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: prepends swap calls on InsufficientBalance', async () => {
    const sender = accounts[4]!

    // Set up token pair + DEX liquidity.
    // Use alphaUsd as the quote token so the relay can swap alphaUsd → base.
    const rpc = getClient({ account: accounts[0]! })
    const { token: base } = await Actions.token.createSync(rpc, {
      name: 'Swap Base',
      symbol: 'SWBASE',
      currency: 'USD',
      quoteToken: addresses.alphaUsd,
    })
    await sendTransactionSync(rpc, {
      calls: [
        Actions.token.grantRoles.call({ token: base, role: 'issuer', to: rpc.account!.address }),
        Actions.token.mint.call({
          token: base,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.mint.call({
          token: addresses.alphaUsd,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: base,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: addresses.alphaUsd,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
      ],
    })
    await Actions.dex.createPairSync(rpc, { base })
    await Actions.dex.placeSync(rpc, {
      token: base,
      amount: parseUnits('500', 6),
      type: 'sell',
      tick: Tick.fromPrice('1.001'),
    })

    // Give sender alphaUsd (fee token) but NO base tokens.
    await Actions.token.mintSync(rpc, {
      token: addresses.alphaUsd,
      amount: parseUnits('1000', 6),
      to: sender.address,
    })
    await Actions.fee.setUserToken(getClient({ account: sender }), { token: addresses.alphaUsd })

    // Sender tries to transfer base tokens they don't have.
    // Relay should detect InsufficientBalance, swap alphaUsd → base via DEX, and retry.
    const transferAmount = parseUnits('5', 6)
    const result = await fillTransaction(client, {
      account: sender.address,
      ...Actions.token.transfer.call({
        token: base,
        to: accounts[7]!.address,
        amount: transferAmount,
      }),
    })

    // Should succeed — relay auto-swapped quote → base.
    const { transaction, capabilities } = result
    expect(transaction.gas).toBeDefined()
    expect(transaction.nonce).toBeDefined()
    expect(transaction.feeToken).toBe(addresses.alphaUsd)
    expect(transaction.calls).toHaveLength(3) // approve + swap + transfer

    const m = capabilities
    expect(m?.sponsored).toBe(false)
    expect(m?.fee?.decimals).toBe(6)
    expect(m?.fee?.symbol).toBe('AlphaUSD')

    // Balance diffs exclude swap tokens — only the user's transfer shows.
    const diffs = findDiffs(m?.balanceDiffs, sender.address)!
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.direction).toBe('outgoing')
    expect(diffs[0]!.formatted).toBe('5')
    expect(diffs[0]!.symbol).toBe('SWBASE')
    expect(diffs[0]!.address.toLowerCase()).toBe(base.toLowerCase())

    // autoSwap reports the injected AMM swap.
    expect(m?.autoSwap?.slippage).toBe(0.05)
    expect(m?.autoSwap?.maxIn.formatted).toBe('5.25')
    expect(m?.autoSwap?.maxIn.symbol).toBe('AlphaUSD')
    expect(m?.autoSwap?.maxIn.token.toLowerCase()).toBe(addresses.alphaUsd.toLowerCase())
    expect(m?.autoSwap?.minOut.formatted).toBe('5')
    expect(m?.autoSwap?.minOut.symbol).toBe('SWBASE')
    expect(m?.autoSwap?.minOut.token.toLowerCase()).toBe(base.toLowerCase())
  })

  test('behavior: custom slippage is applied to autoSwap', async () => {
    const sender = accounts[2]!

    // Set up token pair + DEX liquidity.
    const rpc = getClient({ account: accounts[0]! })
    const { token: base } = await Actions.token.createSync(rpc, {
      name: 'Slippage Base',
      symbol: 'SLPBASE',
      currency: 'USD',
      quoteToken: addresses.alphaUsd,
    })
    await sendTransactionSync(rpc, {
      calls: [
        Actions.token.grantRoles.call({ token: base, role: 'issuer', to: rpc.account!.address }),
        Actions.token.mint.call({
          token: base,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.mint.call({
          token: addresses.alphaUsd,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: base,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: addresses.alphaUsd,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
      ],
    })
    await Actions.dex.createPairSync(rpc, { base })
    await Actions.dex.placeSync(rpc, {
      token: base,
      amount: parseUnits('500', 6),
      type: 'sell',
      tick: Tick.fromPrice('1.001'),
    })

    // Give sender alphaUsd but NO base tokens.
    await Actions.token.mintSync(rpc, {
      token: addresses.alphaUsd,
      amount: parseUnits('1000', 6),
      to: sender.address,
    })
    await Actions.fee.setUserToken(getClient({ account: sender }), { token: addresses.alphaUsd })

    // Create relay with custom 2% slippage.
    const customServer = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
        autoSwap: { slippage: 0.02 },
      }).listener,
    )
    const customClient = getClient({ transport: http(customServer.url) })

    const result = await fillTransaction(customClient, {
      account: sender.address,
      ...Actions.token.transfer.call({
        token: base,
        to: accounts[7]!.address,
        amount: parseUnits('10', 6),
      }),
    })
    customServer.close()

    const m = result.capabilities
    expect(m?.autoSwap?.slippage).toBe(0.02)
    // 10 + 2% = 10.2
    expect(m?.autoSwap?.maxIn.formatted).toBe('10.2')
    expect(m?.autoSwap?.minOut.formatted).toBe('10')
  })

  test('behavior: autoSwap disabled throws InsufficientBalance instead of swapping', async () => {
    const sender = accounts[3]!

    // Set up token pair + DEX liquidity.
    const rpc = getClient({ account: accounts[0]! })
    const { token: base } = await Actions.token.createSync(rpc, {
      name: 'No Swap Base',
      symbol: 'NSWBASE',
      currency: 'USD',
      quoteToken: addresses.alphaUsd,
    })
    await sendTransactionSync(rpc, {
      calls: [
        Actions.token.grantRoles.call({ token: base, role: 'issuer', to: rpc.account!.address }),
        Actions.token.mint.call({
          token: base,
          to: rpc.account!.address,
          amount: parseUnits('10000', 6),
        }),
        Actions.token.approve.call({
          token: base,
          spender: Addresses.stablecoinDex,
          amount: parseUnits('10000', 6),
        }),
      ],
    })
    await Actions.dex.createPairSync(rpc, { base })
    await Actions.dex.placeSync(rpc, {
      token: base,
      amount: parseUnits('500', 6),
      type: 'sell',
      tick: Tick.fromPrice('1.001'),
    })

    // Give sender alphaUsd but NO base tokens.
    await Actions.token.mintSync(rpc, {
      token: addresses.alphaUsd,
      amount: parseUnits('1000', 6),
      to: sender.address,
    })
    await Actions.fee.setUserToken(getClient({ account: sender }), { token: addresses.alphaUsd })

    // Create relay with autoSwap disabled.
    const customServer = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
        autoSwap: false,
      }).listener,
    )
    const customClient = getClient({ transport: http(customServer.url) })

    // Should throw InsufficientBalance instead of auto-swapping.
    await expect(
      fillTransaction(customClient, {
        account: sender.address,
        ...Actions.token.transfer.call({
          token: base,
          to: accounts[7]!.address,
          amount: parseUnits('5', 6),
        }),
      }),
    ).rejects.toThrow(/InsufficientBalance/)
    customServer.close()
  })
})

describe('behavior: with feePayer', () => {
  let server: Server
  let client: ReturnType<typeof getClient<typeof chain>>
  let requests: RpcRequest.RpcRequest[] = []

  beforeAll(async () => {
    server = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
        feePayer: {
          account: feePayerAccount,
          name: 'Test Sponsor',
          url: 'https://test.com',
        },
        onRequest: async (request) => {
          requests.push(request)
        },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    requests = []
  })

  test('default: returns sponsored tx with feePayerSignature', async () => {
    const { transaction } = await fillTransaction(client, {
      account: userAccount.address,
      calls: [transferCall()],
    })

    expect(transaction.feePayerSignature).toBeDefined()
    expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
  })

  test('behavior: returns sponsor capabilities', async () => {
    const result = await fillTransaction(client, {
      account: userAccount.address,
      calls: [transferCall()],
    })
    const meta = result.capabilities

    expect(meta?.sponsored).toBe(true)
    expect(meta?.sponsor).toMatchInlineSnapshot(`
      {
        "address": "${feePayerAccount.address}",
        "name": "Test Sponsor",
        "url": "https://test.com",
      }
    `)
  })

  test('behavior: sponsored tx can be signed and broadcast', async () => {
    const { transaction } = await fillTransaction(client, {
      account: userAccount.address,
      calls: [transferCall()],
    })
    const serialized = (await Transaction.serialize(transaction as never)) as `0x76${string}`
    const envelope = TxEnvelopeTempo.deserialize(serialized)
    const signature = await userAccount.sign({
      hash: TxEnvelopeTempo.getSignPayload(envelope),
    })
    const signed = TxEnvelopeTempo.serialize(envelope, {
      signature: SignatureEnvelope.from(signature),
    })
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync' as never,
      params: [signed],
    })) as { feePayer?: string | undefined }

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
  })

  test('behavior: missing from returns error', async () => {
    await expect(fillTransaction(client, { calls: [transferCall()] })).rejects.toThrowError()
  })
})

describe('behavior: conditional sponsoring', () => {
  let server: Server
  let client: ReturnType<typeof getClient<typeof chain>>

  beforeAll(async () => {
    // Fund accounts[3] with alphaUsd so transfers succeed.
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: addresses.alphaUsd,
      amount: parseUnits('100', 6),
      to: accounts[3]!.address,
    })
    await Actions.fee.setUserToken(rpc, { account: accounts[3]!, token: addresses.alphaUsd })

    server = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
        feePayer: {
          account: feePayerAccount,
          name: 'Test Sponsor',
          url: 'https://test.com',
          validate: (request) => request.from?.toLowerCase() !== accounts[3]!.address.toLowerCase(),
        },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: approved tx is sponsored and can be broadcast', async () => {
    const { transaction } = await fillTransaction(client, {
      account: userAccount.address,
      calls: [transferCall()],
    })
    expect(transaction.feePayerSignature).toBeDefined()

    const serialized = (await Transaction.serialize(transaction as never)) as `0x76${string}`
    const envelope = TxEnvelopeTempo.deserialize(serialized)
    const signature = await userAccount.sign({
      hash: TxEnvelopeTempo.getSignPayload(envelope),
    })
    const signed = TxEnvelopeTempo.serialize(envelope, {
      signature: SignatureEnvelope.from(signature),
    })
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync' as never,
      params: [signed],
    })) as { feePayer?: string | undefined }

    expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
  })

  test('behavior: rejected tx is not sponsored and can be self-paid', async () => {
    const sender = accounts[3]!
    const result = await fillTransaction(client, {
      account: sender.address,
      calls: [transferCall()],
    })
    expect(result.transaction.feePayerSignature).toBeUndefined()

    const meta = result.capabilities
    expect(meta?.sponsored).toBe(false)
    expect(meta?.sponsor).toBeUndefined()

    const serialized = (await Transaction.serialize(result.transaction as never)) as `0x76${string}`
    const envelope = TxEnvelopeTempo.deserialize(serialized)
    const signature = await sender.sign({
      hash: TxEnvelopeTempo.getSignPayload(envelope),
    })
    const signed = TxEnvelopeTempo.serialize(envelope, {
      signature: SignatureEnvelope.from(signature),
    })
    const receipt = (await getClient().request({
      method: 'eth_sendRawTransactionSync' as never,
      params: [signed],
    })) as { feePayer?: string | undefined }

    // Sender pays their own fee — no external fee payer.
    expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
  })
})

describe('behavior: fee token resolution', () => {
  const feeTokenAccount = accounts[0]!
  const preferredToken = addresses.alphaUsd
  let server: Server
  let client: ReturnType<typeof getClient<typeof chain>>

  beforeAll(async () => {
    // Fund account with alphaUsd so balance check passes.
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: feeTokenAccount,
      token: preferredToken,
      amount: 1_000_000n,
      to: feeTokenAccount.address,
    })

    // Set on-chain fee token preference.
    await Actions.fee.setUserToken(rpc, { account: feeTokenAccount, token: preferredToken })

    server = await createServer(
      relay({
        chains: [chain],
        transports: { [chain.id]: http() },
      }).listener,
    )
    client = getClient({ transport: http(server.url) })
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: uses explicitly provided feeToken', async () => {
    const feeToken = '0x20c0000000000000000000000000000000000001'
    const { transaction } = await fillTransaction(client, {
      account: feeTokenAccount.address,
      calls: [transferCall()],
      feeToken,
    })

    expect(transaction.feeToken).toBe(feeToken)
  })

  test('behavior: resolves to onchain user token when it has balance', async () => {
    const { transaction } = await fillTransaction(client, {
      account: feeTokenAccount.address,
      calls: [transferCall()],
    })

    expect(transaction.feeToken).toBe(preferredToken)
  })

  test('behavior: resolves to highest-balance token from token list', async () => {
    // Mint different amounts of two tokens to a fresh account.
    const freshAccount = accounts[5]!
    const betaUsd = '0x20c0000000000000000000000000000000000002'
    const rpc = getClient()
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: addresses.alphaUsd,
      amount: 100n,
      to: freshAccount.address,
    })
    await Actions.token.mintSync(rpc, {
      account: accounts[0]!,
      token: betaUsd,
      amount: 500n,
      to: freshAccount.address,
    })

    const { transaction } = await fillTransaction(client, {
      account: freshAccount.address,
      calls: [transferCall()],
    })

    // betaUsd has higher balance (500 > 100).
    expect(transaction.feeToken).toBe(betaUsd)
  })

  test('behavior: falls back to pathUSD when no preference or balances', async () => {
    const freshAccount = accounts[10]!
    const { transaction } = await fillTransaction(client, {
      account: freshAccount.address,
      calls: [
        Actions.token.transfer.call({
          token: addresses.alphaUsd,
          to: freshAccount.address,
          amount: 0n,
        }),
      ],
    })

    expect(transaction.feeToken).toBe('0x20c0000000000000000000000000000000000000')
  })
})
