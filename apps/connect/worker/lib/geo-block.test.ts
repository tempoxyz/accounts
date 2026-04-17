import { describe, expect, test } from 'vp/test'

import { handleGeoBlock, isBlockedRegion } from './geo-block.js'

describe('isBlockedRegion', () => {
  test('blocks the sanctioned country list', () => {
    expect(
      ['BY', 'CU', 'IR', 'KP', 'MM', 'RU', 'SY', 'UA', 'VE'].map((country) => ({
        blocked: isBlockedRegion(country),
        country,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "blocked": true,
          "country": "BY",
        },
        {
          "blocked": true,
          "country": "CU",
        },
        {
          "blocked": true,
          "country": "IR",
        },
        {
          "blocked": true,
          "country": "KP",
        },
        {
          "blocked": true,
          "country": "MM",
        },
        {
          "blocked": true,
          "country": "RU",
        },
        {
          "blocked": true,
          "country": "SY",
        },
        {
          "blocked": true,
          "country": "UA",
        },
        {
          "blocked": true,
          "country": "VE",
        },
      ]
    `)
  })

  test('allows non-blocked countries and missing country data', () => {
    expect(
      ['US', 'GB', 'DE', 'JP', 'BR', null].map((country) => ({
        blocked: isBlockedRegion(country),
        country,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "blocked": false,
          "country": "US",
        },
        {
          "blocked": false,
          "country": "GB",
        },
        {
          "blocked": false,
          "country": "DE",
        },
        {
          "blocked": false,
          "country": "JP",
        },
        {
          "blocked": false,
          "country": "BR",
        },
        {
          "blocked": false,
          "country": null,
        },
      ]
    `)
  })
})

describe('handleGeoBlock', () => {
  test('returns 451 for blocked countries from the Cloudflare header', async () => {
    const res = handleGeoBlock(
      new Request('https://connect.tempo.xyz/', { headers: { 'cf-ipcountry': 'IR' } }),
    )

    const body = await res?.text()

    expect({
      body: body?.includes('This site can’t be reached') && body?.includes('Tempo Connect is not available in your region at this time.'),
      cacheControl: res?.headers.get('Cache-Control'),
      contentType: res?.headers.get('Content-Type'),
      status: res?.status,
      vary: res?.headers.get('Vary'),
    }).toMatchInlineSnapshot(`
      {
        "body": true,
        "cacheControl": "no-store",
        "contentType": "text/html; charset=utf-8",
        "status": 451,
        "vary": "CF-IPCountry",
      }
    `)
  })

  test('returns 451 for blocked countries from request.cf', () => {
    const req = new Request('https://connect.tempo.xyz/')
    Object.defineProperty(req, 'cf', { value: { country: 'CU' }, writable: false })

    expect(handleGeoBlock(req)?.status).toMatchInlineSnapshot(`451`)
  })

  test('returns null for allowed countries', () => {
    expect(
      handleGeoBlock(
        new Request('https://connect.tempo.xyz/', { headers: { 'cf-ipcountry': 'US' } }),
      ),
    ).toMatchInlineSnapshot(`null`)
  })

  test('returns null when country data is missing', () => {
    expect(handleGeoBlock(new Request('https://connect.tempo.xyz/'))).toMatchInlineSnapshot(`null`)
  })

  test('returns an empty body for HEAD requests', async () => {
    const res = handleGeoBlock(
      new Request('https://connect.tempo.xyz/', {
        method: 'HEAD',
        headers: { 'cf-ipcountry': 'SY' },
      }),
    )

    expect({ body: await res?.text(), status: res?.status }).toMatchInlineSnapshot(`
      {
        "body": "",
        "status": 451,
      }
    `)
  })
})
