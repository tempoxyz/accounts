import { AbiEvent, Hex, RpcRequest, RpcResponse } from 'ox'
import { Transaction as core_Transaction } from 'ox/tempo'
import {
  type Address,
  type Call,
  type Chain,
  type Client,
  createClient,
  decodeErrorResult,
  formatUnits,
  http,
  type Log,
  parseAbi,
  parseEventLogs,
  type Transport,
} from 'viem'
import { simulateCalls } from 'viem/actions'
import { tempo, tempoLocalnet, tempoMainnet, tempoModerato } from 'viem/chains'
import { Abis, Actions, Addresses, Capabilities, Transaction } from 'viem/tempo'
import type { LocalAccount } from 'viem/accounts'

import * as Schema from '../../../core/Schema.js'
import { type Handler, from } from '../../Handler.js'
import * as Sponsorship from './sponsorship.js'
import * as Utils from './utils.js'

/**
 * Instantiates a relay handler that proxies `eth_fillTransaction`
 * with wallet-aware enrichment (fee token resolution, simulation,
 * sponsorship, AMM resolution).
 *
 * @example
 * ```ts
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.relay()
 *
 * // Plug handler into your server framework of choice:
 * createServer(handler.listener)              // Node.js
 * Bun.serve(handler)                          // Bun
 * Deno.serve(handler)                         // Deno
 * app.use(handler.listener)                   // Express
 * app.all('*', c => handler.fetch(c.req.raw)) // Hono
 * export const GET = handler.fetch            // Next.js
 * export const POST = handler.fetch           // Next.js
 * ```
 *
 * @example
 * With sponsorship
 *
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * // With sponsorship — signs as fee payer when `validate` approves.
 * const handler = Handler.relay({
 *   feePayer: {
 *     account: privateKeyToAccount('0x...'),
 *     // Optional: validate sponsorship approval.
 *     // validate: (request) => request.from !== BLOCKED_ADDRESS,
 *   },
 * })
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function relay(options: relay.Options = {}): Handler {
  const {
    chains = [tempo, tempoModerato],
    onRequest,
    path = '/',
    resolveTokens = (chainId) =>
      relay.defaultTokens[chainId as keyof typeof relay.defaultTokens] ?? [],
    transports = {},
    ...rest
  } = options
  const feePayerOptions = options.feePayer

  const autoSwap = (() => {
    if (options.autoSwap === false) return undefined
    return { slippage: options.autoSwap?.slippage ?? 0.05 }
  })()

  const clients = new Map<number, Client>()
  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(
      chain.id,
      createClient({ chain, batch: { multicall: { deployless: true } }, transport }),
    )
  }

  function getClient(chainId?: number): Client {
    if (chainId) {
      const client = clients.get(chainId)
      if (!client) throw new Error(`Chain ${chainId} not configured`)
      return client
    }
    return clients.get(chains[0]!.id)!
  }

  async function handleRequest(request: RpcRequest.RpcRequest<Schema.Ox>) {
    await onRequest?.(request)

    // Resolve chainId + client from the first param object (if present).
    const params = 'params' in request && Array.isArray(request.params) ? request.params : []
    const first =
      typeof params[0] === 'object' && params[0]
        ? (params[0] as Record<string, unknown>)
        : undefined
    const chainId = Utils.resolveChainId(first?.chainId) ?? chains[0]!.id
    const client = getClient(chainId)

    switch (request.method as string) {
      case 'eth_fillTransaction': {
        try {
          const parameters = params[0] as Record<string, unknown>
          const from = typeof parameters.from === 'string' ? (parameters.from as Address) : undefined
          const requestFeeToken =
            typeof parameters.feeToken === 'string' ? (parameters.feeToken as Address) : undefined
          const requestsSponsorship = !!feePayerOptions && (parameters.feePayer !== false)

          // 1. Resolve fee token.
          const feeToken = await resolveFeeToken(client, {
            account: from,
            feeToken: requestFeeToken,
            tokens: resolveTokens(chainId),
          })

          // 2. Fill transaction via RPC node (with AMM resolution on InsufficientBalance).
          const normalized = Utils.normalizeFillTransactionRequest(parameters)
          const transaction = {
            ...normalized,
            ...(typeof chainId !== 'undefined' ? { chainId } : {}),
            ...(requestsSponsorship ? { feePayer: true } : {}),
            ...(feeToken ? { feeToken } : {}),
          }
          let filled = await (async () => {
            if (requestsSponsorship && Sponsorship.isPreparedTransaction(transaction))
              return { transaction: Utils.normalizeTempoTransaction(transaction) }
            return await fill(client, { autoSwap, feeToken, transaction })
          })()

          // 3. Check if the fee payer approves this transaction.
          const sponsored = requestsSponsorship && feePayerOptions
            ? await Sponsorship.shouldSponsor({
                sender: from,
                transaction: filled.transaction,
                validate: feePayerOptions.validate,
              })
            : false

          // Re-fill without feePayer when sponsorship is rejected so the
          // gas estimate and nonce are correct for a self-paid transaction.
          if (requestsSponsorship && !sponsored) {
            const { feePayer: _, ...tx } = transaction
            filled = await fill(client, { autoSwap, feeToken, transaction: tx })
          }

          const transaction_filled = filled.transaction
          const swap = 'swap' in filled ? filled.swap : undefined

          // 4. Simulate and compute balance diffs + fee.
          const calls = extractCalls(transaction_filled)
          const { balanceDiffs, fee } = await simulateAndParseDiffs(client, {
            account: from,
            calls,
            swap,
            feeToken: transaction_filled.feeToken,
            gas: transaction_filled.gas,
            maxFeePerGas: transaction_filled.maxFeePerGas,
          })

          // 5. Sign as fee payer (if sponsored).
          const transaction_final = await (async () => {
            if (!sponsored || !feePayerOptions) return transaction_filled
            return await Sponsorship.sign({
              account: feePayerOptions.account,
              sender: from,
              transaction: transaction_filled,
            })
          })()

          const sponsor = sponsored && feePayerOptions
            ? Sponsorship.getSponsor(feePayerOptions)
            : undefined

          // 6. Resolve autoSwap metadata (when AMM path was taken).
          const autoSwap_ = await (async () => {
            if (!swap) return undefined
            const [inMeta, outMeta] = await Promise.all([
              resolveTokenMetadata(client, swap.tokenIn).catch(() => undefined),
              resolveTokenMetadata(client, swap.tokenOut).catch(() => undefined),
            ])
            if (!inMeta || !outMeta) return undefined
            return {
              calls: swap.calls.map((c) => ({ to: c.to, data: c.data })),
              slippage: autoSwap!.slippage,
              maxIn: {
                token: swap.tokenIn,
                value: Hex.fromNumber(swap.maxAmountIn) as `0x${string}`,
                formatted: formatUnits(swap.maxAmountIn, inMeta.decimals),
                decimals: inMeta.decimals,
                symbol: inMeta.symbol,
                name: inMeta.name,
              },
              minOut: {
                token: swap.tokenOut,
                value: Hex.fromNumber(swap.amountOut) as `0x${string}`,
                formatted: formatUnits(swap.amountOut, outMeta.decimals),
                decimals: outMeta.decimals,
                symbol: outMeta.symbol,
                name: outMeta.name,
              },
            }
          })()

          return RpcResponse.from(
            {
              result: {
                ...(sponsor ? { sponsor } : {}),
                tx: core_Transaction.toRpc(transaction_final as core_Transaction.Transaction),
                capabilities: {
                  balanceDiffs,
                  fee,
                  sponsored: !!sponsor,
                  ...(sponsor ? { sponsor } : {}),
                  ...(autoSwap_ ? { autoSwap: autoSwap_ } : {}),
                },
              },
            },
            { request },
          )
        } catch (error) {
          return Utils.rpcErrorJson(request, error)
        }
      }

      case 'eth_signRawTransaction':
      case 'eth_sendRawTransaction':
      case 'eth_sendRawTransactionSync': {
        try {
          if (!feePayerOptions) {
            const result = await client.request(request as never)
            return RpcResponse.from({ result }, { request })
          }

          const serialized = params[0]
          if (
            typeof serialized !== 'string' ||
            !Sponsorship.requestsRawSponsorship(serialized as `0x${string}`)
          ) {
            const result = await client.request(request as never)
            return RpcResponse.from({ result }, { request })
          }

          const result = await Sponsorship.handleRawTransaction({
            account: feePayerOptions.account,
            getClient,
            method: request.method as Sponsorship.handleRawTransaction.Options['method'],
            request: { params: 'params' in request ? request.params : undefined },
            validate: feePayerOptions.validate,
          })
          return RpcResponse.from({ result } as never, { request } as never)
        } catch (error) {
          return Utils.rpcErrorJson(request, error)
        }
      }

      default: {
        const result = await client.request(request as never)
        return RpcResponse.from({ result }, { request })
      }
    }
  }

  const router = from(rest)

  router.post(path, async (c) => {
    const body = await c.req.raw.json()
    const isBatch = Array.isArray(body)

    if (!isBatch) {
      const request = RpcRequest.from(body) as RpcRequest.RpcRequest<Schema.Ox>
      return Response.json(await handleRequest(request))
    }

    const responses = await Promise.all(
      (body as unknown[]).map((item) =>
        handleRequest(RpcRequest.from(item as never) as RpcRequest.RpcRequest<Schema.Ox>),
      ),
    )
    return Response.json(responses)
  })

  return router
}

export namespace relay {
  /** Default token lists per chain ID for fee token resolution. */
  // TODO: extract from tokenlist workspace.
  export const defaultTokens = {
    [tempoMainnet.id]: [
      '0x20c0000000000000000000000000000000000000', // pathUSD
      '0x20c000000000000000000000b9537d11c60e8b50', // USDC.e
      '0x20c0000000000000000000001621e21f71cf12fb', // EURC.e
      '0x20c00000000000000000000014f22ca97301eb73', // USDT0
      '0x20c0000000000000000000003554d28269e0f3c2', // frxUSD
      '0x20c0000000000000000000000520792dcccccccc', // cUSD
      '0x20c0000000000000000000008ee4fcff88888888', // stcUSD
      '0x20c0000000000000000000005c0bac7cef389a11', // GUSD
      '0x20c0000000000000000000007f7ba549dd0251b9', // rUSD
      '0x20c000000000000000000000aeed2ec36a54d0e5', // wsrUSD
      '0x20c0000000000000000000009a4a4b17e0dc6651', // EURAU
      '0x20c000000000000000000000383a23bacb546ab9', // reUSD
    ],
    [tempoModerato.id]: [
      '0x20c0000000000000000000000000000000000000', // pathUSD
      '0x20c0000000000000000000000000000000000001', // alphaUSD
      '0x20c0000000000000000000000000000000000002', // betaUSD
      '0x20c0000000000000000000000000000000000003', // thetaUSD
      '0x20c0000000000000000000009e8d7eb59b783726', // USDC.e
      '0x20c000000000000000000000d72572838bbee59c', // EURC.e
    ],
    [tempoLocalnet.id]: [
      '0x20c0000000000000000000000000000000000000', // pathUSD
      '0x20c0000000000000000000000000000000000001', // alphaUSD
      '0x20c0000000000000000000000000000000000002', // betaUSD
      '0x20c0000000000000000000000000000000000003', // thetaUSD
    ],
  } as const

  export type Options = from.Options & {
    /**
     * Supported chains. The handler resolves the client based on the
     * `chainId` in the incoming transaction.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /**
     * Fee payer / sponsor configuration. When provided, the relay will
     * sign `feePayerSignature` on the filled transaction.
     */
    feePayer?:
      | {
          /** Account to use as the fee payer. */
          account: LocalAccount
          /**
           * Validates whether to sponsor the transaction. When omitted, all
           * transactions are sponsored. Return `false` to reject sponsorship.
           */
          validate?: ((request: Transaction.TransactionRequest) => boolean | Promise<boolean>) | undefined
          /** Sponsor display name returned from `eth_fillTransaction`. */
          name?: string | undefined
          /** Sponsor URL returned from `eth_fillTransaction`. */
          url?: string | undefined
        }
      | undefined
    /**
     * AMM swap options for automatic insufficient balance resolution.
     * Set to `false` to disable. @default {}
     */
    autoSwap?:
      | false
      | {
          /** Slippage tolerance (e.g. 0.05 = 5%). @default 0.05 */
          slippage?: number | undefined
        }
      | undefined
    /**
     * Returns token addresses to check balances for during fee token resolution.
     * The relay checks `balanceOf` for each token and picks the one with the
     * highest balance.
     */
    resolveTokens?: ((chainId?: number | undefined) => readonly Address[]) | undefined
    /** Function to call before handling the request. */
    onRequest?: ((request: RpcRequest.RpcRequest) => Promise<void>) | undefined
    /** Path to use for the handler. @default "/" */
    path?: string | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
  }
}

