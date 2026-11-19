/**
 * Tests the headers of a request that sends an access token, as `Actions.fetch` and `backend.fetch`
 * build them, the requests to Tempo ID that carry a secret, and the read of a challenge signature
 * from Tempo ID's response, and the refusal of a token response without an access token or a
 * lifetime.
 * @module
 */
import { decodeJwt } from 'jose'
import { Base64 } from 'ox'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import type { RequestError } from '../Accounts.js'
import * as Api from './Api.js'
import * as Dpop from './Dpop.js'

const base64url = { pad: false, url: true } as const

describe('requestHeaders', () => {
  test('drops a DPoP header of init beside a Bearer token', () => {
    const headers = Api.requestHeaders(
      { dpop: 'proof-of-the-browser' },
      { tokenHeaders: { authorization: 'Bearer access-token' } },
    )

    expect(Object.fromEntries(headers)).toMatchInlineSnapshot(`
      {
        "authorization": "Bearer access-token",
      }
    `)
  })

  test("replaces a DPoP header of init with the token's proof", () => {
    const headers = Api.requestHeaders(
      { authorization: 'Basic other', dpop: 'proof-of-the-browser' },
      { tokenHeaders: { authorization: 'DPoP access-token', dpop: 'proof' } },
    )

    expect(Object.fromEntries(headers)).toMatchInlineSnapshot(`
      {
        "authorization": "DPoP access-token",
        "dpop": "proof",
      }
    `)
  })

  test('keeps the other headers of init', () => {
    const headers = Api.requestHeaders(
      { 'content-type': 'application/json' },
      { tokenHeaders: { authorization: 'Bearer access-token' } },
    )

    expect(Object.fromEntries(headers)).toMatchInlineSnapshot(`
      {
        "authorization": "Bearer access-token",
        "content-type": "application/json",
      }
    `)
  })
})

describe('challengeSignature', () => {
  test("reads the account's signature of the challenge, with the account as address, and nothing from a response without one", () => {
    const account = '0x7a3f9c2b1e5d8a4f6c0b3e7d9a2f5c8b1e4d7a0f'

    const read = Api.challengeSignature({
      account,
      challenge_signature: '0x1234',
    })
    const none = Api.challengeSignature({ account })

    expect(read).toMatchInlineSnapshot(`
      {
        "address": "0x7a3f9c2b1e5d8a4f6c0b3e7d9a2f5c8b1e4d7a0f",
        "challengeSignature": "0x1234",
      }
    `)
    expect(none).toMatchInlineSnapshot(`{}`)
  })
})

describe('json', () => {
  test('throws server_error for a success response without JSON, and quotes none of the body', async () => {
    const response = new Response('<!doctype html><title>Gateway</title>', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    })

    const error = await Api.json(response).then(
      (body) => ({ resolved: body }),
      (error: RequestError) => ({
        cause: error.cause,
        code: error.code,
        message: error.message,
        name: error.name,
        status: error.status,
      }),
    )

    expect(error).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "code": "server_error",
        "message": "Invalid response: the success response holds no JSON. Check the instance's \`url\`, then retry the request.",
        "name": "Accounts.RequestError",
        "status": 200,
      }
    `)
  })

  test('throws server_error with status 0 for a success response whose body does not arrive', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('network error'))
        },
      }),
      { status: 200 },
    )

    const error = await Api.json(response).then(
      (body) => ({ resolved: body }),
      (error: RequestError) => ({
        cause: error.cause,
        code: error.code,
        message: error.message,
        status: error.status,
      }),
    )

    expect(error).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "code": "server_error",
        "message": "The response ended before its body arrived. Check the connection, then retry the request.",
        "status": 0,
      }
    `)
  })

  test('throws redirect_refused for a redirect in place of a response, which a request with a credential does not follow', async () => {
    const response = new Response(null, {
      headers: { location: 'https://other.example/oauth2/token' },
      status: 307,
    })

    const error = await Api.json(response).catch(
      (error: Accounts.RequestError) => error,
    )

    expect({
      code: (error as Accounts.RequestError).code,
      message: (error as Accounts.RequestError).message,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "code": "redirect_refused",
        "message": "Refused redirect: the request goes only to the issuer's origin. Set \`url\` to the issuer's origin.",
        "status": 0,
      }
    `)
  })

  test('throws redirect_refused for a redirect whose body errors before the cancel', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('network error'))
        },
      }),
      {
        headers: { location: 'https://other.example/oauth2/token' },
        status: 307,
      },
    )

    const error = await Api.json(response).catch((error: unknown) => error)

    expect([(error as RequestError).name, (error as RequestError).code])
      .toMatchInlineSnapshot(`
      [
        "Accounts.RequestError",
        "redirect_refused",
      ]
    `)
  })

  test('tells a refused redirect from a server error whose body names its code', async () => {
    const [redirect, forged] = await Promise.all([
      Api.json(new Response(null, { status: 307 })).catch(
        (error: unknown) => error,
      ),
      Api.json(
        Response.json({ error: 'redirect_refused' }, { status: 500 }),
      ).catch((error: unknown) => error),
    ])

    expect([Api.redirectRefused(redirect), Api.redirectRefused(forged)])
      .toMatchInlineSnapshot(`
      [
        true,
        false,
      ]
    `)
  })

  test('throws the refusal of an error response without JSON', async () => {
    const response = new Response('Forbidden', { status: 403 })

    const error = await Api.json(response).catch((error: RequestError) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: Request failed with status 403.]`,
    )
  })
})

