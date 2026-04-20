import { Handler } from 'accounts/server'
import { Hono } from 'hono'
import type { Address } from 'ox'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'

import * as Account from './lib/db/account.js'
import * as Db from './lib/db/index.js'
import * as Wallet from './lib/db/wallet.js'
import * as Middleware from './lib/middleware.js'

const handler = Handler.codeAuth({
  cors: false,
  path: '/api/auth/cli',
  chains: [tempo, tempoModerato, tempoDevnet],
})

export const auth = new Hono<{ Bindings: Env }>()
  /** `GET /me` — return the current session's address, email, and username. */
  .get('/me', Middleware.requireSession(), async (c) => {
    const { address } = c.var.session
    const db = Db.get(c.env.HYPERDRIVE)
    const [account, wallet] = await Promise.all([
      Account.getByAddress(db, address as Address.Address),
      Wallet.getByAddress(db, address as Address.Address),
    ])
    return c.json({
      address,
      email: account?.email ?? null,
      username: wallet?.username ?? null,
    })
  })
  /** `GET /cli` — redirect browser approval visits to the standalone CLI page. */
  .get('/cli', (c) => {
    const requestUrl = new URL(c.req.url)
    const search = requestUrl.search
    return c.redirect(`/auth/cli${search}`, 302)
  })
  /** `GET /cli/pending/:code` — return a pending CLI auth request. */
  .get('/cli/pending/:code', (c) => handler.fetch(c.req.raw))
  /** `POST /cli/code` — create a new CLI auth device code. */
  .post('/cli/code', (c) => handler.fetch(c.req.raw))
  /** `POST /cli/poll/:code` — poll the current CLI auth device code. */
  .post('/cli/poll/:code', (c) => handler.fetch(c.req.raw))
  /** `POST /cli` — authorize a pending CLI auth request. */
  .post('/cli', (c) => handler.fetch(c.req.raw))