// TODO: cleanup
async function fill(
  client: Client,
  options: {
    autoSwap?: { slippage: number } | undefined
    feeToken?: Address | undefined
    transaction: Record<string, unknown>
  },
) {
  const { autoSwap, feeToken, transaction: request } = options

  // Skip re-formatting if already in RPC format (e.g. from viem's fillTransaction).
  const format = (value: Record<string, unknown>) =>
    value.type === '0x76' ? value : Utils.formatFillTransactionRequest(client, value)

  try {
    const result = await client.request({
      method: 'eth_fillTransaction',
      params: [format(request) as never],
    })
    return { transaction: Utils.normalizeTempoTransaction(result.tx) }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const parsed = parseInsufficientBalance(error)
    if (!parsed || !feeToken || !autoSwap) throw error
    if (parsed.token.toLowerCase() === feeToken.toLowerCase()) throw error

    const deficit = parsed.required - parsed.available
    const maxAmountIn = deficit + (deficit * BigInt(Math.round(autoSwap.slippage * 1000))) / 1000n
    const swapCalls = buildSwapCalls(feeToken, parsed.token, deficit, maxAmountIn)
    const existingCalls = request.calls as Call[] | undefined
    // If the request was normalized to top-level to/data/value (single call),
    // convert back to a calls array so we can prepend swap calls.
    const originalCalls: Call[] = existingCalls
      ? [...existingCalls]
      : request.to
        ? [
            {
              to: request.to as Address,
              data: request.data as `0x${string}`,
              value: (request.value as bigint) ?? 0n,
            },
          ]
        : []
    const { to: _, data: __, value: ___, calls: ____, ...rest } = request
    const result = await client.request({
      method: 'eth_fillTransaction',
      params: [
        format({
          ...rest,
          calls: [...swapCalls, ...originalCalls],
        }) as never,
      ],
    })
    return {
      transaction: Utils.normalizeTempoTransaction(result.tx),
      swap: {
        calls: swapCalls,
        tokenIn: feeToken,
        tokenOut: parsed.token,
        amountOut: deficit,
        maxAmountIn,
      },
    }
  }
}

