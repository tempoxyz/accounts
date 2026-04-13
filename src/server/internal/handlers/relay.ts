import { AbiEvent, Hex, RpcRequest } from 'ox'
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
import { tempo, tempoLocalnet, tempoMainnet, tempoModerato } from 'viem/chains'
import { Abis, Actions, Addresses, Transaction } from 'viem/tempo'

import { type Handler, from } from '../../Handler.js'
import * as FeePayer from './feePayer.js'
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
    feePayer: feePayerOptions,
    onRequest,
    path = '/',
    resolveTokens = (chainId) =>
      relay.defaultTokens[chainId as keyof typeof relay.defaultTokens] ?? [],
    transports = {},
    ...rest
  } = options

  const clients = new Map<number, Client>()
  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(chain.id, createClient({ chain, transport }))
  }

  function getClient(chainId?: number): Client {
    if (chainId) {
      const client = clients.get(chainId)
      if (!client) throw new Error(`Chain ${chainId} not configured`)
      return client
    }
    return clients.get(chains[0]!.id)!
  }

  const router = from(rest)

  router.post(path, async (c) => {
    const request = RpcRequest.from((await c.req.raw.json()) as never)

    try {
      await onRequest?.(request)

      const method = request.method as string

      // Resolve chainId + client from the first param object (if present).
      const params = Array.isArray(request.params) ? request.params : []
      const firstParam =
        typeof params[0] === 'object' && params[0]
          ? (params[0] as Record<string, unknown>)
          : undefined
      const chainId = Utils.resolveChainId(firstParam?.chainId) ?? chains[0]!.id
      const client = getClient(chainId)

      // Proxy non-fill methods directly to the RPC node.
      if (method !== 'eth_fillTransaction') {
        const result = await client.request({
          method: method as never,
          params: params as never,
        })
        return Utils.rpcResult(request, result)
      }

      const [parameters] = Utils.parseParams.parse(request.params) as [Record<string, unknown>]
      const sender = typeof parameters.from === 'string' ? (parameters.from as Address) : undefined

      // 1. Resolve fee token.
      const feeToken = await resolveFeeToken(client, {
        feeToken: parameters.feeToken as Address | undefined,
        account: sender,
        tokens: resolveTokens(chainId),
      })

      // 2. Fill transaction via RPC node (with AMM resolution on InsufficientBalance).
      const normalized = Utils.normalizeFillTransactionRequest(parameters)
      const withOverrides = {
        ...normalized,
        ...(typeof chainId !== 'undefined' ? { chainId } : {}),
        ...(feePayerOptions ? { feePayer: true } : {}),
        ...(feeToken ? { feeToken } : {}),
      }
      // Skip re-formatting if already in RPC format (e.g. from viem's fillTransaction).
      const formatRequest = (value: Record<string, unknown>) =>
        normalized.type === '0x76' ? value : Utils.formatFillTransactionRequest(client, value)

      let transaction = await fill(client, withOverrides, { formatRequest, feeToken })

      // 3. Check if the fee payer approves this transaction.
      const sponsored =
        feePayerOptions &&
        (!feePayerOptions.validate ||
          // @ts-expect-error - TODO: Convert to `TransactionRequest` properly.
          (await feePayerOptions.validate({
            ...transaction,
            from: sender,
          } as Transaction.TransactionRequest)))

      // Re-fill without feePayer when sponsorship is rejected so the
      // gas estimate and nonce are correct for a self-paid transaction.
      if (feePayerOptions && !sponsored) {
        const { feePayer: _, ...withoutFeePayer } = withOverrides
        transaction = await fill(client, withoutFeePayer, { formatRequest, feeToken })
      }

      // 4. Simulate and compute balance diffs + fee.
      const calls = extractCalls(transaction)
      const { balanceDiffs, fee } = await simulateAndParseDiffs(client, {
        account: sender,
        calls,
        feeToken: (transaction as { feeToken?: Address | undefined }).feeToken,
        gas: (transaction as { gas?: bigint | undefined }).gas,
        maxFeePerGas: (transaction as { maxFeePerGas?: bigint | undefined }).maxFeePerGas,
      })

      // 5. Sign as fee payer (when approved).
      const tx = sponsored
        ? await FeePayer.sign({
            account: feePayerOptions.account,
            transaction,
            sender,
          })
        : transaction

      const sponsor = sponsored
        ? {
            address: feePayerOptions.account.address,
            ...(feePayerOptions.name ? { name: feePayerOptions.name } : {}),
            ...(feePayerOptions.url ? { url: feePayerOptions.url } : {}),
          }
        : undefined

      return Utils.rpcResult(request, {
        tx: core_Transaction.toRpc(tx as core_Transaction.Transaction),
        meta: {
          balanceDiffs,
          fee,
          sponsored: !!sponsor,
          ...(sponsor ? { sponsor } : {}),
        },
      })
    } catch (error) {
      return Utils.rpcError(request, error)
    }
  })

  return router
}

