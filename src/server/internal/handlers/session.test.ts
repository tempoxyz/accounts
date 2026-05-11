import { describe, expect, test } from 'vp/test'

import {
  bearerToken,
  parseCookieValue,
  type SessionRequest,
  tokenFromRequest,
} from './session.js'

const cookieOptions = { cookie: true, cookieName: 'sid' } as const
const noCookieOptions = { cookie: false, cookieName: 'sid' } as const

// ---------------------------------------------------------------------------
// bearerToken
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// parseCookieValue
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// tokenFromRequest — Fetch API Request
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// tokenFromRequest — Node.js IncomingMessage-shaped request
// ---------------------------------------------------------------------------

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

  test('handles array header values (multiple Set-Cookie style)', () => {
    const req: SessionRequest = {
      headers: { cookie: ['sid=from-array', 'other=x'] },
    }
    // Node joins array values with ", " — parseCookieValue handles this
    expect(tokenFromRequest(req, cookieOptions)).toBe('from-array')
  })
})
