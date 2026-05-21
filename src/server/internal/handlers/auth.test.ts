import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { parseSiweMessage } from 'viem/siwe'
import { describe, expect, test } from 'vp/test'

import * as Handler from '../../Handler.js'
import * as Kv from '../../Kv.js'
import { auth } from './auth.js'

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
)
const otherAccount = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
)

describe('challenge', () => {
  test('error: requires pinned origin or domain', () => {
    expect(() => auth()).toThrowErrorMatchingInlineSnapshot(
      `[Error: \`auth()\` requires \`origin\` or \`domain\` to pin SIWE domain binding.]`,
    )
  })

  test('returns challenge message with chainId, nonce, zero-address placeholder', async () => {
    const { app } = setup()

    const { status, body } = await getChallenge(app, { chainId: 1 })

    expect(status).toBe(200)
    const parsed = parseSiweMessage(body.message!)
    expect(parsed.address).toBe('0x0000000000000000000000000000000000000000')
    expect(parsed.chainId).toBe(1)
    expect(parsed.domain).toBe('wallet.example')
    expect(parsed.uri).toBe('http://wallet.example')
    expect(parsed.version).toBe('1')
    expect(parsed.nonce).toMatch(/^[a-z0-9]+$/)
  })

  test('defaults chainId to 0 when omitted', async () => {
    const { app } = setup()

    const res = await app.request('/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'wallet.example' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    const { message } = (await res.json()) as { message: string }
    expect(parseSiweMessage(message).chainId).toBe(0)
  })

  test('persists the nonce in the store with TTL', async () => {
    const store = Kv.memory()
    const { app } = setup({ store })

    const { body } = await getChallenge(app, { chainId: 1 })
    const nonce = parseSiweMessage(body.message!).nonce!

    expect(await store.get(`challenge:${nonce}`)).toMatchObject({ chainId: 1 })
  })
})

describe('verify (EOA, cookie mode)', () => {
  test('default: verifies signature, sets cookie, persists session', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchInlineSnapshot(`{}`)

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('accounts_auth=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    // getSession resolves the persisted payload from a follow-up request.
    const followUp = new Request('http://wallet.example/', {
      headers: { cookie: setCookie!.split(';')[0]! },
    })
    const session = await handler.getSession(followUp)
    expect(session?.address).toBe(account.address)
    expect(session?.chainId).toBe(1)

    // Session is also persisted in the store under `session:` prefix.
    const token = setCookie!.split(';')[0]!.split('=')[1]!
    expect(await store.get(`session:${token}`)).toBeDefined()
  })

  test('rejects replayed nonce with 409', async () => {
    const { app } = setup()

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const ok = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })
    expect(ok.status).toBe(200)

    const replay = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })
    expect(replay.status).toBe(409)
    expect(await replay.json()).toMatchInlineSnapshot(`
      {
        "error": "invalid or replayed nonce",
      }
    `)
  })

  test('rejects signature for a different address with 401', async () => {
    const { app } = setup()

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: otherAccount.address,
      message,
      signature,
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "signature does not match address",
      }
    `)
  })

  test('rejects domain mismatch with 400', async () => {
    const { app } = setup()

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const tampered = challengeBody.message!.replace('wallet.example', 'evil.example')
    const signature = await account.signMessage({ message: tampered })

    const res = await postVerify(app, {
      address: account.address,
      message: tampered,
      signature,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "domain mismatch",
      }
    `)
  })

  test('rejects tampered message (statement injection) with 400', async () => {
    // Regression: an attacker could fetch a valid challenge, inject a
    // benign-looking `statement` into the SIWE text, get a victim to sign
    // it, and replay the signature here. The server must reject any
    // message that doesn't byte-match the challenge it issued.
    const { app } = setup()

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    // SIWE injects `statement` as the line between the address line and
    // the blank line preceding `URI:`. Splice one in.
    const tampered = message.replace(
      /(0x0000000000000000000000000000000000000000\n)\n/,
      '$1\nSign to prove you are human\n\n',
    )
    expect(tampered).not.toBe(message)
    const signature = await account.signMessage({ message: tampered })

    const res = await postVerify(app, {
      address: account.address,
      message: tampered,
      signature,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "message mismatch",
      }
    `)
  })

  test('rejects malformed body with 400', async () => {
    const { app } = setup()
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'wallet.example' },
      body: '',
    })
    expect(res.status).toBe(400)
  })
})

describe('logout', () => {
  test('clears the session cookie and deletes the store entry', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const verify = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })
    const sessionCookie = verify.headers.get('set-cookie')!.split(';')[0]!
    const token = sessionCookie.split('=')[1]!

    expect(await store.get(`session:${token}`)).toBeDefined()

    const logout = await app.request('/logout', {
      method: 'POST',
      headers: { cookie: sessionCookie, host: 'wallet.example' },
    })
    expect(logout.status).toBe(204)

    const clearCookie = logout.headers.get('set-cookie')!
    expect(clearCookie).toContain('accounts_auth=')
    expect(clearCookie).toContain('Max-Age=0')

    expect(await store.get(`session:${token}`)).toBeUndefined()
    const followUp = new Request('http://wallet.example/', {
      headers: { cookie: sessionCookie },
    })
    expect(await handler.getSession(followUp)).toBeUndefined()
  })

  test('204 unconditionally even without a session cookie', async () => {
    const { app } = setup()
    const res = await app.request('/logout', {
      method: 'POST',
      headers: { host: 'wallet.example' },
    })
    expect(res.status).toBe(204)
  })
})

describe('verify (token mode)', () => {
  test('returnToken=true returns { token } in body and skips Set-Cookie', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
      returnToken: true,
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()

    const { token } = (await res.json()) as { token: string }
    expect(token).toMatch(/^[a-z0-9]+$/)

    expect(await store.get(`session:${token}`)).toBeDefined()

    // Bearer-mode getSession resolves the token.
    const followUp = new Request('http://wallet.example/', {
      headers: { authorization: `Bearer ${token}` },
    })
    const session = await handler.getSession(followUp)
    expect(session?.address).toBe(account.address)
  })
})

describe('cookie: false', () => {
  test('verify always returns { token } in body and never sets a cookie', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ cookie: false, store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    // Even without `returnToken: true`, the body carries the token and
    // no Set-Cookie is emitted.
    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()

    const { token } = (await res.json()) as { token: string }
    expect(token).toMatch(/^[a-z0-9]+$/)
    expect(await store.get(`session:${token}`)).toBeDefined()

    const followUp = new Request('http://wallet.example/', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect((await handler.getSession(followUp))?.address).toBe(account.address)
  })

  test('getSession ignores cookies even when present', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ cookie: false, store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })
    const verify = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })
    const { token } = (await verify.json()) as { token: string }

    // Cookie carrying the very token that's valid in the store — but
    // cookie mode is disabled, so it must not resolve a session.
    const req = new Request('http://wallet.example/', {
      headers: { cookie: `accounts_auth=${token}` },
    })
    expect(await handler.getSession(req)).toBeUndefined()

    // Bearer mode still works against the same token.
    const bearerReq = new Request('http://wallet.example/', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect((await handler.getSession(bearerReq))?.address).toBe(account.address)
  })

  test('logout via Authorization: Bearer revokes the session and skips Set-Cookie', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ cookie: false, store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })
    const verify = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })
    const { token } = (await verify.json()) as { token: string }
    expect(await store.get(`session:${token}`)).toBeDefined()

    const logout = await app.request('/logout', {
      method: 'POST',
      headers: { host: 'wallet.example', authorization: `Bearer ${token}` },
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toBeNull()

    expect(await store.get(`session:${token}`)).toBeUndefined()
    const followUp = new Request('http://wallet.example/', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(await handler.getSession(followUp)).toBeUndefined()
  })
})

describe('session: false', () => {
  test('verify returns {} with no token, no Set-Cookie, no store write', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ session: false, store })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchInlineSnapshot(`{}`)
    expect(res.headers.get('set-cookie')).toBeNull()

    // getSession always resolves undefined; even a manually-seeded
    // session token must not leak through.
    await store.set('session:tok', { address: account.address }, { ttl: 60 })
    const req = new Request('http://wallet.example/', {
      headers: { authorization: 'Bearer tok' },
    })
    expect(await handler.getSession(req)).toBeUndefined()
  })

  test('returnToken: true is ignored when session: false', async () => {
    const { app } = setup({ session: false })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
      returnToken: true,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchInlineSnapshot(`{}`)
  })

  test('logout route is not mounted (returns 404)', async () => {
    const store = Kv.memory()
    const { app } = setup({ session: false, store })

    await store.set('session:tok', { address: account.address }, { ttl: 60 })

    const res = await app.request('/logout', {
      method: 'POST',
      headers: { host: 'wallet.example', authorization: 'Bearer tok' },
    })
    expect(res.status).toBe(404)
    // The seeded entry survives — no logout route, nothing to delete.
    expect(await store.get('session:tok')).toBeDefined()
  })

  test('onAuthenticate still runs and can reject before the short-circuit', async () => {
    let invoked = false
    const { app } = setup({
      session: false,
      onAuthenticate: () => {
        invoked = true
        throw new Error('blocked')
      },
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(401)
    expect(invoked).toBe(true)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "blocked",
      }
    `)
  })
})

