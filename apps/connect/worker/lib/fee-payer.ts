import { waitUntil } from 'cloudflare:workers'
import { type Address, formatUnits, parseUnits } from 'viem'
import { Actions, Transaction } from 'viem/tempo'

import { type TempoChain, fromId } from './chain.js'
import * as Tidx from './tidx.js'
import * as Viem from './viem.js'

const ATTODOLLARS_PER_MICRODOLLAR = 10n ** 12n
const MIN_BALANCE_UNITS = 1_000_000n

/** pathUSD — same address on all Tempo chains. */
const FEE_TOKEN: Address = '0x20c0000000000000000000000000000000000000'

function attodollarToMicrodollar(attodollars: bigint) {
  return (attodollars + ATTODOLLARS_PER_MICRODOLLAR - 1n) / ATTODOLLARS_PER_MICRODOLLAR
}

function formatMicrodollar(value: bigint) {
  return Number(formatUnits(value, 6))
}

function parseUsdLimit(value: string | undefined, defaultValue: string): bigint | null {
  try {
    const parsed = parseUnits(value || defaultValue, 6)
    if (parsed <= 0n) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Prevent abuse while being blazing fast:
 *   - Always read from KV within request / response cycle, it's ok to be stale
 *   - Apply per-address and global (soft) limits
 */
export function create(
  feePayerAddress: Address,
  kv: KVNamespace,
  options: create.Options = {},
): create.ReturnType {
  const dailyLimitMicroUsd = parseUsdLimit(options.dailyLimitUsd, '0.20')
  const globalDailyLimitMicroUsd = parseUsdLimit(options.globalDailyLimitUsd, '50')

  function kvKey(chain: TempoChain, scope: string) {
    return `fee-payer:${chain}:${scope}`
  }

  /** Read cached spend from KV. Returns `0n` on miss and refreshes in background. */
  async function getSpend(chain: TempoChain, requester?: string | undefined) {
    const scope = requester ? requester.toLowerCase() : 'global'
    const key = kvKey(chain, scope)
    const raw = await kv.get(key)

    // Always refresh in background.
    const qb = Tidx.getQueryBuilder(chain)
    const since = new Date(Date.now() - 86_400_000)

    let query = qb
      .selectFrom('receipts')
      .select(['gas_used', 'effective_gas_price'])
      .where('fee_payer', '=', feePayerAddress.toLowerCase() as `0x${string}`)

    if (scope !== 'global') query = query.where('from', '=', scope as `0x${string}`)

    waitUntil(
      query
        .where('block_timestamp', '>=', since.toISOString() as never)
        .execute()
        .then(async (rows) => {
          let total = 0n
          for (const row of rows)
            total += attodollarToMicrodollar(BigInt(row.gas_used) * BigInt(row.effective_gas_price))
          await kv.put(key, total.toString(), { expirationTtl: 86_400 })
        })
        .catch((err) => console.error('[fee-payer] tidx fetch failed', err)),
    )

    if (!raw) return 0n
    return BigInt(raw)
  }

  /** Read cached balance from KV. First read fetches on-chain; subsequent reads use cache. Always refreshes in background. */
  async function getHasFunds(chain: TempoChain) {
    const key = kvKey(chain, 'balance')
    const raw = await kv.get(key)

    const fetchAndCache = () =>
      Actions.token
        .getBalance(Viem.getClient(chain), { account: feePayerAddress, token: FEE_TOKEN })
        .then(async (balance) => {
          await kv.put(key, String(balance >= MIN_BALANCE_UNITS), { expirationTtl: 86_400 })
        })
        .catch((err) => console.error('[fee-payer] balance check failed', err))

    // Cache hit — return cached value, refresh in background.
    if (raw !== null) {
      waitUntil(fetchAndCache())
      return raw === 'true'
    }

    // Cold start — fetch synchronously, then cache.
    await fetchAndCache()
    const fresh = await kv.get(key)
    return fresh === 'true'
  }

  return async (request) => {
    try {
      if (dailyLimitMicroUsd === null && globalDailyLimitMicroUsd === null) return true

      const from = request.from as Address | undefined
      const gas = request.gas as bigint | undefined
      const maxFeePerGas = request.maxFeePerGas as bigint | undefined
      if (!gas || !maxFeePerGas) return true

      const chain = fromId((request as { chainId?: number }).chainId ?? 4217)

      if (!(await getHasFunds(chain))) {
        console.warn('[fee-payer] insufficient balance')
        return false
      }

      const txFee = attodollarToMicrodollar(gas * maxFeePerGas)

      const globalSpend = await getSpend(chain)
      if (globalDailyLimitMicroUsd !== null && globalSpend + txFee > globalDailyLimitMicroUsd) {
        console.info('[fee-payer] global budget exceeded', {
          globalSpentUsd: formatMicrodollar(globalSpend),
          txFeeUsd: formatMicrodollar(txFee),
          globalDailyLimitUsd: formatMicrodollar(globalDailyLimitMicroUsd),
        })
        return false
      }

      if (dailyLimitMicroUsd !== null && from) {
        const requesterSpend = await getSpend(chain, from)
        if (requesterSpend + txFee > dailyLimitMicroUsd) {
          console.info('[fee-payer] address budget exceeded', {
            requester: from,
            requesterSpentUsd: formatMicrodollar(requesterSpend),
            txFeeUsd: formatMicrodollar(txFee),
            dailyLimitUsd: formatMicrodollar(dailyLimitMicroUsd),
          })
          return false
        }
      }

      return true
    } catch (error) {
      console.error('[fee-payer] validation failed', error)
      return false
    }
  }
}

export declare namespace create {
  type Options = {
    /** Per-address daily spend limit in USD (e.g. `"0.20"`). Defaults to `"0.20"`. */
    dailyLimitUsd?: string | undefined
    /** Global daily spend limit in USD (e.g. `"50"`). Defaults to `"50"`. */
    globalDailyLimitUsd?: string | undefined
  }

  type ReturnType = (request: Transaction.TransactionRequest) => boolean | Promise<boolean>
}
