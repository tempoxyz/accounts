import { afterEach, describe, expect, test, vi } from 'vp/test'

import { handleOidcProxy } from '../../playgrounds/web/worker/oidc-proxy.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/oidc-proxy', () => {
  test('proxies Tempo OIDC discovery responses through the playground worker', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ issuer: 'http://wallet.tempo.local' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )

    const response = await handleOidcProxy(
      new Request(
        'https://playground.tempo.local/oidc-proxy?url=http%3A%2F%2Fwallet.tempo.local%2F.well-known%2Fopenid-configuration',
      ),
    )

    expect({
      body: await response.json(),
      status: response.status,
      url: String(fetch.mock.calls[0]?.[0]),
    }).toMatchInlineSnapshot(`
      {
        "body": {
          "issuer": "http://wallet.tempo.local",
        },
        "status": 200,
        "url": "http://wallet.tempo.local/.well-known/openid-configuration",
      }
    `)
  })

  test('rejects non-Tempo OIDC targets', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    const response = await handleOidcProxy(
      new Request(
        'https://playground.tempo.local/oidc-proxy?url=https%3A%2F%2Fevil.example%2F.well-known%2Fopenid-configuration',
      ),
    )

    expect(fetch).not.toHaveBeenCalled()
    expect({ body: await response.json(), status: response.status }).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "Only Tempo OIDC URLs are allowed.",
        },
        "status": 400,
      }
    `)
  })
})