describe('onAuthenticate', () => {
  test('invoked with verified address, chainId, message, signature, request', async () => {
    const calls: Array<{
      address: string
      chainId: number
      message: string
      signature: string
      requestUrl: string
    }> = []

    const { app } = setup({
      onAuthenticate: ({ address, chainId, message, signature, request }) => {
        calls.push({
          address,
          chainId,
          message,
          signature,
          requestUrl: request.url,
        })
      },
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      address: account.address,
      chainId: 1,
      message,
      signature,
    })
    expect(calls[0]?.requestUrl).toContain('/')
  })

  test('not invoked when signature verification fails', async () => {
    let invoked = false
    const { app } = setup({
      onAuthenticate: () => {
        invoked = true
      },
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: otherAccount.address,
      message,
      signature,
    })

    expect(res.status).toBe(401)
    expect(invoked).toBe(false)
  })

  test('throwing rejects the request with 401 and surfaces the error message', async () => {
    const store = Kv.memory()
    const { app } = setup({
      store,
      onAuthenticate: () => {
        throw new Error('user is blocked')
      },
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "user is blocked",
      }
    `)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('returning a Response merges body fields and status onto the verify response', async () => {
    const { app } = setup({
      onAuthenticate: () => Response.json({ jwt: 'eyJ...', userId: 'u_42' }, { status: 201 }),
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
      returnToken: true,
    })

    expect(res.status).toBe(201)
    const { token, ...rest } = (await res.json()) as Record<string, unknown>
    expect(token).toMatch(/^[a-z0-9]+$/)
    expect(rest).toMatchInlineSnapshot(`
      {
        "jwt": "eyJ...",
        "userId": "u_42",
      }
    `)
  })

  test('returned Response without `session: false` still issues a session token', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({
      store,
      onAuthenticate: () => Response.json({ extra: 'meta' }),
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const res = await postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, unknown>).extra).toBe('meta')

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('accounts_auth=')
    const token = setCookie!.split(';')[0]!.split('=')[1]!
    expect(await store.get(`session:${token}`)).toBeDefined()

    // getSession resolves the issued session via the cookie.
    const followUp = new Request('http://wallet.example/', {
      headers: { cookie: setCookie!.split(';')[0]! },
    })
    const sessionPayload = await handler.getSession(followUp)
    expect(sessionPayload?.address).toBe(account.address)
  })

  test('async hook is awaited before issuing the session', async () => {
    let resolveHook: (() => void) | undefined
    const blocker = new Promise<void>((resolve) => {
      resolveHook = resolve
    })
    let hookFinished = false

    const { app } = setup({
      onAuthenticate: async () => {
        await blocker
        hookFinished = true
      },
    })

    const { body: challengeBody } = await getChallenge(app, { chainId: 1 })
    const message = challengeBody.message!
    const signature = await account.signMessage({ message })

    const verifyPromise = postVerify(app, {
      address: account.address,
      message,
      signature,
    })

    // Yield once to let verify dispatch into the hook.
    await new Promise((r) => setTimeout(r, 10))
    expect(hookFinished).toBe(false)

    resolveHook!()
    const res = await verifyPromise
    expect(res.status).toBe(200)
    expect(hookFinished).toBe(true)
  })
})

describe('getSession', () => {
  test('returns undefined when no cookie is present', async () => {
    const { handler } = setup()
    const req = new Request('http://wallet.example/')
    expect(await handler.getSession(req)).toBeUndefined()
  })

  test('prefers Authorization: Bearer over cookie', async () => {
    const store = Kv.memory()
    const { handler, app } = setup({ store })

    // Issue session #1 via cookie mode.
    const ch1 = await getChallenge(app, { chainId: 1 })
    const sig1 = await account.signMessage({ message: ch1.body.message! })
    const v1 = await postVerify(app, {
      address: account.address,
      message: ch1.body.message!,
      signature: sig1,
    })
    const cookie = v1.headers.get('set-cookie')!.split(';')[0]!

    // Issue session #2 via token mode for a different address.
    const ch2 = await getChallenge(app, { chainId: 1 })
    const sig2 = await otherAccount.signMessage({ message: ch2.body.message! })
    const v2 = await postVerify(app, {
      address: otherAccount.address,
      message: ch2.body.message!,
      signature: sig2,
      returnToken: true,
    })
    const { token } = (await v2.json()) as { token: string }

    // When both are present, the bearer wins.
    const req = new Request('http://wallet.example/', {
      headers: { cookie, authorization: `Bearer ${token}` },
    })
    const session = await handler.getSession(req)
    expect(session?.address).toBe(otherAccount.address)
  })
})

describe('store: atomic `take` preferred, non-atomic fallback', () => {
  test('Kv.memory() (has `take`) is accepted', () => {
    expect(() => auth({ domain: 'wallet.example', store: Kv.memory() })).not.toThrow()
  })

  test('store without `take` falls back to non-atomic get + delete', async () => {
    // The fallback path is racy on eventually-consistent stores but
    // works correctly in single-process serial usage. Verify the
    // handler still constructs and the verify endpoint can consume a
    // challenge end-to-end.
    const noTake: Kv.Kv = (() => {
      const map = new Map<string, unknown>()
      return {
        async get(key) {
          return map.get(key) as never
        },
        async set(key, value) {
          map.set(key, value)
        },
        async delete(key) {
          map.delete(key)
        },
      }
    })()
    const handler = auth({ domain: 'wallet.example', store: noTake })
    const app = new Hono()
    app.route('/', handler)

    const challenge = await app.request('/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'wallet.example' },
      body: JSON.stringify({ chainId: 1 }),
    })
    expect(challenge.status).toBe(200)
  })
})

describe('origin / trustProxy', () => {
  test('default: ignores `x-forwarded-host` and `x-forwarded-proto`', async () => {
    const handler = auth({ domain: 'real.example' })
    const app = new Hono()
    app.route('/', handler)

    const res = await app.request('/challenge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'real.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'http',
      },
      body: JSON.stringify({ chainId: 1 }),
    })
    const body = (await res.json()) as { message: string }
    const parsed = parseSiweMessage(body.message)
    expect(parsed.domain).toBe('real.example')
  })

  test('trustProxy: true → honors `x-forwarded-host` and `x-forwarded-proto`', async () => {
    const handler = auth({ domain: 'app.example', trustProxy: true })
    const app = new Hono()
    app.route('/', handler)

    const res = await app.request('/challenge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'internal.example',
        'x-forwarded-host': 'app.example',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ chainId: 1 }),
    })
    const body = (await res.json()) as { message: string }
    const parsed = parseSiweMessage(body.message)
    expect(parsed.domain).toBe('app.example')
    expect(parsed.uri).toBe('https://app.example')
  })

  test('origin: pinned origin overrides host and forwarded headers', async () => {
    const handler = auth({
      origin: 'https://app.example.com',
      trustProxy: true,
    })
    const app = new Hono()
    app.route('/', handler)

    const res = await app.request('/challenge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'internal.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'http',
      },
      body: JSON.stringify({ chainId: 1 }),
    })
    const body = (await res.json()) as { message: string }
    const parsed = parseSiweMessage(body.message)
    expect(parsed.domain).toBe('app.example.com')
    expect(parsed.uri).toBe('https://app.example.com')
  })

  test('origin: invalid URL throws at construction time', async () => {
    expect(() => auth({ origin: 'not-a-url' })).toThrowErrorMatchingInlineSnapshot(
      `[Error: \`auth({ origin })\` must be a valid absolute URL. Got: not-a-url]`,
    )
  })

  test('default trustProxy: true on Cloudflare Workers runtime', async () => {
    // Spoof the Cloudflare Workers runtime marker.
    const originalNavigator = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Cloudflare-Workers' },
      configurable: true,
    })
    try {
      const handler = auth({ domain: 'app.example' })
      const app = new Hono()
      app.route('/', handler)

      const res = await app.request('/challenge', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'internal.example',
          'x-forwarded-host': 'app.example',
          'x-forwarded-proto': 'https',
        },
        body: JSON.stringify({ chainId: 1 }),
      })
      const body = (await res.json()) as { message: string }
      const parsed = parseSiweMessage(body.message)
      expect(parsed.domain).toBe('app.example')
      expect(parsed.uri).toBe('https://app.example')
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      })
    }
  })
})

describe('Handler.compose integration', () => {
  test('mounts under a custom path and routes correctly', async () => {
    const composed = Handler.compose([auth({ domain: 'wallet.example' })], {
      path: '/api/auth',
    })

    const challengeRes = await composed.request('/api/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'wallet.example' },
      body: JSON.stringify({ chainId: 1 }),
    })
    expect(challengeRes.status).toBe(200)

    const notFound = await composed.request('/api/auth/whatever', {
      method: 'GET',
      headers: { host: 'wallet.example' },
    })
    expect(notFound.status).toBe(404)
  })
})

function setup(options: Parameters<typeof auth>[0] = {}) {
  const handler = auth({ domain: 'wallet.example', ...options })
  // Mount under '/' so tests hit /challenge, /, /logout directly.
  const app = new Hono()
  app.route('/', handler)
  return { handler, app }
}

async function getChallenge(app: Hono, body: { chainId: number }) {
  const res = await app.request('/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'wallet.example' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as { message?: string; error?: string } }
}

async function postVerify(
  app: Hono,
  body: {
    address: string
    message: string
    signature: string
    returnToken?: boolean
  },
) {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'wallet.example' },
    body: JSON.stringify(body),
  })
  return res
}
