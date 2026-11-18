/**
 * The merchant, in the Worker that serves the page. Each endpoint answers a request without a
 * payment with a 402 charge challenge, and serves its content for a credential that pays it.
 * mppx verifies the credential and broadcasts its transfer, so the merchant needs no key of its own.
 * @module
 */
import { Hono } from 'hono'
import { Mppx, tempo } from 'mppx/hono'
import type { Address } from 'viem'
import { Addresses } from 'viem/tempo'

/**
 * The charges of the merchant, in OUSD on Tempo testnet. Each isolate holds one, and with it the
 * in-memory store of the credentials that it accepted. A deployment with more than one isolate
 * passes a shared atomic `store`, so no credential pays twice.
 */
const mppx = Mppx.create({
  methods: [
    tempo.charge({
      currencies: [Addresses.ousd],
      recipient: process.env.RECIPIENT as Address,
      testnet: true,
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY,
})

/** The fortunes, of which each paid request serves one. */
const fortunes = [
  'A small payment opens a large door.',
  'The access key that spends little spends well.',
  'Today a 402 turns into a 200.',
] as const

// The page's assets never reach the Worker, since `run_worker_first` sends it only `/v1/*`.
export default new Hono()
  .get('/v1/fortune', mppx.charge({ amount: '0.01' }), (c) => {
    const index = crypto.getRandomValues(new Uint32Array(1))[0]!
    return c.json({ fortune: fortunes[index % fortunes.length] })
  })
  // The charge is above the access key's limit of 1 OUSD, so the access key cannot pay it.
  .get('/v1/report', mppx.charge({ amount: '5' }), (c) =>
    c.json({ report: 'The full report, which costs 5 OUSD.' }),
  )
