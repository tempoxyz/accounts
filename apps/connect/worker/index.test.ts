import { describe, expect, test, vi } from 'vp/test'

import { app } from './index.js'

type RuntimeEnv = Env & {
  ASSETS: {
    fetch: typeof fetch
  }
}

function createEnv(fetchAssets: (request: Request) => Promise<Response>): RuntimeEnv {
  return { ASSETS: { fetch: fetchAssets as unknown as typeof fetch } } as unknown as RuntimeEnv
}

describe('worker app', () => {
  test('delegates allowed view requests to static assets', async () => {
    const assets = vi.fn(
      async (request: Request) => new Response(`asset:${new URL(request.url).pathname}`),
    )

    const res = await app.fetch(
      new Request('https://connect.tempo.xyz/', { headers: { 'cf-ipcountry': 'US' } }),
      createEnv(assets),
    )

    expect({
      assetCalls: assets.mock.calls.length,
      body: await res.text(),
      status: res.status,
    }).toMatchInlineSnapshot(`
      {
        "assetCalls": 1,
        "body": "asset:/",
        "status": 200,
      }
    `)
  })

  test('blocks geo-restricted view requests before asset fallback', async () => {
    const assets = vi.fn(
      async (request: Request) => new Response(`asset:${new URL(request.url).pathname}`),
    )

    const res = await app.fetch(
      new Request('https://connect.tempo.xyz/', { headers: { 'cf-ipcountry': 'IR' } }),
      createEnv(assets),
    )

    expect({
      assetCalls: assets.mock.calls.length,
      bodyIncludesMessage: (await res.text()).includes(
        'Tempo Connect is not available in your region at this time.',
      ),
      status: res.status,
    }).toMatchInlineSnapshot(`
      {
        "assetCalls": 0,
        "bodyIncludesMessage": true,
        "status": 451,
      }
    `)
  })

  test('blocks geo-restricted API requests too', async () => {
    const assets = vi.fn(async () => new Response('asset'))

    const res = await app.fetch(
      new Request('https://connect.tempo.xyz/api/health', { headers: { 'cf-ipcountry': 'KP' } }),
      createEnv(assets),
    )

    expect({ assetCalls: assets.mock.calls.length, status: res.status }).toMatchInlineSnapshot(`
      {
        "assetCalls": 0,
        "status": 451,
      }
    `)
  })

  test('keeps unknown API routes as 404 instead of falling back to assets', async () => {
    const assets = vi.fn(async () => new Response('asset'))

    const res = await app.fetch(
      new Request('https://connect.tempo.xyz/api/missing', { headers: { 'cf-ipcountry': 'US' } }),
      createEnv(assets),
    )

    expect({
      assetCalls: assets.mock.calls.length,
      body: await res.text(),
      status: res.status,
    }).toMatchInlineSnapshot(`
      {
        "assetCalls": 0,
        "body": "Not Found",
        "status": 404,
      }
    `)
  })

  test('falls through to assets for unknown non-API paths', async () => {
    const assets = vi.fn(
      async (request: Request) => new Response(`asset:${new URL(request.url).pathname}`),
    )

    const res = await app.fetch(
      new Request('https://connect.tempo.xyz/some/new/route', {
        headers: { 'cf-ipcountry': 'US' },
      }),
      createEnv(assets),
    )

    expect({
      assetCalls: assets.mock.calls.length,
      body: await res.text(),
      status: res.status,
    }).toMatchInlineSnapshot(`
      {
        "assetCalls": 1,
        "body": "asset:/some/new/route",
        "status": 200,
      }
    `)
  })

  test('returns 404 for unknown .well-known routes', async () => {
    const assets = vi.fn(async () => new Response('asset'))

    const res = await app.fetch(
      new Request('https://connect.tempo.xyz/.well-known/missing', {
        headers: { 'cf-ipcountry': 'US' },
      }),
      createEnv(assets),
    )

    expect({
      assetCalls: assets.mock.calls.length,
      body: await res.text(),
      status: res.status,
    }).toMatchInlineSnapshot(`
      {
        "assetCalls": 0,
        "body": "Not Found",
        "status": 404,
      }
    `)
  })
})
