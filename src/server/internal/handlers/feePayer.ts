import { RpcRequest, RpcResponse, Signature } from 'ox'
import { Transaction as core_Transaction, TxEnvelopeTempo } from 'ox/tempo'
import type { Address, Chain, Client, Transport } from 'viem'
import { createClient, http } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { signTransaction } from 'viem/actions'
import { tempo, tempoModerato } from 'viem/chains'
import { Transaction } from 'viem/tempo'

import { type Handler, from } from '../../Handler.js'
import * as Utils from './utils.js'

/**
 * Instantiates a fee payer service request handler that can be used to
 * sponsor the fee for user transactions.
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

  const sponsor = {
    address: account.address,
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
  }

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
          if (isPreparedFeePayerTransaction(parameters))
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

        if (
          validate &&
          // @ts-expect-error - TODO: Convert to `TransactionRequest` properly.
          !(await validate({
            ...transaction,
            from: sender,
          } as Transaction.TransactionRequest))
        ) {
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

        const signed = await sign({ account, transaction, sender })

        return Utils.rpcResult(request, {
          sponsor,
          tx: core_Transaction.toRpc(signed as core_Transaction.Transaction),
        })
      }

      const serialized = request.params?.[0] as `0x76${string}` | undefined

      if (!serialized?.startsWith('0x76') && !serialized?.startsWith('0x78'))
        throw new RpcResponse.InvalidParamsError({
          message: 'Only Tempo (0x76/0x78) transactions are supported.',
        })

      const transaction = Transaction.deserialize(serialized)

      if (!transaction.signature || !transaction.from)
        throw new RpcResponse.InvalidParamsError({
          message: 'Transaction must be signed by the sender before fee payer signing.',
        })

      if (validate && !(await validate(transaction as Transaction.TransactionRequest)))
        throw new RpcResponse.InvalidParamsError({
          message: 'Sponsorship rejected.',
        })

      const client = getClient(transaction.chainId)
      const serializedTransaction = toSerializedTransaction(
        await signTransaction(client, {
          ...transaction,
          account,
          feePayer: account,
        } as never),
      )

      if (method === 'eth_signRawTransaction')
        return Response.json(RpcResponse.from({ result: serializedTransaction }, { request }))

      const result = await client.request({
        method: method as never,
        params: [serializedTransaction],
      })

      return Response.json(RpcResponse.from({ result }, { request }))
    } catch (error) {
      return Utils.rpcError(request, error)
    }
  })

  return router
}

export declare namespace feePayer {
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
export async function sign(options: {
  account: LocalAccount
  transaction: Record<string, unknown>
  sender?: `0x${string}` | undefined
}) {
  const { account, transaction, sender } = options
  const from = (transaction.from as `0x${string}` | undefined) ?? sender
  const { signature: _, ...withoutSenderSig } = transaction
  const prepared = { ...withoutSenderSig, from }

  if (!prepared.from)
    throw new RpcResponse.InvalidParamsError({
      message: 'Transaction sender must be provided before fee payer signing.',
    })
  if (!account.sign) throw new Error('Fee payer account cannot sign transactions.')

  const feePayerSignature = Signature.from(
    await account.sign({
      hash: TxEnvelopeTempo.getFeePayerSignPayload(TxEnvelopeTempo.from(prepared as never), {
        sender: prepared.from,
      }),
    }),
  )

  return { ...prepared, feePayerSignature }
}

function isPreparedFeePayerTransaction(value: Record<string, unknown>) {
  return (
    typeof value.from === 'string' &&
    typeof Utils.resolveChainId(value.chainId) === 'number' &&
    typeof value.gas !== 'undefined' &&
    typeof value.nonce !== 'undefined' &&
    (typeof value.maxFeePerGas !== 'undefined' || typeof value.gasPrice !== 'undefined')
  )
}

function toSerializedTransaction(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'raw' in value && typeof value.raw === 'string')
    return value.raw
  throw new Error('Expected a serialized transaction result.')
}
