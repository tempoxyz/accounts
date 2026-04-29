import { hc } from 'hono/client'
import type { ExtractSchema } from 'hono/types'
import { http, type Chain, type Transport } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
import { describe, expectTypeOf, test } from 'vp/test'

import * as Handler from './Handler.js'

describe('codeAuth options', () => {
  test('supports chain-agnostic chains/transports configuration', () => {
    expectTypeOf<Handler.codeAuth.Options>().toMatchTypeOf<{
      chains?: readonly [Chain, ...Chain[]] | undefined
      transports?: Record<number, Transport> | undefined
    }>()
  })

  test('accepts derived clients from chains/transports', () => {
    void Handler.codeAuth({
      chains: [tempo, tempoModerato],
      transports: {
        [tempo.id]: http('https://rpc.tempo.xyz'),
        [tempoModerato.id]: http('https://rpc.moderato.tempo.xyz'),
      },
    })
  })
})

describe('compose', () => {
  // Two ad-hoc schema-typed handlers to exercise schema merging.
  function makeAlpha() {
    const router = Handler.from()
    const app = router.post('/alpha/ping', async (c) => c.json({ pong: 'alpha' as const }))
    return app as Handler.Handler<typeof app>
  }

  function makeBeta() {
    const router = Handler.from()
    const app = router.get('/beta/echo', async (c) => c.json({ echo: 'beta' as const }))
    return app as Handler.Handler<typeof app>
  }

  test('merges route schemas under the mount path', () => {
    const composed = Handler.compose([makeAlpha(), makeBeta()], { path: '/api' })
    type Schema = ExtractSchema<typeof composed>

    type AlphaPost = Schema['/api/alpha/ping']['$post']
    type BetaGet = Schema['/api/beta/echo']['$get']

    // Both routes survive the merge.
    expectTypeOf<AlphaPost>().toBeObject()
    expectTypeOf<BetaGet>().toBeObject()
  })

  test('typed client exposes both handlers via direct property access', () => {
    const composed = Handler.compose([makeAlpha(), makeBeta()], { path: '/api' })
    const client = hc<typeof composed>('http://localhost')

    // Direct, autocomplete-friendly access.
    expectTypeOf(client.api.alpha.ping.$post).toBeFunction()
    expectTypeOf(client.api.beta.echo.$get).toBeFunction()
  })

  test('default mount path `/` exposes routes at the root', () => {
    const composed = Handler.compose([makeAlpha(), makeBeta()])
    const client = hc<typeof composed>('http://localhost')

    expectTypeOf(client.alpha.ping.$post).toBeFunction()
    expectTypeOf(client.beta.echo.$get).toBeFunction()
  })

  test('response bodies stay typed end-to-end after compose', async () => {
    const composed = Handler.compose([makeAlpha(), makeBeta()], { path: '/api' })
    const client = hc<typeof composed>('http://localhost')

    const alphaRes = await client.api.alpha.ping.$post()
    if (alphaRes.status === 200) {
      const body = await alphaRes.json()
      expectTypeOf(body).toMatchTypeOf<{ pong: 'alpha' }>()
    }

    const betaRes = await client.api.beta.echo.$get()
    if (betaRes.status === 200) {
      const body = await betaRes.json()
      expectTypeOf(body).toMatchTypeOf<{ echo: 'beta' }>()
    }
  })

  test('different mount paths are reflected in the composed schema', () => {
    const a = Handler.compose([makeAlpha()], { path: '/v1' })
    const b = Handler.compose([makeBeta()], { path: '/v2' })

    type SchemaA = ExtractSchema<typeof a>
    type SchemaB = ExtractSchema<typeof b>

    expectTypeOf<SchemaA['/v1/alpha/ping']['$post']>().toBeObject()
    expectTypeOf<SchemaB['/v2/beta/echo']['$get']>().toBeObject()
  })

  test('handlers without a route schema (legacy `Handler`) compose without errors', () => {
    // `Handler.codeAuth` returns plain `Handler` (default `Hono`), no route
    // schema. Mixing it with typed handlers must not break inference for the
    // typed siblings.
    const codeAuth = Handler.codeAuth() as unknown as Handler.Handler
    const composed = Handler.compose([codeAuth, makeAlpha()], { path: '/api' })
    const client = hc<typeof composed>('http://localhost')

    expectTypeOf(client.api.alpha.ping.$post).toBeFunction()
  })
})
