import { Hex } from 'ox'
import {
  type Address,
  type Chain,
  type Client,
  createClient,
  formatUnits,
  http,
  parseUnits,
  type Transport,
} from 'viem'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'
import { Actions, Addresses } from 'viem/tempo'
import * as z from 'zod/mini'

import * as ExecutionError from '../../../core/ExecutionError.js'
import * as u from '../../../core/zod/utils.js'
import { type Handler, from } from '../../Handler.js'
import * as Kv from '../../Kv.js'
import * as Hono from '../hono.js'
import { cached } from '../kv.js'

/** Default cache TTL in seconds (10 minutes). */
const defaultCacheTtl = 10 * 60

/** Zod schemas for the exchange handler's request and response payloads. */
export namespace schema {
  const token = z.object({
    address: u.address(),
    decimals: z.number(),
    name: z.string(),
    symbol: z.string(),
  })

  /** Schemas for `POST /exchange/quote`. */
  export namespace quote {
    /** Request body schema. */
    export const parameters = z.object({
      amount: z.string(),
      chainId: z.optional(z.number()),
      input: z.string(),
      output: z.string(),
      slippage: z.number(),
      type: z.union([z.literal('buy'), z.literal('sell')]),
    })

    const side = z.object({
      amount: z.string(),
      name: z.string(),
      symbol: z.string(),
      token: u.address(),
    })

    /** Response body schema. */
    export const returns = z.object({
      calls: z.readonly(
        z.array(
          z.object({
            data: u.hex(),
            to: u.address(),
          }),
        ),
      ),
      input: side,
      output: side,
      slippage: z.number(),
      type: z.union([z.literal('buy'), z.literal('sell')]),
    })
  }

  /** Schemas for `GET /exchange/tokens`. */
  export namespace tokens {
    /** Query string schema. `chainId` is a decimal string when present. */
    export const parameters = z.object({
      chainId: z.optional(z.string()),
    })

    /** Response body schema. */
    export const returns = z.object({
      tokens: z.readonly(z.array(token)),
    })
  }
}

