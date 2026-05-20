import * as Http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import * as Kv from '../../Kv.js'
import { auth } from './auth.js'
import { bearerToken, parseCookieValue, type SessionRequest, tokenFromRequest } from './session.js'

const cookieOptions = { cookie: true, cookieName: 'sid' } as const
const noCookieOptions = { cookie: false, cookieName: 'sid' } as const

describe('bearerToken', () => {
  test('extracts token from valid Bearer header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123')
  })

  test('is case-insensitive on the scheme', () => {
    expect(bearerToken('bearer abc123')).toBe('abc123')
    expect(bearerToken('BEARER abc123')).toBe('abc123')
  })

  test('returns undefined for null', () => {
    expect(bearerToken(null)).toBeUndefined()
  })

  test('returns undefined for non-Bearer scheme', () => {
    expect(bearerToken('Basic abc123')).toBeUndefined()
  })

  test('returns undefined for empty token after Bearer', () => {
    expect(bearerToken('Bearer ')).toBeUndefined()
    expect(bearerToken('Bearer   ')).toBeUndefined()
  })
})

describe('parseCookieValue', () => {
  test('parses a single cookie', () => {
    expect(parseCookieValue('sid=token123', 'sid')).toBe('token123')
  })

  test('parses from multiple cookies', () => {
    expect(parseCookieValue('other=x; sid=token123; foo=bar', 'sid')).toBe('token123')
  })

  test('returns undefined when cookie is absent', () => {
    expect(parseCookieValue('other=x; foo=bar', 'sid')).toBeUndefined()
  })

  test('decodes URI-encoded values', () => {
    expect(parseCookieValue('sid=hello%20world', 'sid')).toBe('hello world')
  })
})

describe('tokenFromRequest (Fetch Request)', () => {
  test('extracts bearer token from Authorization header', () => {
    const req = new Request('http://localhost', {
      headers: { authorization: 'Bearer fetch-token' },
    })
    expect(tokenFromRequest(req, cookieOptions)).toBe('fetch-token')
  })

  test('extracts cookie token', () => {
    const req = new Request('http://localhost', {
      headers: { cookie: 'sid=cookie-token' },
    })
    expect(tokenFromRequest(req, cookieOptions)).toBe('cookie-token')
  })

  test('prefers bearer over cookie', () => {
    const req = new Request('http://localhost', {
      headers: {
        authorization: 'Bearer bearer-wins',
        cookie: 'sid=cookie-loses',
      },
    })
    expect(tokenFromRequest(req, cookieOptions)).toBe('bearer-wins')
  })

  test('ignores cookie when cookie option is false', () => {
    const req = new Request('http://localhost', {
      headers: { cookie: 'sid=ignored' },
    })
    expect(tokenFromRequest(req, noCookieOptions)).toBeUndefined()
  })

  test('returns undefined when no token is present', () => {
    const req = new Request('http://localhost')
    expect(tokenFromRequest(req, cookieOptions)).toBeUndefined()
  })
})

describe('tokenFromRequest (Node.js headers)', () => {
  test('extracts bearer token from Authorization header', () => {
    const req: SessionRequest = {
      headers: { authorization: 'Bearer node-token' },
    }
    expect(tokenFromRequest(req, cookieOptions)).toBe('node-token')
  })

  test('extracts cookie token', () => {
    const req: SessionRequest = {
      headers: { cookie: 'sid=node-cookie' },
    }
    expect(tokenFromRequest(req, cookieOptions)).toBe('node-cookie')
  })

  test('prefers bearer over cookie', () => {
    const req: SessionRequest = {
      headers: {
        authorization: 'Bearer bearer-wins',
        cookie: 'sid=cookie-loses',
      },
    }
    expect(tokenFromRequest(req, cookieOptions)).toBe('bearer-wins')
  })

  test('ignores cookie when cookie option is false', () => {
    const req: SessionRequest = {
      headers: { cookie: 'sid=ignored' },
    }
    expect(tokenFromRequest(req, noCookieOptions)).toBeUndefined()
  })

  test('returns undefined when no token is present', () => {
    const req: SessionRequest = { headers: {} }
    expect(tokenFromRequest(req, cookieOptions)).toBeUndefined()
  })

  test('handles undefined header values', () => {
    const req: SessionRequest = {
      headers: { authorization: undefined, cookie: 'sid=fallback' },
    }
    expect(tokenFromRequest(req, cookieOptions)).toBe('fallback')
  })

  test('handles array header values', () => {
    const req: SessionRequest = {
      headers: { cookie: ['sid=from-array', 'other=x'] },
    }
    expect(tokenFromRequest(req, cookieOptions)).toBe('from-array')
  })
})

describe('getSession with http.IncomingMessage', () => {
  const store = Kv.memory()
  const handler = auth({ store, cookie: false, domain: 'localhost' })

  let authServer: Http.Server
  let authUrl: string
  let appServer: Http.Server
  let appUrl: string

  beforeAll(async () => {
    authServer = Http.createServer(handler.listener)
    await new Promise<void>((resolve) => authServer.listen(0, resolve))
    authUrl = `http://localhost:${(authServer.address() as AddressInfo).port}`

    appServer = Http.createServer(async (req, res) => {
      const session = await handler.getSession(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ session: session ?? null }))
    })
    await new Promise<void>((resolve) => appServer.listen(0, resolve))
    appUrl = `http://localhost:${(appServer.address() as AddressInfo).port}`
  })

  afterAll(() => {
    authServer.close()
    appServer.close()
  })

  test('resolves session from bearer token on a real http.IncomingMessage', async () => {
    const { privateKeyToAccount } = await import('viem/accounts')
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    )

    const challengeRes = await fetch(`${authUrl}/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chainId: 0 }),
    })
    expect(challengeRes.status).toBe(200)
    const { message } = (await challengeRes.json()) as { message: string }

    const signature = await account.signMessage({ message })
    const verifyRes = await fetch(authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address: account.address,
        message,
        signature,
        returnToken: true,
      }),
    })
    expect(verifyRes.status).toBe(200)
    const { token } = (await verifyRes.json()) as { token: string }
    expect(token).toBeDefined()

    const appRes = await fetch(appUrl, {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = (await appRes.json()) as { session: { address: string; chainId: number } | null }

    expect(body.session).toMatchObject({
      address: account.address,
      chainId: 0,
    })
  })

  test('returns null for unauthenticated request', async () => {
    const appRes = await fetch(appUrl)
    const body = (await appRes.json()) as { session: unknown }
    expect(body.session).toBeNull()
  })
})