describe('sameHost', () => {
  const rows = [
    ['https://id.tempo.xyz', 'https://id.tempo.xyz/connections', true],
    ['https://id.tempo.xyz', 'https://app.tempo.xyz/', false],
    ['https://id.tempo.xyz', 'https://app.example.com/', false],
    ['https://id.tempo.xyz', 'http://id.tempo.xyz/', false],
    ['https://id-preview.vercel.app', 'https://myapp.vercel.app/', false],
    ['http://localhost:5173', 'http://localhost:3000/', true],
  ] as const
  for (const [url, page, expected] of rows)
    test(`returns ${expected} for a page at ${page} beside Tempo ID at ${url}`, () => {
      expect(Api.sameHost({ url }, { page })).toBe(expected)
    })
})

describe('jkt', () => {
  test('returns undefined within 50 milliseconds for a payload outside base64url, such as a long run of padding', () => {
    // The payload's padding strip takes seconds on such a segment without the check.
    const token = `a.${'='.repeat(65_536)}x.signature`

    const start = performance.now()
    const result = Api.jkt(token)
    const elapsed = performance.now() - start

    expect({ fast: elapsed < 50, result }).toMatchInlineSnapshot(`
      {
        "fast": true,
        "result": undefined,
      }
    `)
  })
})

describe('expired', () => {
  const token = (claims: unknown) =>
    [
      'header',
      Base64.fromString(JSON.stringify(claims), { pad: false, url: true }),
      'signature',
    ].join('.')
  const now = () => Math.floor(Date.now() / 1_000)

  test.each([
    {
      expected: true,
      name: 'an exp that passed',
      token: () => token({ exp: now() - 60 }),
    },
    {
      expected: false,
      name: 'an exp to come',
      token: () => token({ exp: now() + 60 }),
    },
    { expected: false, name: 'no exp', token: () => token({ sub: 'user_1' }) },
    {
      expected: false,
      name: 'an exp that is no number',
      token: () => token({ exp: '1' }),
    },
    {
      expected: false,
      name: 'claims that do not parse',
      token: () => 'header.%%%.signature',
    },
    { expected: false, name: 'no claims', token: () => 'opaque' },
  ])('returns $expected for $name', (row) => {
    expect(Api.expired(row.token())).toBe(row.expected)
  })
})

