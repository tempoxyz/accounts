import * as path from 'node:path'
import { createClient, http } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { defineConfig, type Plugin } from 'vp'

import { Handler } from '../src/server/index.js'

const port = Number(process.env.PORT ?? 5180)

/** SDK source to build against instead of this checkout's, such as main's for the baseline app. */
const src = process.env.ACCOUNTS_SRC

/**
 * Serves `Handler.auth` at `/auth` from the dev and preview servers, so the SIWE cases have a
 * server to sign in to. Both bench apps (head and `/base/`) share it, since they share an origin.
 */
function auth(): Plugin {
  const handler = Handler.auth({
    getClient: () => createClient({ chain: tempoModerato, transport: http() }),
    path: '/auth',
    // Binds each challenge to the host the page was served from (localhost, 127.0.0.1, a LAN IP).
    trustProxy: true,
  })
  const listener = (req: { url?: string | undefined }, res: unknown, next: () => void) => {
    if (req.url === '/auth' || req.url?.startsWith('/auth/')) return handler.listener(req, res)
    next()
  }
  // Mounted ahead of Vite's own middlewares, whose localhost-only CORS would otherwise answer the
  // Tempo Wallet page's preflight. `Handler.auth` sends its own CORS headers, on `/auth` only.
  const mount = (server: { middlewares: { stack: { handle: unknown; route: string }[] } }) =>
    void server.middlewares.stack.unshift({ handle: listener, route: '' })
  return { configurePreviewServer: mount, configureServer: mount, name: 'bench-auth' }
}

export default defineConfig({
  plugins: [auth()],
  preview: { port, strictPort: true },
  ...(src
    ? { resolve: { alias: [{ find: /^accounts$/, replacement: path.resolve(src, 'index.ts') }] } }
    : {}),
  server: { port, strictPort: true },
})
