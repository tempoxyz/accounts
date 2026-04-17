import { Handler } from 'accounts/server'
import { Hono } from 'hono'
import { tempo, tempoDevnet, tempoModerato } from 'viem/chains'

const handler = Handler.codeAuth({
  cors: false,
  chains: [tempo, tempoModerato, tempoDevnet],
  path: '/cli',
})

export const cli = new Hono<{ Bindings: Env }>()
  .get('/', (c) => fetch(new Request(new URL('/', c.req.url), c.req.raw)))
  .on(['GET', 'POST'], '/*', (c) => handler.fetch(c.req.raw))