async function resolveFeeToken(
  client: Client,
  options: {
    feeToken?: Address | undefined
    account?: Address | undefined
    tokens?: readonly Address[] | undefined
  },
): Promise<Address | undefined> {
  const { feeToken, account, tokens } = options
  if (feeToken) return feeToken
  if (!account) return undefined

  const [userToken, balances] = await Promise.all([
    Actions.fee.getUserToken(client, { account }).catch(() => null),
    tokens
      ? Promise.all(
          tokens.map(async (token) => ({
            address: token,
            balance: await Actions.token.getBalance(client, { account, token }).catch(() => 0n),
          })),
        )
      : [],
  ])

  // If on-chain preference is set and user has balance, use it.
  if (userToken) {
    const match = balances.find(
      (b) => b.address.toLowerCase() === userToken.address.toLowerCase() && b.balance > 0n,
    )
    if (match) return userToken.address

    // Token list may not include the preference — check on-chain directly.
    if (!match) {
      try {
        const balance = await Actions.token.getBalance(client, {
          account,
          token: userToken.address,
        })
        if (balance > 0n) return userToken.address
      } catch {}
    }
  }

  // Pick the token with the highest balance.
  let best: { address: Address; balance: bigint } | undefined
  for (const asset of balances) {
    if (asset.balance <= 0n) continue
    if (!best || asset.balance > best.balance) best = asset
  }
  if (best) return best.address
}

