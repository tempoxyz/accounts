import { RpcRequest, RpcResponse } from 'ox'
import { Transaction as core_Transaction } from 'ox/tempo'
import type { Address, Chain, Client, Transport } from 'viem'
import { createClient, http } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { tempo, tempoModerato } from 'viem/chains'
import { Transaction } from 'viem/tempo'

import { type Handler, from } from '../../Handler.js'
import * as Sponsorship from './sponsorship.js'
import * as Utils from './utils.js'

/**
 * Instantiates a fee payer service request handler that can be used to
 * sponsor the fee for user transactions.
 *
 * @deprecated Use `Handler.relay({ feePayer: { ... } })` instead.
 *
 * @example
 * ```ts
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { Handler } from 'accounts/server'
 *
 * const handler = Handler.feePayer({
 *   account: privateKeyToAccount('0x...'),
 * })
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
 * @param options - Options.
 * @returns Request handler.
 */
export function feePayer(options: feePayer.Options): Handler {
  const {
    account,
    chains = [tempo, tempoModerato],
    name,
    onRequest,
    path = '/',
    validate,
    transports = {},
    url,
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

  const sponsor = Sponsorship.getSponsor({ account, name, url })

  const router = from(rest)

  router.post(path, async (c) => {
    const request = RpcRequest.from((await c.req.raw.json()) as any)

    try {
      await onRequest?.(request)

      const method = request.method as string
      if (
        method !== 'eth_fillTransaction' &&
        method !== 'eth_signRawTransaction' &&
        method !== 'eth_sendRawTransaction' &&
        method !== 'eth_sendRawTransactionSync'
      )
        return Response.json(
          RpcResponse.from(
            {
              error: new RpcResponse.MethodNotSupportedError({
                message: `Method not supported: ${request.method}`,
              }),
            },
            { request },
          ),
        )

      if (method === 'eth_fillTransaction') {
        const [parameters] = Utils.parseParams.parse(request.params) as [Record<string, unknown>]
        const chainId = Utils.resolveChainId(parameters.chainId)
        const client = getClient(chainId)
        const normalized = Utils.normalizeFillTransactionRequest(parameters)
        const sender =
          typeof parameters.from === 'string' ? (parameters.from as Address) : undefined

        let transaction = await (async () => {
          if (Sponsorship.isPreparedTransaction(parameters))
            return Utils.normalizeTempoTransaction(parameters)

          const fillRequest = Utils.formatFillTransactionRequest(client, {
            ...normalized,
            ...(typeof chainId !== 'undefined' ? { chainId } : {}),
            feePayer: true,
          })
          const result = (await client.request({
            method: 'eth_fillTransaction' as never,
            params: [fillRequest],
          })) as { tx?: Record<string, unknown> | undefined }
          return Utils.normalizeTempoTransaction(result.tx)
        })()

        if (!(await Sponsorship.shouldSponsor({ sender, transaction, validate }))) {
          // Re-fill without feePayer so gas/nonce are correct for self-payment.
          const fillRequest = Utils.formatFillTransactionRequest(client, {
            ...normalized,
            ...(typeof chainId !== 'undefined' ? { chainId } : {}),
          })
          const result = (await client.request({
            method: 'eth_fillTransaction' as never,
            params: [fillRequest],
          })) as { tx?: Record<string, unknown> | undefined }
          transaction = Utils.normalizeTempoTransaction(result.tx)

          return Utils.rpcResult(request, {
            tx: core_Transaction.toRpc(transaction as core_Transaction.Transaction),
          })
        }

        const signed = await Sponsorship.sign({ account, transaction, sender })

        return Utils.rpcResult(request, {
          sponsor,
          tx: core_Transaction.toRpc(signed as core_Transaction.Transaction),
        })
      }

      const result = await Sponsorship.handleRawTransaction({
        account,
        getClient,
        method,
        request,
        validate,
      })

      return Response.json(RpcResponse.from({ result }, { request }))
    } catch (error) {
      return Utils.rpcError(request, error)
    }
  })

  return router
}

export declare namespace feePayer {
  /**
   * @deprecated Use `relay.Options` or `relay.Options['feePayer']` instead.
   */
  type Options = from.Options & {
    /** Account to use as the fee payer. */
    account: LocalAccount
    /**
     * Supported chains. The handler resolves the client based on the
     * `chainId` in the incoming transaction.
     * @default [tempo, tempoModerato]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Function to call before handling the request. */
    onRequest?: (request: RpcRequest.RpcRequest) => Promise<void>
    /** Path to use for the handler. */
    path?: string | undefined
    /**
     * Validates whether to sponsor the transaction. When omitted, all
     * transactions are sponsored. Return `false` to reject sponsorship.
     */
    validate?: ((request: Transaction.TransactionRequest) => boolean | Promise<boolean>) | undefined
    /** Sponsor display name returned from `eth_fillTransaction`. */
    name?: string | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
    /** Sponsor URL returned from `eth_fillTransaction`. */
    url?: string | undefined
  }
}

/** Signs a filled transaction as the fee payer. */
export async function sign(options: Sponsorship.sign.Options) {
  return await Sponsorship.sign(options)
}
