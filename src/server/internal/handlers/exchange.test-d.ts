import { hc } from 'hono/client'
import type { ExtractSchema } from 'hono/types'
import type { Address } from 'viem'
import { describe, expectTypeOf, test } from 'vp/test'

import { compose } from '../../Handler.js'
import { exchange } from './exchange.js'

describe('exchange handler', () => {
  test('the route schema captures `POST /exchange/quote` input + output', () => {
    type Schema = ExtractSchema<ReturnType<typeof exchange>>

    type QuoteRoute = Schema['/exchange/quote']['$post']

    expectTypeOf<QuoteRoute['input']>().toMatchTypeOf<{
      json: {
        amount: string
        chainId?: number | undefined
        input: string
        output: string
        slippage: number
        type: 'buy' | 'sell'
      }
    }>()
  })

  test('typed client has direct access at `client.exchange.quote.$post`', () => {
    const handler = exchange()
    const client = hc<typeof handler>('http://localhost')

    // Direct access — autocomplete-friendly. No `NonNullable<>` workaround.
    expectTypeOf(client.exchange.quote.$post).toBeFunction()

    type Args = Parameters<typeof client.exchange.quote.$post>[0]
    expectTypeOf<Args['json']>().toMatchTypeOf<{
      amount: string
      chainId?: number | undefined
      input: string
      output: string
      slippage: number
      type: 'buy' | 'sell'
    }>()
  })

  test('typed client exposes `client.exchange.tokens.$get` with optional `chainId` query', async () => {
    const handler = exchange()
    const client = hc<typeof handler>('http://localhost')

    expectTypeOf(client.exchange.tokens.$get).toBeFunction()

    type Args = Parameters<typeof client.exchange.tokens.$get>[0]
    expectTypeOf<Args['query']>().toMatchTypeOf<{ chainId?: string | undefined }>()

    const res = await client.exchange.tokens.$get({ query: {} })
    if (res.status === 200) {
      const body = await res.json()
      expectTypeOf(body).toMatchTypeOf<{
        tokens: readonly {
          address: `0x${string}`
          decimals: number
          name: string
          symbol: string
        }[]
      }>()
    }
  })

  test('success response is inferred from `schema.quote.returns`', () => {
    const handler = exchange()
    const client = hc<typeof handler>('http://localhost')

    type Response = Awaited<ReturnType<typeof client.exchange.quote.$post>>
    type Body = Response extends { json: () => Promise<infer B> } ? B : never

    expectTypeOf<Body>().toMatchTypeOf<
      | {
          calls: readonly { data: `0x${string}`; to: Address }[]
          input: { amount: string; name: string; symbol: string; token: Address }
          output: { amount: string; name: string; symbol: string; token: Address }
          slippage: number
          type: 'buy' | 'sell'
        }
      | { error: string; issues: { message: string; path: string }[] }
      | { error: string; data?: unknown }
    >()
  })
})

describe('compose', () => {
  test('preserves the route schema under the mount path', () => {
    const composed = compose([exchange()], { path: '/api' })
    type Schema = ExtractSchema<typeof composed>

    type QuoteRoute = Schema['/api/exchange/quote']['$post']

    expectTypeOf<QuoteRoute['input']>().toMatchTypeOf<{
      json: {
        amount: string
        chainId?: number | undefined
        input: string
        output: string
        slippage: number
        type: 'buy' | 'sell'
      }
    }>()
  })

  test('typed client has direct access at `client.api.exchange.quote.$post`', () => {
    const composed = compose([exchange()], { path: '/api' })
    const client = hc<typeof composed>('http://localhost')

    // Direct access — autocomplete-friendly.
    expectTypeOf(client.api.exchange.quote.$post).toBeFunction()

    type Args = Parameters<typeof client.api.exchange.quote.$post>[0]
    expectTypeOf<Args['json']>().toMatchTypeOf<{
      amount: string
      chainId?: number | undefined
      input: string
      output: string
      slippage: number
      type: 'buy' | 'sell'
    }>()
  })

  test('default mount path `/` exposes routes at the root', () => {
    const composed = compose([exchange()])
    const client = hc<typeof composed>('http://localhost')

    expectTypeOf(client.exchange.quote.$post).toBeFunction()
  })

  test('typed client merges multiple sub-handlers', () => {
    // Two exchange handlers at distinct paths to exercise schema merging.
    const composed = compose([exchange({ path: '/a' }), exchange({ path: '/b' })], {
      path: '/api',
    })
    const client = hc<typeof composed>('http://localhost')

    expectTypeOf(client.api.a.quote.$post).toBeFunction()
    expectTypeOf(client.api.b.quote.$post).toBeFunction()
  })

  test('success response inference flows through compose', () => {
    const composed = compose([exchange()], { path: '/api' })
    const client = hc<typeof composed>('http://localhost')

    type Response = Awaited<ReturnType<typeof client.api.exchange.quote.$post>>
    type Body = Response extends { json: () => Promise<infer B> } ? B : never

    expectTypeOf<Body>().toMatchTypeOf<
      | {
          calls: readonly { data: `0x${string}`; to: Address }[]
          input: { amount: string; name: string; symbol: string; token: Address }
          output: { amount: string; name: string; symbol: string; token: Address }
          slippage: number
          type: 'buy' | 'sell'
        }
      | { error: string; issues: { message: string; path: string }[] }
      | { error: string; data?: unknown }
    >()
  })
})