// TODO: cleanup/remove
function extractCalls(transaction: Record<string, unknown>): readonly Call[] {
  const calls = transaction.calls as readonly Call[] | undefined
  if (calls && calls.length > 0)
    return calls.map((c) => ({
      ...(c.to ? { to: c.to } : {}),
      ...(c.data ? { data: c.data } : {}),
      ...(c.value ? { value: c.value } : {}),
    })) as readonly Call[]
  return [
    {
      ...(transaction.to ? { to: transaction.to as Address } : {}),
      ...(transaction.data ? { data: transaction.data as `0x${string}` } : {}),
      ...(transaction.value ? { value: transaction.value as bigint } : {}),
    },
  ] as readonly Call[]
}

// TODO: cleanup/remove
async function simulate(
  client: Client,
  options: {
    account?: Address | undefined
    calls: readonly Call[]
  },
) {
  const { account, calls } = options
  try {
    return await Actions.simulate.simulateCalls(client, {
      ...(account ? { account } : {}),
      calls: calls as Call[],
      traceTransfers: true,
    })
  } catch (error) {
    // TODO: Remove fallback once all nodes support tempo_simulateV1.
    // Fall back to viem's simulateCalls (eth_simulateV1) if the Tempo
    // method (tempo_simulateV1) is not supported.
    const code =
      (error as { code?: number | undefined }).code ??
      (error as { cause?: { code?: number | undefined } | undefined }).cause?.code
    if (code !== -32601) throw error
    const { results } = await simulateCalls(client, {
      ...(account ? { account } : {}),
      calls: calls as Call[],
    })
    return { results, tokenMetadata: undefined }
  }
}