describe('user', () => {
  test('throws server_error for an ID token whose claims do not parse, and quotes none of the token', () => {
    const payload = Base64.fromString('sub=user_1&email=user@example.com', {
      pad: false,
      url: true,
    })
    const tokens = {
      accessToken: 'access-token',
      expiresAt: 0,
      idToken: `header.${payload}.signature`,
      refreshToken: 'refresh-token',
    }

    const error = (() => {
      try {
        return { resolved: Api.user(tokens) }
      } catch (error) {
        const { cause, code, message, name, status } = error as RequestError
        return { cause, code, message, name, status }
      }
    })()

    expect(error).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "code": "server_error",
        "message": "Invalid ID token: the response holds no ID token whose claims parse. Sign in again.",
        "name": "Accounts.RequestError",
        "status": 200,
      }
    `)
  })
  test('throws server_error for an ID token whose claims parse to no user', () => {
    const tokens = {
      accessToken: 'access-token',
      expiresAt: 0,
      idToken: `header.${Base64.fromString('null', { pad: false, url: true })}.signature`,
      refreshToken: 'refresh-token',
    }

    const error = (() => {
      try {
        return { resolved: Api.user(tokens) }
      } catch (error) {
        const { cause, code, message, name, status } = error as RequestError
        return { cause, code, message, name, status }
      }
    })()

    expect(error).toMatchInlineSnapshot(`
      {
        "cause": undefined,
        "code": "server_error",
        "message": "Invalid ID token: the response holds no ID token whose claims parse. Sign in again.",
        "name": "Accounts.RequestError",
        "status": 200,
      }
    `)
  })
})

describe('tokens', () => {
  test('counts expires_in from sentAt, the start of the request that issued the tokens', () => {
    const sentAt = Date.now() - 1_000

    const tokens = Api.tokens(
      { access_token: 'access-token', expires_in: 300 },
      { sentAt },
    )

    expect(tokens.expiresAt - sentAt).toMatchInlineSnapshot(`300000`)
  })

  test('throws server_error with status 200 for a response without an access token or a finite lifetime, and quotes none of it', () => {
    const responses = [
      { expires_in: 300, refresh_token: 'refresh-token' },
      { access_token: '', expires_in: 300, refresh_token: 'refresh-token' },
      { access_token: 'access-token', refresh_token: 'refresh-token' },
      {
        access_token: 'access-token',
        expires_in: '300',
        refresh_token: 'refresh-token',
      },
    ] as unknown as readonly Api.TokenResponse[]

    const errors = responses.map((response) => {
      try {
        return Api.tokens(response)
      } catch (error) {
        const { cause, code, message, status } = error as RequestError
        return { cause, code, message, status }
      }
    })

    expect(errors).toMatchInlineSnapshot(`
      [
        {
          "cause": undefined,
          "code": "server_error",
          "message": "Invalid response: the token response holds no access token or no lifetime. Check the instance's \`url\`, then retry the request.",
          "status": 200,
        },
        {
          "cause": undefined,
          "code": "server_error",
          "message": "Invalid response: the token response holds no access token or no lifetime. Check the instance's \`url\`, then retry the request.",
          "status": 200,
        },
        {
          "cause": undefined,
          "code": "server_error",
          "message": "Invalid response: the token response holds no access token or no lifetime. Check the instance's \`url\`, then retry the request.",
          "status": 200,
        },
        {
          "cause": undefined,
          "code": "server_error",
          "message": "Invalid response: the token response holds no access token or no lifetime. Check the instance's \`url\`, then retry the request.",
          "status": 200,
        },
      ]
    `)
  })
})

describe('tokenHeaders', () => {
  test("signs a proof with the device's current `iat` for an app's API, and one 60 seconds earlier for Tempo ID", async () => {
    const dpop = await Dpop.create()
    const auth = Accounts.from({
      clientId: 'https://app.example.com',
      dpop,
      url: 'https://id.example.com',
    })
    const accessToken = [
      Base64.fromString(JSON.stringify({ alg: 'RS256' }), base64url),
      Base64.fromString(
        JSON.stringify({ cnf: { jkt: Dpop.thumbprint(dpop) } }),
        base64url,
      ),
      'signature',
    ].join('.')
    const now = Math.floor(Date.now() / 1000)

    const ages = await Promise.all(
      [
        'https://api.example.com/me',
        'https://id.example.com/oauth2/userinfo',
      ].map(async (url) => {
        const headers = await Api.tokenHeaders(auth, {
          accessToken,
          method: 'GET',
          url,
        })
        const { iat } = decodeJwt(headers.dpop!)
        // A second can pass between the reads.
        return Math.round((now - iat!) / 10) * 10
      }),
    )

    expect(ages).toMatchInlineSnapshot(`
      [
        0,
        60,
      ]
    `)
  })
})
