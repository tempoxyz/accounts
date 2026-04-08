import { Handler, Kv } from 'accounts/server'
import { Mppx, tempo } from 'mppx/server'
import { privateKeyToAccount } from 'viem/accounts'

import { handler as cliAuth } from './cli-auth.js'

const allowedOrigins = new Set(
  [process.env.VITE_WALLET_DIALOG_HOST, process.env.VITE_REF_DIALOG_HOST]
    .filter(Boolean)
    .map((url) => new URL(url!).origin),
)

const payment = Mppx.create({
  methods: [
    tempo.charge({
      currency: '0x20c0000000000000000000000000000000000000',
      recipient: '0x0000000000000000000000000000000000000001',
      testnet: process.env.VITE_ENV === 'testnet',
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY,
})

const feePayer = Handler.feePayer({
  account: privateKeyToAccount(process.env.PRIVATE_KEY),
  path: '/fee-payer',
})

const handler = Handler.compose([
  cliAuth,
  Handler.webAuthn({
    kv: Kv.memory(),
    origin: process.env.ORIGIN,
    path: '/webauthn',
    rpId: process.env.RP_ID,
  }),
])

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/fee-payer') {
      if (request.method === 'OPTIONS')
        return withCors(request, new Response(null, { status: 204 }))

      return withCors(request, await feePayer.fetch(request))
    }

    if (url.pathname === '/zero-dollar-auth') {
      const result = await payment.charge({
        amount: '0',
      })(request)

      if (result.status === 402) return result.challenge

      return result.withReceipt(Response.json({ authenticated: true }))
    }

    if (url.pathname === '/fortune') {
      const result = await payment.charge({
        amount: '0.01',
      })(request)

      if (result.status === 402) return result.challenge

      return result.withReceipt(
        Response.json({ fortune: 'Your code will compile on the first try.' }),
      )
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>

function withCors(request: Request, response: Response) {
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins.has(origin)) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.append('Vary', 'Origin')

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