async function simulateAndParseDiffs(
  client: Client,
  options: {
    account?: Address | undefined
    calls: readonly Call[]
    swap?: { tokenIn: Address; tokenOut: Address } | undefined
    feeToken?: Address | undefined
    gas?: bigint | undefined
    maxFeePerGas?: bigint | undefined
  },
) {
  const { account, calls, swap, feeToken, gas, maxFeePerGas } = options

  try {
    const { results, tokenMetadata } = await simulate(client, { account, calls })

    // Collect all logs across all call results.
    const logs: (typeof results)[number]['logs'] = []
    for (const result of results as { logs?: (typeof logs)[number][] | undefined }[])
      if (result.logs) logs.push(...result.logs)

    // Build per-token balance diffs relative to the sender.
    const balanceDiffs = account
      ? await buildBalanceDiffs(client, {
          account,
          logs,
          swap,
          tokenMetadata: tokenMetadata as never,
        })
      : {}

    // Compute fee breakdown.
    const fee = await computeFee(client, {
      feeToken,
      gas,
      maxFeePerGas,
      tokenMetadata: tokenMetadata as never,
    })

    return { balanceDiffs, fee }
  } catch {
    // Simulation failures should not block the fill response —
    // return empty diffs with fee computed from transaction fields.
    const fee = await computeFee(client, { feeToken, gas, maxFeePerGas })
    return { balanceDiffs: undefined, fee }
  }
}

