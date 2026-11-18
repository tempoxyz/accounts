/**
 * Serves the routes of the demos of "Payments", under `/api/payments`. The topic holds one paid
 * route, which charges 0.01 OUSD on Tempo testnet through the Machine Payments Protocol (MPP).
 * @module
 */
import { env } from 'cloudflare:workers'
import { Mppx, Store as MppxStore, tempo } from 'mppx/server'
import { Addresses } from 'viem/tempo'
import * as Store from './Store.ts'

declare global {
  namespace Cloudflare {
    /** The Worker's bindings, which `env` from `cloudflare:workers` holds. */
    interface Env {
      /**
       * The secret that binds each 402 challenge of the paid route to its content, of at least 32
       * bytes. Absent, the paid route answers 503.
       */
      MPP_SECRET_KEY?: string
    }
  }
}

/** Path that each route of the topic starts with. */
export const path = '/api/payments'

/** The fortunes, of which each paid request serves one. */
const fortunes = [
  'A small payment opens a large door.',
  'The access key that spends little spends well.',
  'Today a 402 turns into a 200.',
] as const

/** Recipient of each charge, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/** Answers a request to a route of the topic. */
export function fetch(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url)

  if (request.method === 'GET' && pathname === `${path}/fortune`)
    return fortune(request)
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/**
 * Serves one fortune for a credential that pays 0.01 OUSD, with the receipt of the payment in the
 * `Payment-Receipt` header. Answers a request without a credential with a 402 charge challenge,
 * and 503 without the `MPP_SECRET_KEY` secret.
 */
async function fortune(request: Request): Promise<Response> {
  if (!env.MPP_SECRET_KEY)
    return Response.json({ error: 'secret_required' }, { status: 503 })

  // mppx refuses instance-local state on Workers, so it keeps the credentials that it accepted in
  // the Worker's KV namespace. KV has no atomic update, so two concurrent requests with one
  // credential can both pass, which the demo allows. A deployment that sells content passes an
  // atomic store, so no credential pays twice.
  const credentials = Store.create({ prefix: 'payments:charge:' })
  const get = async (key: string) =>
    ((await credentials.getItem(key)) as string | undefined) ?? null
  const put = (key: string, value: string) =>
    Promise.resolve(credentials.setItem(key, value))
  const remove = (key: string) => Promise.resolve(credentials.removeItem(key))
  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        currencies: [Addresses.ousd],
        recipient,
        store: MppxStore.cloudflare({
          delete: remove,
          get,
          put,
          update: async (key, fn) => {
            const change = fn(await get(key))
            if (change.op === 'set') await put(key, change.value)
            if (change.op === 'delete') await remove(key)
            return change.result
          },
        }),
        testnet: true,
      }),
    ],
    secretKey: env.MPP_SECRET_KEY,
  })

  const result = await mppx.charge({ amount: '0.01' })(request)
  if (result.status === 402) return result.challenge

  const index = crypto.getRandomValues(new Uint32Array(1))[0]!
  return result.withReceipt(
    Response.json({ fortune: fortunes[index % fortunes.length] }),
  )
}
