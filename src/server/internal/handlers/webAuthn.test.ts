import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vp/test'

import { createServer, type Server } from '../../../../test/utils.js'
import * as WebAuthnCeremony from '../../../core/WebAuthnCeremony.js'
import * as Kv from '../../Kv.js'
import { type SessionPayload, webAuthn } from './webAuthn.js'

let server: Server
let ceremony: WebAuthnCeremony.WebAuthnCeremony

beforeAll(async () => {
  server = await createServer(
    webAuthn({
      kv: Kv.memory(),
      origin: 'http://localhost',
      rpId: 'localhost',
    }).listener,
  )
  ceremony = WebAuthnCeremony.server({ url: server.url })
})

afterAll(async () => {
  await server.closeAsync()
})

describe('POST /register/options', () => {
  test('default: returns registration options', async () => {
    const { options } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rp.id).toMatchInlineSnapshot(`"localhost"`)
    expect(options.publicKey!.rp.name).toMatchInlineSnapshot(`"localhost"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
  })

  test('behavior: each call generates a unique challenge', async () => {
    const { options: a } = await ceremony.getRegistrationOptions({ name: 'Test' })
    const { options: b } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('POST /login/options', () => {
  test('default: returns authentication options', async () => {
    const { options } = await ceremony.getAuthenticationOptions()
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rpId).toMatchInlineSnapshot(`"localhost"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
  })

  test('behavior: each call generates a unique challenge', async () => {
    const { options: a } = await ceremony.getAuthenticationOptions()
    const { options: b } = await ceremony.getAuthenticationOptions()
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('POST /register', () => {
  test('error: invalid credential → 400', async () => {
    const response = await fetch(`${server.url}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fake', clientDataJSON: 'bad', attestationObject: 'bad' }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTypeOf('string')
  })
})

describe('kv', () => {
  test('store without atomic create is accepted', () => {
    const kv: Kv.Kv = {
      async get() {
        return undefined
      },
      async set() {},
      async delete() {},
    }

    expect(() =>
      webAuthn({
        kv,
        origin: 'http://localhost',
        rpId: 'localhost',
      }),
    ).not.toThrow()
  })
})

describe('POST /login', () => {
  test('error: unknown credential → 400', async () => {
    const response = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'unknown',
        metadata: { authenticatorData: '0x00', clientDataJSON: '{"challenge":"0xdead"}' },
        raw: {
          id: 'unknown',
          type: 'public-key',
          authenticatorAttachment: null,
          rawId: 'unknown',
          response: { clientDataJSON: 'e30' },
        },
        signature: '0x00',
      }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatchInlineSnapshot(`"Missing or expired challenge"`)
  })
})

describe('challenge replay', () => {
  test('behavior: challenge consumed after register/options → re-fetching is required', async () => {
    // Get options twice — each should have a unique challenge stored in KV
    const { options: a } = await ceremony.getRegistrationOptions({ name: 'Replay' })
    const { options: b } = await ceremony.getRegistrationOptions({ name: 'Replay' })
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })

  test('behavior: challenge consumed after login/options → re-fetching is required', async () => {
    const { options: a } = await ceremony.getAuthenticationOptions()
    const { options: b } = await ceremony.getAuthenticationOptions()
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('hooks', () => {
  test('behavior: onRegister error does not call hook', async () => {
    let called = false
    const hookServer = await createServer(
      webAuthn({
        kv: Kv.memory(),
        origin: 'http://localhost',
        rpId: 'localhost',
        onRegister() {
          called = true
          return Response.json({ extra: true })
        },
      }).listener,
    )

    const response = await fetch(`${hookServer.url}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fake', clientDataJSON: 'bad', attestationObject: 'bad' }),
    })
    expect(response.status).toBe(400)
    expect(called).toBe(false)

    await hookServer.closeAsync()
  })

  test('behavior: onAuthenticate error does not call hook', async () => {
    let called = false
    const hookServer = await createServer(
      webAuthn({
        kv: Kv.memory(),
        origin: 'http://localhost',
        rpId: 'localhost',
        onAuthenticate() {
          called = true
          return Response.json({ extra: true })
        },
      }).listener,
    )

    const response = await fetch(`${hookServer.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'unknown',
        metadata: { authenticatorData: '0x00', clientDataJSON: '{"challenge":"0xdead"}' },
        raw: {
          id: 'unknown',
          type: 'public-key',
          authenticatorAttachment: null,
          rawId: 'unknown',
          response: { clientDataJSON: 'e30' },
        },
        signature: '0x00',
      }),
    })
    expect(response.status).toBe(400)
    expect(called).toBe(false)

    await hookServer.closeAsync()
  })
})

// Successful login requires a real authenticator, so the cookie / session
// surfaces are exercised by manually seeding the session in the shared
// `kv` and hitting `getSession` and `/logout` directly.
describe('session — getSession & /logout', () => {
  let kv: Kv.Kv
  let handler: ReturnType<typeof webAuthn>
  let s: Server

  const seedSession = async (token = 'tok-default'): Promise<SessionPayload> => {
    const issuedAt = Math.floor(Date.now() / 1000)
    const payload: SessionPayload = {
      credentialId: 'cred-1',
      publicKey: '0xpub',
      userId: 'user-1',
      issuedAt,
      expiresAt: issuedAt + 60,
    }
    await kv.set(`session:${token}`, payload, { ttl: 60 })
    return payload
  }

  afterEach(async () => {
    if (s) await s.closeAsync()
  })

  test('default (cookie mode): getSession resolves bearer or cookie; /logout clears cookie + revokes', async () => {
    kv = Kv.memory()
    handler = webAuthn({ kv, origin: 'http://localhost', rpId: 'localhost' })
    s = await createServer(handler.listener)

    await seedSession('tok-A')

    const bearerSession = await handler.getSession(
      new Request('http://localhost/', { headers: { authorization: 'Bearer tok-A' } }),
    )
    expect(bearerSession?.credentialId).toBe('cred-1')

    const cookieSession = await handler.getSession(
      new Request('http://localhost/', { headers: { cookie: 'accounts_webauthn=tok-A' } }),
    )
    expect(cookieSession?.credentialId).toBe('cred-1')

    const noAuthSession = await handler.getSession(new Request('http://localhost/'))
    expect(noAuthSession).toBeUndefined()

    const logout = await fetch(`${s.url}/logout`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-A' },
    })
    expect(logout.status).toBe(204)
    const setCookie = logout.headers.get('set-cookie')
    expect(setCookie).toContain('accounts_webauthn=')
    expect(setCookie).toContain('Max-Age=0')

    expect(await kv.get('session:tok-A')).toBeUndefined()
    const after = await handler.getSession(
      new Request('http://localhost/', { headers: { authorization: 'Bearer tok-A' } }),
    )
    expect(after).toBeUndefined()
  })

  test('cookie: false: getSession ignores cookies; /logout returns 204 without Set-Cookie', async () => {
    kv = Kv.memory()
    handler = webAuthn({ kv, cookie: false, origin: 'http://localhost', rpId: 'localhost' })
    s = await createServer(handler.listener)

    await seedSession('tok-B')

    const bearer = await handler.getSession(
      new Request('http://localhost/', { headers: { authorization: 'Bearer tok-B' } }),
    )
    expect(bearer?.credentialId).toBe('cred-1')

    const cookieIgnored = await handler.getSession(
      new Request('http://localhost/', { headers: { cookie: 'accounts_webauthn=tok-B' } }),
    )
    expect(cookieIgnored).toBeUndefined()

    const logout = await fetch(`${s.url}/logout`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-B' },
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toBeNull()
    expect(await kv.get('session:tok-B')).toBeUndefined()
  })

  test('custom cookieName is honored on getSession and /logout', async () => {
    kv = Kv.memory()
    handler = webAuthn({
      kv,
      cookieName: 'custom_cookie',
      origin: 'http://localhost',
      rpId: 'localhost',
    })
    s = await createServer(handler.listener)

    await seedSession('tok-C')

    expect(
      await handler.getSession(
        new Request('http://localhost/', { headers: { cookie: 'custom_cookie=tok-C' } }),
      ),
    ).toBeTruthy()
    expect(
      await handler.getSession(
        new Request('http://localhost/', { headers: { cookie: 'accounts_webauthn=tok-C' } }),
      ),
    ).toBeUndefined()

    const logout = await fetch(`${s.url}/logout`, { method: 'POST' })
    expect(logout.headers.get('set-cookie')).toContain('custom_cookie=')
  })

  test('/logout returns 204 even without a session token', async () => {
    kv = Kv.memory()
    handler = webAuthn({ kv, origin: 'http://localhost', rpId: 'localhost' })
    s = await createServer(handler.listener)

    const res = await fetch(`${s.url}/logout`, { method: 'POST' })
    expect(res.status).toBe(204)
  })

  test('session: false: getSession always undefined; /logout route is not mounted (404)', async () => {
    kv = Kv.memory()
    handler = webAuthn({ kv, origin: 'http://localhost', rpId: 'localhost', session: false })
    s = await createServer(handler.listener)

    // Even with a manually-seeded session in kv, getSession ignores it.
    await seedSession('tok-D')
    const bearer = await handler.getSession(
      new Request('http://localhost/', { headers: { authorization: 'Bearer tok-D' } }),
    )
    expect(bearer).toBeUndefined()

    const logout = await fetch(`${s.url}/logout`, {
      method: 'POST',
      headers: { authorization: 'Bearer tok-D' },
    })
    expect(logout.status).toBe(404)
    // The seeded entry must survive — no logout route, nothing to delete.
    expect(await kv.get('session:tok-D')).toBeDefined()
  })
})