async function buildBalanceDiffs(
  client: Client,
  options: {
    account: Address
    logs: Log[]
    swap?: { tokenIn: Address; tokenOut: Address } | undefined
    tokenMetadata: Record<Address, { name: string; symbol: string; currency: string }>
  },
) {
  const { account, logs, swap, tokenMetadata } = options
  const accountLower = account.toLowerCase()
  const dexLower = Addresses.stablecoinDex.toLowerCase()
  const swapTokenIn = swap?.tokenIn.toLowerCase()
  const swapTokenOut = swap?.tokenOut.toLowerCase()

  const transferLogs = parseEventLogs({
    abi: [AbiEvent.fromAbi(Abis.tip20, 'Transfer')],
    eventName: 'Transfer',
    logs,
  })
  const approvalLogs = parseEventLogs({
    abi: [AbiEvent.fromAbi(Abis.tip20, 'Approval')],
    eventName: 'Approval',
    logs,
  })

  // Track net movement per token: incoming vs outgoing.
  const tokenMap = new Map<
    string,
    { incoming: bigint; outgoing: bigint; recipients: Set<Address>; token: Address }
  >()

  // Track total transferred per (token, spender) so we can suppress covered approvals.
  const transferredBySpender = new Map<string, bigint>()

  for (const log of transferLogs) {
    const token = log.address.toLowerCase()
    const fromLower = log.args.from.toLowerCase()
    const toLower = log.args.to.toLowerCase()

    // Skip swap-related transfers (reported in capabilities.autoSwap instead).
    if (swap) {
      if (token === swapTokenIn && fromLower === accountLower && toLower === dexLower) continue
      if (token === swapTokenOut && fromLower === dexLower && toLower === accountLower) continue
    }

    const entry = tokenMap.get(token) ?? {
      incoming: 0n,
      outgoing: 0n,
      recipients: new Set<Address>(),
      token: log.address,
    }
    if (fromLower === accountLower) {
      entry.outgoing += log.args.amount
      entry.recipients.add(log.args.to)
      const key = `${token}:${toLower}`
      transferredBySpender.set(key, (transferredBySpender.get(key) ?? 0n) + log.args.amount)
    }
    if (toLower === accountLower) entry.incoming += log.args.amount
    tokenMap.set(token, entry)
  }

  // Treat approvals as outgoing unless the spender already transferred >= approval amount.
  for (const log of approvalLogs) {
    if (log.args.owner.toLowerCase() !== accountLower) continue
    const token = log.address.toLowerCase()

    // Skip swap-related approvals (reported in capabilities.autoSwap instead).
    if (swap && token === swapTokenIn && log.args.spender.toLowerCase() === dexLower) continue

    const spenderKey = `${token}:${log.args.spender.toLowerCase()}`
    const transferred = transferredBySpender.get(spenderKey) ?? 0n
    if (log.args.amount <= transferred) continue

    const entry = tokenMap.get(token) ?? {
      incoming: 0n,
      outgoing: 0n,
      recipients: new Set<Address>(),
      token: log.address,
    }
    entry.outgoing += log.args.amount - transferred
    entry.recipients.add(log.args.spender)
    tokenMap.set(token, entry)
  }

  // Collect unique tokens that need decimals.
  const entries = [...tokenMap.values()].filter((e) => {
    const net = e.outgoing > e.incoming ? e.outgoing - e.incoming : e.incoming - e.outgoing
    return net > 0n
  })
  if (entries.length === 0) return {}

  // Resolve metadata for all tokens in parallel (simulation metadata first, RPC fallback).
  const metadataMap = new Map<string, { decimals: number; symbol: string; name: string }>()
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const metadata = await resolveTokenMetadata(client, entry.token, tokenMetadata)
        metadataMap.set(entry.token.toLowerCase(), metadata)
      } catch {}
    }),
  )

  // Build the diff array for this account.
  const diffs: Capabilities.BalanceDiff[] = []
  for (const entry of entries) {
    const net =
      entry.outgoing > entry.incoming
        ? entry.outgoing - entry.incoming
        : entry.incoming - entry.outgoing

    const direction = entry.outgoing > entry.incoming ? 'outgoing' : 'incoming'
    const meta = metadataMap.get(entry.token.toLowerCase())
    const decimals = meta?.decimals ?? 0
    diffs.push({
      address: entry.token,
      decimals,
      direction,
      formatted: formatUnits(net, decimals),
      name: meta?.name ?? '',
      symbol: meta?.symbol ?? '',
      recipients: [...entry.recipients] as Address[],
      value: Hex.fromNumber(net) as `0x${string}`,
    })
  }

  return { [account]: diffs }
}