async function fill(
  client: Client,
  request: Record<string, unknown>,
  options: {
    formatRequest: (value: Record<string, unknown>) => Record<string, unknown>
    feeToken?: Address | undefined
  },
) {
  const { formatRequest, feeToken } = options
  try {
    const result = await client.request({
      method: 'eth_fillTransaction',
      params: [formatRequest(request) as never],
    })
    return Utils.normalizeTempoTransaction(result.tx)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const parsed = parseInsufficientBalance(error)
    if (!parsed || !feeToken) throw error
    if (parsed.token.toLowerCase() === feeToken.toLowerCase()) throw error

    const swapCalls = buildSwapCalls(feeToken, parsed.token, parsed.required - parsed.available)
    const calls = request.calls as Call[] | undefined
    const result = await client.request({
      method: 'eth_fillTransaction',
      params: [
        formatRequest({
          ...request,
          calls: [...swapCalls, ...(calls ?? [])],
        }) as never,
      ],
    })
    return Utils.normalizeTempoTransaction(result.tx)
  }
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
      | Omit<FeePayer.feePayer.Options, 'chains' | 'transports' | 'path' | 'onRequest'>
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

  /** Metadata returned alongside the filled transaction. */
  export type Meta = {
    /** Per-account balance diffs keyed by address. */
    balanceDiffs: Record<Address, readonly BalanceDiff[]>
    /** Fee estimate for the transaction. */
    fee: { amount: Hex.Hex; decimals: number; formatted: string; symbol: string } | null
    /** Whether the transaction is sponsored by a fee payer. */
    sponsored: boolean
    /** Sponsor details (when sponsored). */
    sponsor?: { address: Address; name: string; url: string } | undefined
  }

  /** Balance diff for a single token relative to the user account. */
  export type BalanceDiff = {
    /** Token address. */
    address: Address
    /** Token decimals (e.g. 6). */
    decimals: number
    /** Direction relative to the user. */
    direction: 'incoming' | 'outgoing'
    /** Human-readable formatted currency value (e.g. "100.00"). */
    formatted: string
    /** Token name (e.g. "USDC.e"). */
    name: string
    /** Addresses receiving this asset. */
    recipients: readonly Address[]
    /** Token symbol (e.g. "USDC.e"). */
    symbol: string
    /** Token amount (hex-encoded). */
    value: Hex.Hex
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

  return Addresses.pathUsd as Address
}

function extractCalls(transaction: Record<string, unknown>) {
  const calls = transaction.calls as
    | readonly {
        to?: Address | undefined
        data?: `0x${string}` | undefined
        value?: bigint | undefined
      }[]
    | undefined
  if (calls && calls.length > 0)
    return calls.map((c) => ({
      ...(c.to ? { to: c.to } : {}),
      ...(c.data ? { data: c.data } : {}),
      ...(c.value ? { value: c.value } : {}),
    }))
  return [
    {
      ...(transaction.to ? { to: transaction.to as Address } : {}),
      ...(transaction.data ? { data: transaction.data as `0x${string}` } : {}),
      ...(transaction.value ? { value: transaction.value as bigint } : {}),
    },
  ]
}

async function simulateAndParseDiffs(
  client: Client,
  options: {
    account?: Address | undefined
    calls: readonly {
      to?: Address | undefined
      data?: `0x${string}` | undefined
      value?: bigint | undefined
    }[]
    feeToken?: Address | undefined
    gas?: bigint | undefined
    maxFeePerGas?: bigint | undefined
  },
) {
  const { account, calls, feeToken, gas, maxFeePerGas } = options

  try {
    const { results, tokenMetadata } = await Actions.simulate.simulateCalls(client, {
      ...(account ? { account } : {}),
      calls: calls as Call[],
      traceTransfers: true,
    })

    // Collect all logs across all call results.
    const logs: (typeof results)[number]['logs'] = []
    for (const result of results as { logs?: (typeof logs)[number][] | undefined }[])
      if (result.logs) logs.push(...result.logs)

    // Build per-token balance diffs relative to the sender.
    const balanceDiffs = account
      ? await buildBalanceDiffs(client, {
          account,
          logs,
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
    return { balanceDiffs: {}, fee }
  }
}

async function buildBalanceDiffs(
  client: Client,
  options: {
    account: Address
    logs: Log[]
    tokenMetadata: Record<Address, { name: string; symbol: string; currency: string }>
  },
) {
  const { account, logs, tokenMetadata } = options
  const accountLower = account.toLowerCase()

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
    const entry = tokenMap.get(token) ?? {
      incoming: 0n,
      outgoing: 0n,
      recipients: new Set<Address>(),
      token: log.address,
    }
    if (log.args.from.toLowerCase() === accountLower) {
      entry.outgoing += log.args.amount
      entry.recipients.add(log.args.to)
      const key = `${token}:${log.args.to.toLowerCase()}`
      transferredBySpender.set(key, (transferredBySpender.get(key) ?? 0n) + log.args.amount)
    }
    if (log.args.to.toLowerCase() === accountLower) entry.incoming += log.args.amount
    tokenMap.set(token, entry)
  }

  // Treat approvals as outgoing unless the spender already transferred >= approval amount.
  for (const log of approvalLogs) {
    if (log.args.owner.toLowerCase() !== accountLower) continue
    const token = log.address.toLowerCase()
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

  // Resolve decimals for all tokens in parallel (simulation metadata first, RPC fallback).
  const decimalsMap = new Map<string, number>()
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const metadata = await resolveTokenMetadata(client, entry.token, tokenMetadata)
        decimalsMap.set(entry.token.toLowerCase(), metadata.decimals)
      } catch {
        decimalsMap.set(entry.token.toLowerCase(), 0)
      }
    }),
  )

  // Build the diff array for this account.
  const diffs: relay.BalanceDiff[] = []
  for (const entry of entries) {
    const net =
      entry.outgoing > entry.incoming
        ? entry.outgoing - entry.incoming
        : entry.incoming - entry.outgoing

    const direction = entry.outgoing > entry.incoming ? 'outgoing' : 'incoming'
    const meta = tokenMetadata[entry.token] ?? tokenMetadata[entry.token.toLowerCase() as Address]
    const decimals = decimalsMap.get(entry.token.toLowerCase()) ?? 0
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
    symbol: meta?.symbol ?? fallback.symbol,
    name: meta?.name ?? fallback.name,
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
    const amount = gas * maxFeePerGas
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

function buildSwapCalls(sourceToken: Address, targetToken: Address, deficit: bigint) {
  const maxAmountIn = deficit + deficit / 10n
  return [
    Actions.token.approve.call({
      token: sourceToken,
      spender: Addresses.stablecoinDex,
      amount: maxAmountIn,
    }),
    Actions.dex.buy.call({
      tokenIn: sourceToken,
      tokenOut: targetToken,
      amountOut: deficit,
      maxAmountIn,
    }),
  ] as const
}
