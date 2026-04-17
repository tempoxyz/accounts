import { waitUntil } from 'cloudflare:workers'
import { QueryBuilder, Tidx } from 'tidx.ts'
import { type Address, type Client, createClient, formatUnits, http, parseUnits } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
import { Actions, Transaction } from 'viem/tempo'

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

function createQueryBuilder(chainId: number) {
  const tidxAuth =
    chainId === tempoModerato.id
      ? process.env.TEMPO_MODERATO_INDEXER_API_KEY
      : process.env.TEMPO_INDEXER_API_KEY
  return QueryBuilder.from(Tidx.create({ basicAuth: tidxAuth, chainId }))
}

/**
 * Prevent abuse while being blazing fast:
 *   - Always read from KV within request / response cycle, it's ok to be stale
 *   - Apply per-address and global (soft) limits
 */
export function create(
  feePayerAddress: Address,
  kv: KVNamespace,
  /** @internal — test overrides. */
  internal: {
    client?: Client | undefined
    queryBuilder?: QueryBuilder.QueryBuilder | undefined
  } = {},
): create.ReturnType {
  const dailyLimitMicroUsd = parseUsdLimit(process.env.FEE_PAYER_DAILY_LIMIT_USD, '0.20')
  const globalDailyLimitMicroUsd = parseUsdLimit(process.env.FEE_PAYER_GLOBAL_DAILY_LIMIT_USD, '50')

  function kvKey(chainId: number, scope: string) {
    return `fee-payer:${chainId}:${scope}`
  }

  /** Read cached spend from KV. Returns `0n` on miss and refreshes in background. */
  async function getSpend(chainId: number, requester?: string | undefined) {
    const scope = requester ? requester.toLowerCase() : 'global'
    const key = kvKey(chainId, scope)
    const raw = await kv.get(key)

    // Always refresh in background.
    const qb = internal.queryBuilder ?? createQueryBuilder(chainId)
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
  async function getHasFunds(chainId: number) {
    const key = kvKey(chainId, 'balance')
    const raw = await kv.get(key)

    const client =
      internal.client ??
      createClient({
        chain: chainId === tempoModerato.id ? tempoModerato : tempo,
        transport: http(),
      })

    const fetchAndCache = () =>
      Actions.token
        .getBalance(client, { account: feePayerAddress, token: FEE_TOKEN })
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

      const chainId = (request as { chainId?: number }).chainId ?? tempo.id

      if (!(await getHasFunds(chainId))) {
        console.warn('[fee-payer] insufficient balance')
        return false
      }

      const txFee = attodollarToMicrodollar(gas * maxFeePerGas)

      const globalSpend = await getSpend(chainId)
      if (globalDailyLimitMicroUsd !== null && globalSpend + txFee > globalDailyLimitMicroUsd) {
        console.info('[fee-payer] global budget exceeded', {
          globalSpentUsd: formatMicrodollar(globalSpend),
          txFeeUsd: formatMicrodollar(txFee),
          globalDailyLimitUsd: formatMicrodollar(globalDailyLimitMicroUsd),
        })
        return false
      }

      if (dailyLimitMicroUsd !== null && from) {
        const requesterSpend = await getSpend(chainId, from)
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
  type ReturnType = (request: Transaction.TransactionRequest) => boolean | Promise<boolean>
}