async function resolveTokenMetadata(
  client: Client,
  token: Address,
  tokenMetadata?: Record<Address, { name: string; symbol: string; currency: string }> | undefined,
) {
  const meta = tokenMetadata?.[token] ?? tokenMetadata?.[token.toLowerCase() as Address]
  const fallback = await Actions.token.getMetadata(client, { token })
  return {
    decimals: fallback.decimals ?? 6,
    symbol: meta?.symbol || fallback.symbol,
    name: meta?.name || fallback.name,
  }
}

async function computeFee(
  client: Client,
  options: {
    feeToken?: Address | undefined
    gas?: bigint | undefined
    maxFeePerGas?: bigint | undefined
    tokenMetadata?: Record<Address, { name: string; symbol: string; currency: string }> | undefined
  },
) {
  const { feeToken, gas, maxFeePerGas, tokenMetadata } = options
  if (!feeToken || !gas || !maxFeePerGas) return null

  try {
    const metadata = await resolveTokenMetadata(client, feeToken, tokenMetadata)
    const raw = gas * maxFeePerGas
    const amount = raw / 10n ** BigInt(18 - metadata.decimals)
    return {
      amount: Hex.fromNumber(amount) as `0x${string}`,
      decimals: metadata.decimals,
      formatted: formatUnits(amount, metadata.decimals),
      symbol: metadata.symbol,
    }
  } catch {
    return null
  }
}

const insufficientBalanceAbi = parseAbi([
  'error InsufficientBalance(uint256 available, uint256 required, address token)',
])
const insufficientBalancePattern =
  /InsufficientBalance\(\s*InsufficientBalance\s*\{\s*available:\s*(\d+),\s*required:\s*(\d+),\s*token:\s*(0x[0-9a-fA-F]+)\s*\}\s*\)/

function parseInsufficientBalance(error: Error) {
  const message = (error as { shortMessage?: string }).shortMessage ?? error.message

  const match = insufficientBalancePattern.exec(message)
  if (match)
    return {
      available: BigInt(match[1]!),
      required: BigInt(match[2]!),
      token: match[3]! as Address,
    }

  const data = extractRevertData(error)
  if (!data) return null
  try {
    const decoded = decodeErrorResult({ abi: insufficientBalanceAbi, data })
    return {
      available: decoded.args[0],
      required: decoded.args[1],
      token: decoded.args[2] as Address,
    }
  } catch {
    return null
  }
}

function extractRevertData(error: unknown): `0x${string}` | null {
  if (!error || typeof error !== 'object') return null
  const e = error as Record<string, unknown>
  if (typeof e.data === 'string' && e.data.startsWith('0x')) return e.data as `0x${string}`
  if (e.cause) return extractRevertData(e.cause)
  if (e.error) return extractRevertData(e.error)
  if (typeof e.walk === 'function') {
    const inner = (e as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
      (e) => typeof (e as Record<string, unknown>).data === 'string',
    )
    if (inner) return extractRevertData(inner)
  }
  return null
}

function buildSwapCalls(
  sourceToken: Address,
  targetToken: Address,
  deficit: bigint,
  maxAmountIn: bigint,
) {
  const approve = Actions.token.approve.call({
    token: sourceToken,
    spender: Addresses.stablecoinDex,
    amount: maxAmountIn,
  })
  const buy = Actions.dex.buy.call({
    tokenIn: sourceToken,
    tokenOut: targetToken,
    amountOut: deficit,
    maxAmountIn,
  })
  return [
    { to: approve.to, data: approve.data, value: 0n },
    { to: buy.to, data: buy.data, value: 0n },
  ] as const
}