/**
 * Instantiates a stablecoin-exchange handler that returns swap quotes plus
 * the matching `calls` (approve + buy/sell) for the Tempo Stablecoin DEX.
 *
 * Exposes 2 endpoints:
 * - `GET /exchange/tokens` — list known tokens for a chain (defaults to the
 *   first configured chain; pass `?chainId=N` to pick a different one).
 * - `POST /exchange/quote` — return a quote and ready-to-submit calls.
 *
 * The returned value is a Hono app augmented with a Node `listener`. The full
 * route schema is preserved on the type so consumers can derive a typed RPC
 * client with `hc<ReturnType<typeof exchange>>(url)`.
 *
 * @example
 * ```ts
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.exchange()
 *
 * // Plug handler into your server framework of choice:
 * createServer(handler.listener)
 * ```
 *
 * @example
 * Typed RPC client
 *
 * ```ts
 * import { hc } from 'hono/client'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.exchange()
 * type Handler = typeof handler
 *
 * const client = hc<Handler>('https://example.com')
 * const res = await client.exchange.quote.$post({
 *   json: {
 *     amount: '1',
 *     input: 'USDC',
 *     output: 'USDT',
 *     slippage: 0.01,
 *     type: 'sell',
 *   },
 * })
 * if (res.ok) {
 *   const { calls, input, output } = await res.json()
 *   // fully typed
 * }
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function exchange<const path extends string = '/exchange'>(
  options: exchange.Options<path> = {},
) {
  const {
    cacheTtl = defaultCacheTtl,
    chains = [tempo, tempoModerato, tempoDevnet],
    kv = Kv.memory(),
    onRequest,
    path = '/exchange' as path,
    resolveTokens = defaultResolveTokens,
    transports = {},
    ...rest
  } = options

  const clients = new Map<number, Client>()
  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(
      chain.id,
      createClient({ batch: { multicall: { deployless: true } }, chain, transport }),
    )
  }

  const router = from(rest)

  const app = router
    .get(`${path}/tokens`, Hono.validate('query', schema.tokens.parameters), async (c) => {
      try {
        await onRequest?.(c.req.raw)
        const { chainId: chainIdStr } = c.req.valid('query')

        const chainId = chainIdStr ? Number(chainIdStr) : chains[0]!.id
        const chain = chains.find((c) => c.id === chainId)
        if (!chain) throw new Error(`Chain ${chainId} is not supported.`)

        const tokens = await cached(
          kv,
          `tokenlist:${chain.id}`,
          async () => resolveTokens(chain.id),
          { ttl: cacheTtl },
        )

        // Cache for `cacheTtl` and allow stale-while-revalidate for an
        // additional full TTL window so CDNs/browsers can serve immediately
        // while a fresh copy is fetched in the background.
        c.header(
          'Cache-Control',
          `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}, stale-while-revalidate=${cacheTtl}`,
        )

        return c.json(
          z.encode(schema.tokens.returns, { tokens }) as z.output<typeof schema.tokens.returns>,
        )
      } catch (error) {
        return c.json({ error: (error as Error).message }, 400)
      }
    })
    .post(`${path}/quote`, Hono.validate('json', schema.quote.parameters), async (c) => {
      try {
        await onRequest?.(c.req.raw)
        const { amount, chainId, input, output, slippage, type } = c.req.valid('json')

        const chain = chainId ? chains.find((c) => c.id === chainId) : chains[0]
        if (!chain) throw new Error(`Chain ${chainId} is not supported.`)
        const client = clients.get(chain.id)!

        // Resolve `input` and `output` to addresses + metadata in parallel.
        const tokens = await cached(
          kv,
          `tokenlist:${chain.id}`,
          async () => resolveTokens(chain.id),
          { ttl: cacheTtl },
        )
        const [inToken, outToken] = await Promise.all([
          resolveToken(client, { kv, ref: input, tokens }),
          resolveToken(client, { kv, ref: output, tokens }),
        ])

        // Parse `amount` using the decimals of whichever side is the "exact"
        // one for the requested `type`.
        const decimals = type === 'buy' ? outToken.decimals : inToken.decimals
        const amount_ = parseUnits(amount, decimals)

        const result =
          type === 'buy'
            ? await quoteBuy(client, {
                amount: amount_,
                input: inToken.address,
                output: outToken.address,
                slippage,
              })
            : await quoteSell(client, {
                amount: amount_,
                input: inToken.address,
                output: outToken.address,
                slippage,
              })

        return c.json(
          z.encode(schema.quote.returns, {
            calls: result.calls,
            input: {
              amount: formatUnits(result.inputAmount, inToken.decimals),
              name: inToken.name,
              symbol: inToken.symbol,
              token: inToken.address,
            },
            output: {
              amount: formatUnits(result.outputAmount, outToken.decimals),
              name: outToken.name,
              symbol: outToken.symbol,
              token: outToken.address,
            },
            slippage,
            type,
          }) as z.output<typeof schema.quote.returns>,
        )
      } catch (error) {
        const revert = ExecutionError.parse(error as Error)
        // Only surface decoded reverts (named ABI errors). Anything else
        // (network errors, unknown symbols) falls through to the plain
        // message path.
        if (revert && revert.errorName !== 'unknown')
          return c.json({ data: ExecutionError.serialize(revert), error: revert.errorName }, 400)
        return c.json({ error: (error as Error).message }, 400)
      }
    })

  return app as Handler<typeof app>
}

export declare namespace exchange {
  /** Options for `exchange()`. */
  export type Options<path extends string = string> = from.Options & {
    /**
     * TTL in seconds for cached tokenlist responses. On-chain token metadata
     * is cached without expiry (immutable per address).
     * @default 600 (10 minutes)
     */
    cacheTtl?: number | undefined
    /**
     * Supported chains. The first chain is used to resolve the client.
     * @default [tempo, tempoModerato, tempoDevnet]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /**
     * Kv store used to cache network responses. Provide `Kv.cloudflare(env.KV)`
     * for cross-instance caching, or omit for an in-process LRU.
     * @default Kv.memory()
     */
    kv?: Kv.Kv | undefined
    /** Function to call before handling the request. */
    onRequest?: ((request: Request) => void | Promise<void>) | undefined
    /** Path prefix for the exchange endpoints. @default '/exchange' */
    path?: path | undefined
    /**
     * Resolves the list of known tokens for a chain. Used to resolve symbol
     * references (e.g. `"USDC.e"`) to addresses + metadata. Address references
     * are matched against this list first, falling back to on-chain metadata.
     * @default Fetches `https://tokenlist.tempo.xyz/list/:chainId`
     */
    resolveTokens?: ((chainId: number) => readonly Token[] | Promise<readonly Token[]>) | undefined
    /** Transports keyed by chain ID. Defaults to `http()` per chain. */
    transports?: Record<number, Transport> | undefined
  }

  /** Resolved token metadata. */
  export type Token = {
    /** Token address. */
    address: Address
    /** Token decimals. */
    decimals: number
    /** Token name. */
    name: string
    /** Token symbol. */
    symbol: string
  }
}

type Token = exchange.Token

/**
 * Resolves a token reference to an address + metadata.
 *
 * If `ref` looks like a hex address (`0x...`), it is matched against `tokens`
 * by address; on miss, metadata is fetched on-chain and cached forever.
 * Otherwise it's treated as a symbol and matched against `tokens` by symbol.
 */
