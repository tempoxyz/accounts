import { zValidator } from '@hono/zod-validator'
import { CliAuth } from 'accounts/server'
import { Hono } from 'hono'
import { Bytes } from 'ox'
import * as z from 'zod/mini'

const store = CliAuth.Store.memory()

const cliAuth = CliAuth.from({
  store,
  random: Bytes.random,
  policy: CliAuth.Policy.allow(),
})

export const cli = new Hono<{ Bindings: Env }>()
  .get('/', (c) => c.redirect('/auth/cli'))
  .post('/code', zValidator('json', CliAuth.createRequest), async (c) => {
    const request = c.req.valid('json')
    const result = await cliAuth.createDeviceCode({ request })
    return c.json(result)
  })
  .post('/authorize', zValidator('json', CliAuth.authorizeRequest), async (c) => {
    const request = c.req.valid('json')
    const result = await cliAuth.authorize({ request })
    return c.json(result)
  })
  .post(
    '/poll/:code',
    zValidator('param', z.object({ code: z.string() })),
    zValidator('json', CliAuth.pollRequest),
    async (c) => {
      const { code } = c.req.valid('param')
      const request = c.req.valid('json')
      const result = await cliAuth.poll({ request, code })
      return c.json(result)
    },
  )
  .get('/pending/:code', zValidator('param', z.object({ code: z.string() })), async (c) => {
    const { code } = c.req.valid('param')
    const result = await cliAuth.pending({ code })
    return c.json(result)
  })
