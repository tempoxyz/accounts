import { Hex } from 'ox'
import { type Address, parseUnits } from 'viem'
import { sendTransactionSync } from 'viem/actions'
import { Actions, Addresses, Tick } from 'viem/tempo'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, addresses, chain, getClient, http } from '../../../../test/config.js'
import { createServer, type Server } from '../../../../test/utils.js'
import { exchange } from './exchange.js'

/**
 * Wire shape of the quote response. Amounts are decimal strings — we mirror
 * that here instead of importing a schema (which the handler no longer
 * exports).
 */
type QuoteResponseWire = {
  pairToken: { address: Address; amount: string; name: string; symbol: string }
  token: { address: Address; amount: string; name: string; symbol: string }
  slippage: number
  type: 'buy' | 'sell'
  calls: readonly { to: Address; data: Hex.Hex }[]
}

const liquidityProvider = accounts[0]!

/**
 * Sets up a fresh `(base, quote)` pair on the DEX with a sell-side wall on
 * `base` so buys/sells from a counterparty can fill at ~1:1.
 */
async function setupPair(options: { liquidity?: bigint } = {}): Promise<{
  base: Address
  quote: Address
}> {
  const { liquidity = parseUnits('1000', 6) } = options
  const rpc = getClient({ account: liquidityProvider })

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

  const fundAmount = liquidity * 10n
  await sendTransactionSync(rpc, {
    calls: [
      Actions.token.grantRoles.call({
        token: base,
        role: 'issuer',
        to: liquidityProvider.address,
      }),
      Actions.token.grantRoles.call({
        token: quote,
        role: 'issuer',
        to: liquidityProvider.address,
      }),
      Actions.token.mint.call({ token: base, to: liquidityProvider.address, amount: fundAmount }),
      Actions.token.mint.call({ token: quote, to: liquidityProvider.address, amount: fundAmount }),
      Actions.token.approve.call({
        token: base,
        spender: Addresses.stablecoinDex,
        amount: fundAmount,
      }),
      Actions.token.approve.call({
        token: quote,
        spender: Addresses.stablecoinDex,
        amount: fundAmount,
      }),
    ],
  })
  await Actions.dex.createPairSync(rpc, { base })
  await Actions.dex.placeSync(rpc, {
    token: base,
    amount: liquidity,
    type: 'sell',
    tick: Tick.fromPrice('1.001'),
  })

  return { base, quote }
}

async function fundAccount(token: Address, to: Address, amount: bigint) {
  const rpc = getClient({ account: liquidityProvider })
  await Actions.token.mintSync(rpc, { token, to, amount })
}

