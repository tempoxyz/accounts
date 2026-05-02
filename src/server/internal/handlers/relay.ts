import { AbiEvent, Hex, RpcRequest, RpcResponse } from 'ox'
import { Transaction as core_Transaction } from 'ox/tempo'
import {
  type Address,
  type Call,
  type Chain,
  type Client,
  createClient,
  formatUnits,
  http,
  type Log,
  parseEventLogs,
  type Transport,
  zeroAddress,
} from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { simulateCalls } from 'viem/actions'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'
import { Abis, Actions, Addresses, Capabilities, Transaction } from 'viem/tempo'

import * as ExecutionError from '../../../core/ExecutionError.js'
import * as Schema from '../../../core/Schema.js'
import { type Handler, from } from '../../Handler.js'
import * as Kv from '../../Kv.js'
import { cached } from '../kv.js'
import * as Tokenlist from '../tokenlist.js'
import * as Sponsorship from './sponsorship.js'
import * as Utils from './utils.js'

/** Default cache TTL in seconds (10 minutes) for the verified tokenlist. */
const defaultCacheTtl = 10 * 60

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
 * const handler = Handler.relay({
 *   feePayer: {
 *     account: privateKeyToAccount('0x...'),
 *   },
 * })
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function relay(options: relay.Options = {}): Handler {
  const {
    cacheTtl = defaultCacheTtl,
    chains = [tempo, tempoModerato, tempoDevnet],
    kv = Kv.memory(),
    onRequest,
    path = '/',
    resolveTokens,
    transports = {},
    ...rest
  } = options
  const feePayerOptions = options.feePayer

  // Resolves the verified tokenlist for `chainId`, sharing the KV cache with
  // `Handler.exchange` so a single `kv: Kv.cloudflare(env.KV)` covers both.
  // The relay only needs addresses, so map down from the full metadata.
  const getTokens = async (chainId: number): Promise<readonly Address[]> => {
    const tokens = await Tokenlist.fetch(chainId, kv, { cacheTtl, resolver: resolveTokens })
    return tokens.map((t) => t.address)
  }

  const features = {
    autoSwap: options.autoSwap ?? options.features === 'all',
    feeTokenResolution: options.resolveTokens ?? options.features === 'all',
    simulate: options.features === 'all',
  }

  const autoSwap = (() => {
    if (!features.autoSwap) return undefined
    if (options.autoSwap === false) return undefined
    return {
      slippage:
        (typeof options.autoSwap === 'object' ? options.autoSwap?.slippage : undefined) ?? 0.05,
    }
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

  async function handleRequest(
    request: RpcRequest.RpcRequest<Schema.Ox>,
    options?: { chainId?: number | undefined },
  ) {
    await onRequest?.(request)

    // Resolve chainId from: 1) explicit option (URL path), 2) first param object, 3) default chain.
    const params = 'params' in request && Array.isArray(request.params) ? request.params : []
    const first =
      typeof params[0] === 'object' && params[0]
        ? (params[0] as Record<string, unknown>)
        : undefined
    const chainId = Utils.resolveChainId(first?.chainId) ?? options?.chainId ?? chains[0]!.id
    const client = getClient(chainId)

    switch (request.method) {
      case 'eth_fillTransaction': {
        try {
          const parameters = params[0] as Record<string, unknown>
          const from =
            typeof parameters.from === 'string' ? (parameters.from as Address) : undefined
          const requestFeeToken =
            typeof parameters.feeToken === 'string' ? (parameters.feeToken as Address) : undefined
          const externalFeePayerUrl =
            typeof parameters.feePayer === 'string' ? parameters.feePayer : undefined
          const requestsSponsorship =
            (!!feePayerOptions || !!externalFeePayerUrl) && parameters.feePayer !== false
          const capabilities = (parameters.capabilities ?? {}) as Record<string, unknown>
          // Default to `true`. Dapps that don't render diffs can pass
          // `capabilities.balanceDiffs: false` to skip the post-fill
          // `tempo_simulateV1` round trip (~250-400ms).
          const requireBalanceDiffs = capabilities.balanceDiffs !== false

          const { feePayer: _feePayer, ...normalized } =
            Utils.normalizeFillTransactionRequest(parameters)
          const baseTx = {
            ...normalized,
            ...(typeof chainId !== 'undefined' ? { chainId } : {}),
            ...(requestFeeToken ? { feeToken: requestFeeToken } : {}),
          }

          let filled: Awaited<ReturnType<typeof fill>>
          let sponsored = false
          let feeToken = requestFeeToken

          // Lazily resolve a swap source token when autoSwap needs one.
          const resolveFeeTokenForSwap = from
            ? async (insufficientToken: Address) =>
                resolveFeeToken(client, {
                  account: from,
                  feeToken: undefined,
                  kv,
                  tokens: (await getTokens(chainId)).filter(
                    (t) => t.toLowerCase() !== insufficientToken.toLowerCase(),
                  ),
                })
            : undefined

          // When no sponsor will pay, prefer fee tokens the user actually
          // holds. Extend the configured token list with any TIP20 token
          // the transaction is calling — typically the token being
          // transferred — so a user transferring USDC.e can pay gas in
          // USDC.e even when the configured list defaults to pathUSD.
          const configuredTokens = await getTokens(chainId)
          const unsponsoredTokens = [
            ...configuredTokens,
            ...callTargetTokens(baseTx).filter(
              (t) => !configuredTokens.some((rt) => rt.toLowerCase() === t.toLowerCase()),
            ),
          ]

          // When the app provides its own fee payer URL, route the fill
          // through that service so it can sign the transaction.
          const fillClient = externalFeePayerUrl
            ? createClient({
                chain: client.chain,
                batch: { multicall: { deployless: true } },
                transport: http(externalFeePayerUrl),
              })
            : client

          if (requestsSponsorship && !feePayerOptions?.validate) {
            // Path A: sponsorship guaranteed (no validate) — skip fee token
            // resolution, fill once with feePayer, then parallelize the rest.
            const transaction = { ...baseTx, feePayer: true }
            if (Sponsorship.isPreparedTransaction(transaction)) {
              filled = {
                transaction: Utils.normalizeTempoTransaction(transaction),
                sponsor: undefined,
              }
            } else {
              filled = await fill(fillClient, {
                autoSwap,
                feeToken,
                kv,
                resolveFeeToken: resolveFeeTokenForSwap,
                transaction,
              })
            }
            sponsored = true
          } else if (requestsSponsorship && feePayerOptions?.validate) {
            // Path B: sponsorship possible but may be rejected.
            // Speculatively fill the sponsored variant, validate, and only
            // fall back to the unsponsored path on rejection. The accept
            // case (common) avoids the upfront `resolveFeeToken` round
            // trips and the second `eth_fillTransaction`.
            const sponsoredTx = { ...baseTx, feePayer: true }

            if (Sponsorship.isPreparedTransaction(sponsoredTx)) {
              // Already prepared — skip fills, just validate sponsorship.
              const prepared = {
                transaction: Utils.normalizeTempoTransaction(sponsoredTx),
                sponsor: undefined,
              }
              sponsored = await Sponsorship.shouldSponsor({
                sender: from,
                transaction: prepared.transaction,
                validate: feePayerOptions!.validate,
              })
              filled = prepared
            } else {
              const options = {
                autoSwap,
                kv,
                resolveFeeToken: resolveFeeTokenForSwap,
              }
              const fill_sponsored = await fill(fillClient, {
                ...options,
                feeToken,
                transaction: sponsoredTx,
              })
              sponsored = await Sponsorship.shouldSponsor({
                sender: from,
                transaction: fill_sponsored.transaction,
                validate: feePayerOptions!.validate,
              })
              if (sponsored) {
                filled = fill_sponsored
              } else {
                // Sponsor rejected — resolve fee token and fill unsponsored.
                const feeToken_unsponsored = features.feeTokenResolution
                  ? await resolveFeeToken(client, {
                      account: from,
                      feeToken: requestFeeToken,
                      kv,
                      tokens: unsponsoredTokens,
                    })
                  : requestFeeToken
                const tx_unsponsored = {
                  ...baseTx,
                  ...(feeToken_unsponsored ? { feeToken: feeToken_unsponsored } : {}),
                }
                filled = await fill(client, {
                  ...options,
                  feeToken: feeToken_unsponsored,
                  transaction: tx_unsponsored,
                })
                feeToken = feeToken_unsponsored
              }
            }
          } else {
            // Path C: no sponsorship configured — resolve fee token, fill once.
            feeToken = features.feeTokenResolution
              ? await resolveFeeToken(client, {
                  account: from,
                  feeToken: requestFeeToken,
                  kv,
                  tokens: unsponsoredTokens,
                })
              : requestFeeToken
            const transaction = { ...baseTx, ...(feeToken ? { feeToken } : {}) }
            filled = await fill(client, {
              autoSwap,
              feeToken,
              kv,
              resolveFeeToken: resolveFeeTokenForSwap,
              transaction,
            })
          }

          const transaction_filled = filled.transaction
          const swap = 'swap' in filled ? filled.swap : undefined
          if (!feeToken)
            feeToken =
              (transaction_filled.feeToken as Address | undefined) ?? (await getTokens(chainId))[0]

          // Parallelize: simulate, fee payer signing, and autoSwap metadata.
          const alreadySigned =
            'feePayerSignature' in transaction_filled &&
            transaction_filled.feePayerSignature != null

          const [{ balanceDiffs, fee }, transaction_final, autoSwap_] = await Promise.all([
            // Simulate and compute balance diffs + fee.
            // When `capabilities.balanceDiffs` is `false`, skip simulate
            // and compute fee directly from cached metadata.
            (async () => {
              if (!features.simulate) return { balanceDiffs: undefined, fee: undefined }
              if (requireBalanceDiffs)
                return simulateAndParseDiffs(client, {
                  account: from,
                  calls: extractCalls(transaction_filled),
                  swap,
                  feeToken,
                  gas: transaction_filled.gas,
                  kv,
                  maxFeePerGas: transaction_filled.maxFeePerGas,
                })
              const fee = await computeFee(client, {
                feeToken,
                gas: transaction_filled.gas,
                kv,
                maxFeePerGas: transaction_filled.maxFeePerGas,
              }).catch(() => undefined)
              return { balanceDiffs: undefined, fee }
            })(),
            // Sign as fee payer (if sponsored and not already signed).
            (async () => {
              if (!(sponsored && feePayerOptions && !alreadySigned)) return transaction_filled
              return Sponsorship.sign({
                account: feePayerOptions.account,
                sender: from,
                transaction: transaction_filled,
              })
            })(),
            // Resolve autoSwap metadata (when AMM path was taken).
            resolveAutoSwapMetadata(client, { autoSwap, kv, swap }),
          ])

          const sponsor = (() => {
            if (!sponsored) return undefined
            // App-provided fee payer: relay back the sponsor from the upstream response.
            if (externalFeePayerUrl) return filled.sponsor
            if (feePayerOptions) return Sponsorship.getSponsor(feePayerOptions)
            return filled.sponsor
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
          if (!(error instanceof Error)) return Utils.rpcErrorJson(request, error)

          const revert = ExecutionError.parse(error)

          const parameters = request.params[0]
          const stub = {
            from: parameters.from,
            to: parameters.to ?? null,
            gas: '0x0',
            nonce: '0x0',
            value: '0x0',
            maxFeePerGas: '0x0',
            maxPriorityFeePerGas: '0x0',
          }

          if (revert?.errorName === 'InsufficientBalance') {
            const args = revert.args as [bigint, bigint, Address]
            const [available, required, token] = args

            const normalized = Utils.normalizeFillTransactionRequest(parameters)

            // Simulate from zero address for optimistic balance diffs.
            const optimisticCalls = normalized ? extractCalls(normalized) : undefined
            const { balanceDiffs } = optimisticCalls
              ? await simulateAndParseDiffs(client, {
                  account: zeroAddress,
                  calls: optimisticCalls,
                  kv,
                })
              : { balanceDiffs: undefined }

            // Re-key balance diffs from zero address to the real sender.
            const senderDiffs =
              parameters.from && balanceDiffs
                ? { [parameters.from]: balanceDiffs[zeroAddress] ?? [] }
                : balanceDiffs

            const metadata = await resolveTokenMetadata(client, { token, kv }).catch(
              () => undefined,
            )
            const deficit = required - available
            return RpcResponse.from(
              {
                result: {
                  tx: stub,
                  capabilities: {
                    balanceDiffs: senderDiffs,
                    error: ExecutionError.serialize(revert),
                    requireFunds: metadata
                      ? {
                          amount: Hex.fromNumber(deficit) as `0x${string}`,
                          decimals: metadata.decimals,
                          formatted: formatUnits(deficit, metadata.decimals),
                          token,
                          symbol: metadata.symbol,
                        }
                      : undefined,
                    sponsored: false,
                  },
                },
              },
              { request },
            )
          }

          return RpcResponse.from(
            {
              result: {
                tx: stub,
                capabilities: {
                  error: ExecutionError.serialize(revert),
                  sponsored: false,
                },
              },
            },
            { request },
          )
        }
      }

      // @ts-expect-error
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
        try {
          const result = await client.request(request as never)
          return RpcResponse.from({ result }, { request })
        } catch (error) {
          return Utils.rpcErrorJson(request, error)
        }
      }
    }
  }

  const router = from(rest)

  async function handlePost(c: { req: { raw: Request; param: (key: string) => string } }) {
    const chainId = Utils.resolveChainId(c.req.param('chainId'))
    const body = await c.req.raw.json()
    const isBatch = Array.isArray(body)

    if (!isBatch) {
      const request = RpcRequest.from(body as never) as RpcRequest.RpcRequest<Schema.Ox>
      return Response.json(await handleRequest(request, { chainId }))
    }

    const responses = await Promise.all(
      (body as unknown[]).map((item) =>
        handleRequest(RpcRequest.from(item as never) as RpcRequest.RpcRequest<Schema.Ox>, {
          chainId,
        }),
      ),
    )
    return Response.json(responses)
  }

  router.post(path, handlePost as never)
  router.post(`${path === '/' ? '' : path}/:chainId`, handlePost as never)

  return router
}

export namespace relay {
  export type Options = from.Options & {
    /**
     * Auto-swap options.
     */
    autoSwap?:
      | false
      | {
          /** Slippage tolerance (e.g. 0.05 = 5%). @default 0.05 */
          slippage?: number | undefined
        }
      | undefined
    /**
     * TTL in seconds for cached `resolveTokens` results.
     * @default 600 (10 minutes)
     */
    cacheTtl?: number | undefined
    /**
     * Supported chains. The handler resolves the client based on the
     * `chainId` in the incoming transaction.
     * @default [tempo, tempoModerato, tempoDevnet]
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
          validate?:
            | ((request: Transaction.TransactionRequest) => boolean | Promise<boolean>)
            | undefined
          /** Sponsor display name returned from `eth_fillTransaction`. */
          name?: string | undefined
          /** Sponsor URL returned from `eth_fillTransaction`. */
          url?: string | undefined
        }
      | undefined
    /**
     * Kv store used to cache `resolveTokens` results across requests.
     * Provide `Kv.cloudflare(env.KV)` for cross-instance caching, or omit
     * for an in-process LRU.
     * @default Kv.memory()
     */
    kv?: Kv.Kv | undefined
    /**
     * Resolves the list of known tokens for a chain. The relay checks
     * `balanceOf` for each token and picks the one with the highest balance
     * during fee token resolution.
     * @default Fetches `https://tokenlist.tempo.xyz/list/:chainId`
     */
    resolveTokens?:
      | ((chainId: number) => readonly Tokenlist.Token[] | Promise<readonly Tokenlist.Token[]>)
      | undefined
    /**
     * Relay features.
     *
     * - `'all'` — enables fee token resolution, auto-swap,
     *   fee payer, and simulation (balance diffs + fee breakdown).
     * - `undefined` (default) — only fee payers.
     */
    features?: 'all' | undefined
    /** Function to call before handling the request. */
    onRequest?: ((request: RpcRequest.RpcRequest) => Promise<void>) | undefined
    /** Path to use for the handler. @default "/" */
    path?: string | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
  }
}

// TODO: cleanup
async function fill(client: Client, options: fill.Options) {
  const { autoSwap, feeToken, kv, transaction: request } = options

  // Skip re-formatting if already in RPC format (e.g. from viem's fillTransaction).
  const format = (value: Record<string, unknown>) =>
    value.type === '0x76' ? value : Utils.formatFillTransactionRequest(client, value)

  // Re-fill the transaction with prepended swap calls so the user can
  // mint the missing `insufficientToken` (typically the fee token) from
  // a token they already hold. Returns null if no source token is
  // available or autoSwap is disabled.
  async function fillWithSwap(insufficientToken: Address, deficit: bigint) {
    if (!autoSwap) return null
    const sourceToken =
      feeToken && feeToken.toLowerCase() !== insufficientToken.toLowerCase()
        ? feeToken
        : await options.resolveFeeToken?.(insufficientToken)
    if (!sourceToken || sourceToken.toLowerCase() === insufficientToken.toLowerCase()) return null

    const maxAmountIn = deficit + (deficit * BigInt(Math.round(autoSwap.slippage * 1000))) / 1000n
    const originalCalls = (request.calls as Call[] | undefined) ?? []
    const swapCalls = buildSwapCalls(sourceToken, insufficientToken, deficit, maxAmountIn)

    const result = await client.request({
      method: 'eth_fillTransaction',
      params: [
        format({
          ...request,
          calls: [...swapCalls, ...originalCalls],
        }) as never,
      ],
    })
    const sponsor = (result as Record<string, any>).capabilities?.sponsor as
      | { address: Address; name?: string; url?: string }
      | undefined
    const mergedTx = mergeCallsFromRequest(result.tx as Record<string, unknown>, {
      ...request,
      calls: [...swapCalls, ...originalCalls],
    })
    return {
      transaction: Utils.normalizeTempoTransaction(mergedTx),
      sponsor,
      swap: {
        calls: swapCalls,
        tokenIn: sourceToken,
        tokenOut: insufficientToken,
        amountOut: deficit,
        maxAmountIn,
      },
    }
  }

  try {
    const formatted = format(request)
    const result = await client.request({
      method: 'eth_fillTransaction',
      params: [formatted as never],
    })
    // FIXME: node estimates gas with secp256k1 dummy sig + null feePayerSignature.
    // Actual tx has larger keychain/webAuthn sigs + real fee payer sig, costing
    // more intrinsic gas. Mirror the bump from viem's tempo chainConfig.
    // Skip if another relay already bumped (indicated by feePayerSignature).
    // @ts-expect-error
    if (result.tx.gas && request.feePayer && !result.tx.feePayerSignature)
      result.tx.gas = Hex.fromNumber(BigInt(result.tx.gas) + 20_000n)
    const upstreamCapabilities = (result as { capabilities?: Record<string, unknown> }).capabilities
    const sponsor = upstreamCapabilities?.sponsor as
      | { address: Address; name?: string; url?: string }
      | undefined
    // External fee-payer relays surface chain reverts (e.g. InsufficientBalance)
    // inside `capabilities.error` with a stub `tx` instead of throwing. Detect
    // that here and re-throw so the autoSwap branch below can recover the same
    // way it does for the direct-chain path.
    const upstreamError = upstreamCapabilities?.error as
      | { errorName?: string; message?: string; data?: `0x${string}` }
      | undefined
    if (upstreamError?.errorName === 'InsufficientBalance') {
      const synthetic = new Error(upstreamError.message ?? 'InsufficientBalance')
      synthetic.name = 'UpstreamRevertError'
      ;(synthetic as { data?: `0x${string}` | undefined }).data = upstreamError.data
      throw synthetic
    }
    // Reconstruct a `swap` shape from upstream's `capabilities.autoSwap` so the
    // wallet relay's outer code can re-resolve autoSwap metadata locally —
    // otherwise upstream-driven swaps are silently dropped from the response.
    const swap = extractSwapFromCapabilities(upstreamCapabilities?.autoSwap)
    // The chain's `eth_fillTransaction` doesn't echo back `calls`, so merge
    // them in from the original request before normalizing — otherwise the
    // typed envelope built for sponsorship signing throws CallsEmptyError.
    const mergedTx = mergeCallsFromRequest(result.tx as Record<string, unknown>, request)

    // The node's `eth_fillTransaction` may pick a fee token the user
    // doesn't yet hold (e.g. one this transaction will mint via a
    // swap). Tempo's gas check runs before the calls execute, so the
    // tx would revert at broadcast with `have 0 want N`. Validate the
    // sender's pre-tx balance against the computed gas cost and, if
    // short, autoSwap a token they do hold into the fee token.
    if (autoSwap && !swap) {
      const fromAddress = request.from as Address | undefined
      const resolvedFeeToken = ((mergedTx.feeToken as Address | undefined) ?? feeToken) as
        | Address
        | undefined
      const gas = mergedTx.gas ? BigInt(mergedTx.gas as `0x${string}`) : 0n
      const maxFeePerGas = mergedTx.maxFeePerGas
        ? BigInt(mergedTx.maxFeePerGas as `0x${string}`)
        : 0n
      if (fromAddress && resolvedFeeToken && gas > 0n && maxFeePerGas > 0n) {
        const [balance, metadata] = await Promise.all([
          Actions.token
            .getBalance(client, { account: fromAddress, token: resolvedFeeToken })
            .catch(() => 0n),
          resolveTokenMetadata(client, { token: resolvedFeeToken, kv }).catch(() => undefined),
        ])
        if (metadata) {
          const requiredFee =
            (gas * maxFeePerGas) / 10n ** BigInt(Math.max(0, 18 - metadata.decimals))
          if (balance < requiredFee) {
            // Best-effort: if the swap itself can't be filled (e.g. the
            // source token also has insufficient balance), fall through
            // and return the original tx with the resolved feeToken
            // rather than failing the whole request.
            const swapResult = await fillWithSwap(resolvedFeeToken, requiredFee - balance).catch(
              () => null,
            )
            if (swapResult) return swapResult
          }
        }
      }
    }

    return {
      transaction: Utils.normalizeTempoTransaction(mergedTx),
      sponsor,
      ...(swap ? { swap } : {}),
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (!autoSwap) throw error

    const revert = ExecutionError.parse(error)
    if (revert?.errorName !== 'InsufficientBalance') throw error

    const [available, required, token] = revert.args
    if (typeof available === 'undefined' || typeof required === 'undefined' || !token) throw error

    const swapResult = await fillWithSwap(token as Address, required - available)
    if (!swapResult) throw error
    return swapResult
  }
}

declare namespace fill {
  type Options = {
    autoSwap?: { slippage: number } | undefined
    feeToken?: Address | undefined
    kv?: Kv.Kv | undefined
    resolveFeeToken?: ((insufficientToken: Address) => Promise<Address | undefined>) | undefined
    transaction: Record<string, unknown>
  }
}

async function resolveFeeToken(
  client: Client,
  options: resolveFeeToken.Options,
): Promise<Address | undefined> {
  const { feeToken, account, kv, tokens } = options
  if (feeToken) return feeToken
  if (!account) return undefined

  // Cache the user's preferred fee token for `userTokenCacheTtl` seconds.
  // The on-chain preference rarely changes; a short TTL avoids the
  // ~150-250ms `userTokens` multicall on every unsponsored fill while
  // still picking up updates within a minute. The cached value is just a
  // hint — if the user's balance is 0 we fall back to the highest-balance
  // token from the configured list.
  const getUserToken = () =>
    Actions.fee.getUserToken(client, { account }).catch(() => null)
  const userTokenPromise = kv
    ? cached(
        kv,
        `fee.userToken:${client.chain?.id ?? 0}:${account.toLowerCase()}`,
        async () => {
          const result = await getUserToken()
          return result ? { address: result.address } : null
        },
        { ttl: options.userTokenCacheTtl ?? 60 },
      )
    : getUserToken()

  const [userToken, balances] = await Promise.all([
    userTokenPromise,
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

declare namespace resolveFeeToken {
  type Options = {
    feeToken?: Address | undefined
    account?: Address | undefined
    kv?: Kv.Kv | undefined
    tokens?: readonly Address[] | undefined
    /** TTL in seconds for the cached `userTokens` lookup. @default 60 */
    userTokenCacheTtl?: number | undefined
  }
}

/**
 * Extracts unique TIP20 token addresses (Tempo `0x20c0…` prefix) that the
 * transaction's calls target. Used as fallback fee-token candidates so a
 * user transferring a token they hold can pay gas in that token even when
 * the configured fee-token list defaults to one they don't hold.
 */
function callTargetTokens(transaction: Record<string, unknown>): readonly Address[] {
  const calls = transaction.calls as readonly { to?: Address }[] | undefined
  if (!calls) return []
  const out: Address[] = []
  const seen = new Set<string>()
  for (const c of calls) {
    if (!c.to) continue
    const lower = c.to.toLowerCase()
    if (!lower.startsWith('0x20c0')) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(c.to)
  }
  return out
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
async function simulate(client: Client, options: simulate.Options) {
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

declare namespace simulate {
  type Options = {
    account?: Address | undefined
    calls: readonly Call[]
  }
}

async function simulateAndParseDiffs(
  client: Client,
  options: simulateAndParseDiffs.Options,
) {
  const { account, calls, swap, feeToken, gas, kv, maxFeePerGas } = options

  try {
    const { results, tokenMetadata } = await simulate(client, {
      account: account === zeroAddress ? undefined : account,
      calls,
    })

    // Collect all logs across all call results.
    const logs: (typeof results)[number]['logs'] = []
    for (const result of results as { logs?: (typeof logs)[number][] | undefined }[])
      if (result.logs) logs.push(...result.logs)

    // Build per-token balance diffs relative to the sender.
    const balanceDiffs = account
      ? await buildBalanceDiffs(client, {
          account,
          kv,
          logs,
          swap,
          tokenMetadata: tokenMetadata as never,
        })
      : {}

    // Compute fee breakdown.
    const fee = await computeFee(client, {
      feeToken,
      gas,
      kv,
      maxFeePerGas,
      tokenMetadata: tokenMetadata as never,
    }).catch(() => undefined)

    return { balanceDiffs, fee }
  } catch {
    // Simulation failures should not block the fill response —
    // return empty diffs with fee computed from transaction fields.
    const fee = await computeFee(client, { feeToken, gas, kv, maxFeePerGas })
    return { balanceDiffs: undefined, fee }
  }
}

declare namespace simulateAndParseDiffs {
  type Options = {
    account?: Address | undefined
    calls: readonly Call[]
    swap?: { tokenIn: Address; tokenOut: Address } | undefined
    feeToken?: Address | undefined
    gas?: bigint | undefined
    kv?: Kv.Kv | undefined
    maxFeePerGas?: bigint | undefined
  }
}

async function buildBalanceDiffs(client: Client, options: buildBalanceDiffs.Options) {
  const { account, kv, logs, swap, tokenMetadata } = options
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
        const metadata = await resolveTokenMetadata(client, {
          token: entry.token,
          tokenMetadata,
          kv,
        })
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

declare namespace buildBalanceDiffs {
  type Options = {
    account: Address
    kv?: Kv.Kv | undefined
    logs: Log[]
    swap?: { tokenIn: Address; tokenOut: Address } | undefined
    tokenMetadata: Record<Address, { name: string; symbol: string; currency: string }>
  }
}

async function resolveTokenMetadata(client: Client, options: resolveTokenMetadata.Options) {
  const { token, tokenMetadata, kv } = options
  const meta = tokenMetadata?.[token] ?? tokenMetadata?.[token.toLowerCase() as Address]
  // TIP-20 metadata (decimals/symbol/name) is immutable per token, so cache
  // long-term in KV. Skips the multicall RPC on cache hits.
  const fetcher = () => Actions.token.getMetadata(client, { token })
  const fallback = kv
    ? await cached(
        kv,
        `tokenMetadata:${client.chain?.id ?? 0}:${token.toLowerCase()}`,
        fetcher,
        { ttl: 24 * 60 * 60 },
      )
    : await fetcher()
  return {
    decimals: fallback.decimals ?? 6,
    symbol: meta?.symbol || fallback.symbol,
    name: meta?.name || fallback.name,
  }
}

declare namespace resolveTokenMetadata {
  type Options = {
    token: Address
    tokenMetadata?:
      | Record<Address, { name: string; symbol: string; currency: string }>
      | undefined
    kv?: Kv.Kv | undefined
  }
}

async function resolveAutoSwapMetadata(client: Client, options: resolveAutoSwapMetadata.Options) {
  const { autoSwap, kv, swap } = options
  if (!autoSwap || !swap) return undefined
  const [inMeta, outMeta] = await Promise.all([
    resolveTokenMetadata(client, { token: swap.tokenIn, kv }).catch(() => undefined),
    resolveTokenMetadata(client, { token: swap.tokenOut, kv }).catch(() => undefined),
  ])
  if (!inMeta || !outMeta) return undefined
  return {
    calls: swap.calls.map((c) => ({ to: c.to, data: c.data })),
    slippage: autoSwap.slippage,
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
}

declare namespace resolveAutoSwapMetadata {
  type Options = {
    autoSwap?: { slippage: number } | undefined
    kv?: Kv.Kv | undefined
    swap?:
      | {
          calls: readonly { to: Address; data: `0x${string}` }[]
          tokenIn: Address
          tokenOut: Address
          amountOut: bigint
          maxAmountIn: bigint
        }
      | undefined
  }
}

async function computeFee(client: Client, options: computeFee.Options) {
  const { feeToken, gas, kv, maxFeePerGas, tokenMetadata } = options
  if (!feeToken || !gas || !maxFeePerGas) return undefined

  try {
    const metadata = await resolveTokenMetadata(client, { token: feeToken, tokenMetadata, kv })
    const raw = gas * maxFeePerGas
    const amount = raw / 10n ** BigInt(18 - metadata.decimals)
    return {
      amount: Hex.fromNumber(amount) as `0x${string}`,
      decimals: metadata.decimals,
      formatted: formatUnits(amount, metadata.decimals),
      symbol: metadata.symbol,
    }
  } catch {
    return undefined
  }
}

declare namespace computeFee {
  type Options = {
    feeToken?: Address | undefined
    gas?: bigint | undefined
    kv?: Kv.Kv | undefined
    maxFeePerGas?: bigint | undefined
    tokenMetadata?: Record<Address, { name: string; symbol: string; currency: string }> | undefined
  }
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

/**
 * Merges the original fill request into the result tx. The chain's
 * `eth_fillTransaction` returns only the "filled" gas/nonce/fee fields and
 * omits envelope inputs like `calls`, `chainId`, `validBefore`, `nonceKey`,
 * `keyData`, `keyType`, `feePayer`. Without these the typed Tempo envelope
 * built for sponsorship signing throws `CallsEmptyError` or
 * `Cannot convert undefined to a BigInt` when serializing.
 *
 * Result fields take precedence (they are the chain's authoritative filled
 * values); request fields fill in everything else. Calls are normalized
 * separately so legacy `to`/`data`/`value` requests are also supported.
 */
function mergeCallsFromRequest(
  resultTx: Record<string, unknown>,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...request, ...resultTx }
  const resultCalls = resultTx.calls
  if (Array.isArray(resultCalls) && resultCalls.length > 0) return merged

  const reqCalls = request.calls
  if (Array.isArray(reqCalls) && reqCalls.length > 0) {
    merged.calls = reqCalls
    return merged
  }

  const { to, data, value } = request
  if (typeof to === 'undefined' && typeof data === 'undefined' && typeof value === 'undefined')
    return merged

  merged.calls = [
    {
      ...(typeof to !== 'undefined' ? { to } : {}),
      ...(typeof data !== 'undefined' ? { data } : {}),
      ...(typeof value !== 'undefined' ? { value } : {}),
    },
  ]
  return merged
}

/**
 * Reconstructs a `swap` shape (matching the inner autoSwap branch's return
 * value) from an upstream relay's `capabilities.autoSwap`. Used so a wallet
 * relay forwarding to an external feePayer URL can re-emit autoSwap metadata
 * locally without losing track of the upstream's swap.
 */
function extractSwapFromCapabilities(autoSwap: unknown):
  | {
      calls: readonly { to: Address; data: `0x${string}` }[]
      tokenIn: Address
      tokenOut: Address
      amountOut: bigint
      maxAmountIn: bigint
    }
  | undefined {
  if (!autoSwap || typeof autoSwap !== 'object') return undefined
  const a = autoSwap as {
    calls?: readonly { to: Address; data: `0x${string}` }[]
    maxIn?: { token?: Address; value?: `0x${string}` }
    minOut?: { token?: Address; value?: `0x${string}` }
  }
  if (!a.calls || !a.maxIn?.token || !a.maxIn.value || !a.minOut?.token || !a.minOut.value)
    return undefined
  return {
    calls: a.calls,
    tokenIn: a.maxIn.token,
    tokenOut: a.minOut.token,
    amountOut: BigInt(a.minOut.value),
    maxAmountIn: BigInt(a.maxIn.value),
  }
}
