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
    origin: `http://localhost:${port}`,
    path: '/auth',
  })
  const listener = (req: { url?: string | undefined }, res: unknown, next: () => void) => {
    if (req.url === '/auth' || req.url?.startsWith('/auth/')) return handler.listener(req, res)
    next()
  }
  return {
    configurePreviewServer: (server) => void server.middlewares.use(listener),
    configureServer: (server) => void server.middlewares.use(listener),
    name: 'bench-auth',
  }
}

export default defineConfig({
  plugins: [auth()],
  // The Tempo Wallet page fetches the SIWE challenge from its own origin.
  preview: { cors: true, port, strictPort: true },
  ...(src
    ? { resolve: { alias: [{ find: /^accounts$/, replacement: path.resolve(src, 'index.ts') }] } }
    : {}),
  server: { cors: true, port, strictPort: true },
})
