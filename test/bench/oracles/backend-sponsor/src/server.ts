/**
 * The oracle of `backend` × `sponsor`: the starter's server, with sign-in routes and a transfer
 * whose fee the app's fee payer pays.
 * @module
 */
import { serve } from '@hono/node-server'
import { Accounts, Store } from 'accounts'
import { backend, viem } from 'accounts/plugins'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { html } from 'hono/html'
import { http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: tempoLocalnet.id,
  clientId: process.env.APP_URL,
  plugins: [
    backend({ store: Store.memory() }),
    viem({ chain: tempoLocalnet, transport: http('http://localhost:9545/1') }),
  ],
  url: 'http://localhost:8787',
})
const sponsored = true

const app = new Hono()
app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
app.get('/', async (c) => {
  const session = await accounts.session.get(c.req.raw)
  if (session?.method !== 'tempo-id')
    return c.html(html`<a href="/api/auth/login">Sign in</a>`)
  return c.html(
    html`<p>${session.user.email}</p>
      <p>${session.accessKey?.account}</p>
      <form action="/send" method="post"><button>Send 1 OUSD</button></form>`,
  )
})
// A form post of another origin, also of the same site, sends no transfer.
app.use('/send', csrf({ origin: process.env.APP_URL! }))
app.post('/send', async (c) => {
  const session = await accounts.session.get(c.req.raw)
  if (session?.method !== 'tempo-id') return c.redirect('/', 302)
  const { receipt } = await accounts.viem({ session }).token.transferSync({
    amount: parseUnits('1', 6),
    to: '0x000000000000000000000000000000000000dEaD',
    token: Addresses.ousd,
    ...(sponsored
      ? {
          feePayer: privateKeyToAccount(
            process.env.FEE_PAYER_PRIVATE_KEY as `0x${string}`,
          ),
        }
      : {}),
  })
  return c.text(`Sent in ${receipt.transactionHash}.`)
})

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) })