async function resolveToken(client: Client, options: resolveToken.Parameters): Promise<Token> {
  const { kv, ref, tokens } = options
  const chainId = client.chain!.id

  if (isAddress(ref)) {
    const refLower = ref.toLowerCase()
    const found = tokens.find((t) => t.address.toLowerCase() === refLower)
    if (found) return found

    return await cached(kv, `metadata:${chainId}:${refLower}`, async () => {
      const meta = await Actions.token.getMetadata(client, { token: ref }).catch(() => undefined)
      return {
        address: ref,
        decimals: meta?.decimals ?? 6,
        name: meta?.name ?? '',
        symbol: meta?.symbol ?? '',
      }
    })
  }

  const found = tokens.find((t) => t.symbol === ref)
  if (!found) throw new Error(`Token "${ref}" not found`)
  return found
}

declare namespace resolveToken {
  /** Parameters for `resolveToken()`. */
  type Parameters = {
    /** Kv used to cache on-chain metadata fetches. */
    kv: Kv.Kv
    /** Token reference: a hex address (`0x...`) or symbol. */
    ref: string
    /** Known tokens for the chain (used for fast symbol/address lookup). */
    tokens: readonly Token[]
  }
}

function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

/** Result of a quote helper, before encoding for the response. */
type QuoteResult = {
  calls: readonly { data: Hex.Hex; to: Address }[]
  inputAmount: bigint
  outputAmount: bigint
}

async function quoteBuy(client: Client, options: quoteBuy.Parameters): Promise<QuoteResult> {
  const { amount, input, output, slippage } = options
  // exact-out: amount = exact `output` to receive.
  const quoteIn = await Actions.dex.getBuyQuote(client, {
    amountOut: amount,
    tokenIn: input,
    tokenOut: output,
  })
  const maxAmountIn = applySlippage(quoteIn, slippage, 'up')

  const approve = Actions.token.approve.call({
    amount: maxAmountIn,
    spender: Addresses.stablecoinDex,
    token: input,
  })
  const buy = Actions.dex.buy.call({
    amountOut: amount,
    maxAmountIn,
    tokenIn: input,
    tokenOut: output,
  })

  return {
    calls: [toCall(approve), toCall(buy)],
    inputAmount: maxAmountIn,
    outputAmount: amount,
  }
}

declare namespace quoteBuy {
  /** Parameters for `quoteBuy()`. */
  type Parameters = {
    /** Exact `output` amount to receive. */
    amount: bigint
    /** Token spent. */
    input: Address
    /** Token received. */
    output: Address
    /** Slippage tolerance (e.g. `0.05` = 5%). */
    slippage: number
  }
}

async function quoteSell(client: Client, options: quoteSell.Parameters): Promise<QuoteResult> {
  const { amount, input, output, slippage } = options
  // exact-in: amount = exact `input` to spend.
  const quoteOut = await Actions.dex.getSellQuote(client, {
    amountIn: amount,
    tokenIn: input,
    tokenOut: output,
  })
  const minAmountOut = applySlippage(quoteOut, slippage, 'down')

  const approve = Actions.token.approve.call({
    amount,
    spender: Addresses.stablecoinDex,
    token: input,
  })
  const sell = Actions.dex.sell.call({
    amountIn: amount,
    minAmountOut,
    tokenIn: input,
    tokenOut: output,
  })

  return {
    calls: [toCall(approve), toCall(sell)],
    inputAmount: amount,
    outputAmount: minAmountOut,
  }
}

declare namespace quoteSell {
  /** Parameters for `quoteSell()`. */
  type Parameters = {
    /** Exact `input` amount to spend. */
    amount: bigint
    /** Token spent. */
    input: Address
    /** Token received. */
    output: Address
    /** Slippage tolerance (e.g. `0.05` = 5%). */
    slippage: number
  }
}

function applySlippage(amount: bigint, slippage: number, dir: 'up' | 'down') {
  const bps = BigInt(Math.round(slippage * 10_000))
  if (dir === 'up') return amount + (amount * bps) / 10_000n
  return amount - (amount * bps) / 10_000n
}

function toCall(call: { data: Hex.Hex; to: Address }) {
  return { data: call.data, to: call.to }
}

/**
 * Default `resolveTokens` implementation. Fetches the verified token list for
 * `chainId` from `https://tokenlist.tempo.xyz/list/:chainId`. Returns an empty
 * list on any non-OK response.
 */
async function defaultResolveTokens(chainId: number): Promise<readonly Token[]> {
  const response = await fetch(`https://tokenlist.tempo.xyz/list/${chainId}`)
  if (!response.ok) return []
  const data = (await response.json()) as { tokens: readonly Token[] }
  return data.tokens
}