describe('default', () => {
  let server: Server
  let base: Address
  let quote: Address

  beforeAll(async () => {
    const pair = await setupPair()
    base = pair.base
    quote = pair.quote

    server = await createServer(
      exchange({
        chains: [chain],
        transports: { [chain.id]: http() },
      }).listener,
    )
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: type=sell returns expected response shape', async () => {
    // Sell 1 quote for base.
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: quote,
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(200)

    const decoded = (await response.json()) as QuoteResponseWire
    const { calls, ...rest } = decoded
    // Token addresses change per test run — snapshot the rest.
    expect({
      ...rest,
      pairToken: { ...rest.pairToken, address: '<pair-token>' as Address },
      token: { ...rest.token, address: '<token>' as Address },
    }).toMatchInlineSnapshot(`
    	{
    	  "pairToken": {
    	    "address": "<pair-token>",
    	    "amount": "0.98901",
    	    "name": "Test Base",
    	    "symbol": "TBASE",
    	  },
    	  "slippage": 0.01,
    	  "token": {
    	    "address": "<token>",
    	    "amount": "1",
    	    "name": "Test Quote",
    	    "symbol": "TQUOTE",
    	  },
    	  "type": "sell",
    	}
    `)

    // approve(token) + sell(dex)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.to.toLowerCase()).toBe(quote.toLowerCase())
    expect(calls[1]!.to.toLowerCase()).toBe(Addresses.stablecoinDex.toLowerCase())
  })

  test('behavior: type=buy returns expected response shape', async () => {
    // Buy 1 base, paying with quote.
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'buy',
        token: base,
        pairToken: quote,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(200)

    const decoded = (await response.json()) as QuoteResponseWire
    const { calls, ...rest } = decoded
    expect({
      ...rest,
      pairToken: { ...rest.pairToken, address: '<pair-token>' as Address },
      token: { ...rest.token, address: '<token>' as Address },
    }).toMatchInlineSnapshot(`
    	{
    	  "pairToken": {
    	    "address": "<pair-token>",
    	    "amount": "1.01101",
    	    "name": "Test Quote",
    	    "symbol": "TQUOTE",
    	  },
    	  "slippage": 0.01,
    	  "token": {
    	    "address": "<token>",
    	    "amount": "1",
    	    "name": "Test Base",
    	    "symbol": "TBASE",
    	  },
    	  "type": "buy",
    	}
    `)

    expect(calls).toHaveLength(2)
    // approve is on the spent token (pairToken == quote for type=buy).
    expect(calls[0]!.to.toLowerCase()).toBe(quote.toLowerCase())
    expect(calls[1]!.to.toLowerCase()).toBe(Addresses.stablecoinDex.toLowerCase())
  })

  test('behavior: returned calls execute the swap end-to-end', async () => {
    const trader = accounts[5]!

    // Fund trader with 100 quote (selling 1 quote) + alphaUsd for fees,
    // and set alphaUsd as the trader's fee token so they can pay gas.
    await fundAccount(quote, trader.address, parseUnits('100', 6))
    await fundAccount(addresses.alphaUsd, trader.address, parseUnits('100', 6))
    await Actions.fee.setUserToken(getClient({ account: trader }), {
      token: addresses.alphaUsd,
    })

    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: quote,
        pairToken: base,
        amount: '1',
        slippage: 0.05,
      }),
    }).then((res) => res.json())

    // Submit the calls as the trader.
    const traderClient = getClient({ account: trader })
    const hash = await sendTransactionSync(traderClient, {
      calls: response.calls,
    })
    expect(hash).toBeDefined()

    // Verify trader received base tokens.
    const baseBalance = await Actions.token.getBalance(getClient(), {
      account: trader.address,
      token: base,
    })
    expect(baseBalance).toBeGreaterThan(0n)
  })

  test('error: schema validation rejects malformed body', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Missing `type`.
      body: JSON.stringify({
        token: quote,
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Invalid request body",
    	  "issues": [
    	    {
    	      "message": "expected one of: "buy", "sell"",
    	      "path": "type",
    	    },
    	  ],
    	}
    `)
  })

  test('error: missing pair surfaces an ExecutionError-shaped 400', async () => {
    // A valid token address that isn't paired with `base`.
    const orphan = '0xdeadbeef00000000000000000000000000000000' as Address

    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: orphan,
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: string
      data?: { message?: string }
    }
    // Token addresses are nondeterministic — snapshot just error name + message.
    expect({ error: body.error, message: body.data?.message }).toMatchInlineSnapshot(`
    	{
    	  "error": "InvalidToken",
    	  "message": "This token is not supported on the exchange.",
    	}
    `)
  })

  test('error: schema rejects invalid `type` literal', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invalid',
        token: quote,
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Invalid request body",
    	  "issues": [
    	    {
    	      "message": "expected one of: "buy", "sell"",
    	      "path": "type",
    	    },
    	  ],
    	}
    `)
  })

  test('error: schema rejects non-string amount', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `amount` must be a decimal string, not a number.
      body: JSON.stringify({
        type: 'sell',
        token: quote,
        pairToken: base,
        amount: 1,
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Invalid request body",
    	  "issues": [
    	    {
    	      "message": "expected string",
    	      "path": "amount",
    	    },
    	  ],
    	}
    `)
  })

  test('error: schema rejects missing `token` field', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Invalid request body",
    	  "issues": [
    	    {
    	      "message": "expected string",
    	      "path": "token",
    	    },
    	  ],
    	}
    `)
  })

  test('error: invalid decimal amount surfaces parse error', async () => {
    // `parseUnits('not-a-number', ...)` throws — non-revert error path
    // (no `data` field, just a plain message).
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: quote,
        pairToken: base,
        amount: 'not-a-number',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; data?: unknown }
    expect(body.data).toBeUndefined()
    expect(body.error).toMatch(/decimal|number/i)
  })

  test('error: same token/pairToken reverts', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: base,
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: string
      data?: { message?: string }
    }
    expect({ error: body.error, message: body.data?.message }).toMatchInlineSnapshot(`
    	{
    	  "error": "IdenticalTokens",
    	  "message": "Cannot swap a token for itself — input and output tokens must be different.",
    	}
    `)
  })

  test('error: unsupported chainId is rejected', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        chainId: 999_999,
        token: quote,
        pairToken: base,
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Chain 999999 is not supported.",
    	}
    `)
  })

  test('error: insufficient liquidity surfaces revert', async () => {
    // Pair has ~1000 base of sell-side liquidity. Asking to buy 999_999
    // base far exceeds it.
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'buy',
        token: base,
        pairToken: quote,
        amount: '999999',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: string
      data?: { message?: string }
    }
    expect({ error: body.error, message: body.data?.message }).toMatchInlineSnapshot(`
    	{
    	  "error": "InsufficientLiquidity",
    	  "message": "Not enough liquidity in the order book to fill this trade.",
    	}
    `)
  })
})

describe('symbol resolution', () => {
  let server: Server
  let base: Address
  let quote: Address

  beforeAll(async () => {
    const pair = await setupPair()
    base = pair.base
    quote = pair.quote

    server = await createServer(
      exchange({
        chains: [chain],
        transports: { [chain.id]: http() },
        resolveTokens: () => [
          { address: quote, decimals: 6, name: 'Test Quote', symbol: 'TQUOTE' },
          { address: base, decimals: 6, name: 'Test Base', symbol: 'TBASE' },
        ],
      }).listener,
    )
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: resolves symbols via resolveTokens', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: 'TQUOTE',
        pairToken: 'TBASE',
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(200)

    const decoded = (await response.json()) as QuoteResponseWire
    const { calls, ...rest } = decoded
    expect({
      ...rest,
      pairToken: { ...rest.pairToken, address: '<pair-token>' as Address },
      token: { ...rest.token, address: '<token>' as Address },
    }).toMatchInlineSnapshot(`
    	{
    	  "pairToken": {
    	    "address": "<pair-token>",
    	    "amount": "0.98901",
    	    "name": "Test Base",
    	    "symbol": "TBASE",
    	  },
    	  "slippage": 0.01,
    	  "token": {
    	    "address": "<token>",
    	    "amount": "1",
    	    "name": "Test Quote",
    	    "symbol": "TQUOTE",
    	  },
    	  "type": "sell",
    	}
    `)

    // Resolved addresses match the freshly-created pair.
    expect(decoded.token.address.toLowerCase()).toBe(quote.toLowerCase())
    expect(decoded.pairToken.address.toLowerCase()).toBe(base.toLowerCase())
    expect(calls).toHaveLength(2)
  })

  test('error: unknown symbol surfaces a not-found error', async () => {
    const response = await fetch(`${server.url}/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sell',
        token: 'TQUOTE',
        pairToken: 'NOPE',
        amount: '1',
        slippage: 0.01,
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Token "NOPE" not found",
    	}
    `)
  })
})

describe('GET /exchange/tokens', () => {
  let server: Server
  let base: Address
  let quote: Address

  beforeAll(async () => {
    const pair = await setupPair()
    base = pair.base
    quote = pair.quote

    server = await createServer(
      exchange({
        chains: [chain],
        resolveTokens: () => [
          { address: quote, decimals: 6, name: 'Test Quote', symbol: 'TQUOTE' },
          { address: base, decimals: 6, name: 'Test Base', symbol: 'TBASE' },
        ],
        transports: { [chain.id]: http() },
      }).listener,
    )
  })

  afterAll(() => {
    server.close()
  })

  test('behavior: returns the resolved tokens for the default chain', async () => {
    const response = await fetch(`${server.url}/exchange/tokens`)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      tokens: { address: Address; decimals: number; name: string; symbol: string }[]
    }
    // Pair addresses change per run — assert symbols/names/decimals only.
    expect(body.tokens).toHaveLength(2)
    expect(body.tokens.map(({ address, ...rest }) => rest)).toMatchInlineSnapshot(`
    	[
    	  {
    	    "decimals": 6,
    	    "name": "Test Quote",
    	    "symbol": "TQUOTE",
    	  },
    	  {
    	    "decimals": 6,
    	    "name": "Test Base",
    	    "symbol": "TBASE",
    	  },
    	]
    `)
    expect(body.tokens[0]!.address.toLowerCase()).toBe(quote.toLowerCase())
    expect(body.tokens[1]!.address.toLowerCase()).toBe(base.toLowerCase())
  })

  test('behavior: `?chainId=` selects the configured chain', async () => {
    const response = await fetch(`${server.url}/exchange/tokens?chainId=${chain.id}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      tokens: readonly unknown[]
    }
    expect(body.tokens).toHaveLength(2)
  })

  test('error: unsupported chainId is rejected', async () => {
    const response = await fetch(`${server.url}/exchange/tokens?chainId=999999`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchInlineSnapshot(`
    	{
    	  "error": "Chain 999999 is not supported.",
    	}
    `)
  })
})
