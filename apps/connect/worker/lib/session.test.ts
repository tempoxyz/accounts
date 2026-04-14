import { Hono } from 'hono'
import { beforeAll, describe, expect, test } from 'vp/test'

import * as Session from './session.js'

let privateKey: string
let publicKey: string

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  privateKey = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
  publicKey = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey))
})

describe('sign + verify', () => {
  test('round-trips a basic token', async () => {
    const token = await Session.sign(privateKey, 'user-1')
    const result = await Session.verify(publicKey, token)
    const { sid, ...rest } = result!
    expect(sid).toBeDefined()
    expect(rest).toMatchInlineSnapshot(`
      {
        "email": null,
        "sub": "user-1",
        "wallet": null,
      }
    `)
  })

  test('includes email', async () => {
    const token = await Session.sign(privateKey, 'user-1', { email: 'alice@example.com' })
    const result = await Session.verify(publicKey, token)
    expect(result?.email).toMatchInlineSnapshot(`"alice@example.com"`)
  })

  test('includes wallet', async () => {
    const wallet: Session.Wallet = {
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      label: 'My Passkey',
    }
    const token = await Session.sign(privateKey, 'user-1', { wallet })
    const result = await Session.verify(publicKey, token)
    expect(result?.wallet).toMatchInlineSnapshot(`
      {
        "credentialId": "cred-1",
        "label": "My Passkey",
        "publicKey": "pk-1",
      }
    `)
  })

  test('returns null for tampered token', async () => {
    const token = await Session.sign(privateKey, 'user-1')
    const result = await Session.verify(publicKey, token + 'x')
    expect(result).toMatchInlineSnapshot(`null`)
  })

  test('returns null for garbage', async () => {
    const result = await Session.verify(publicKey, 'not-a-jwt')
    expect(result).toMatchInlineSnapshot(`null`)
  })

  test('produces a standard 3-part JWT', async () => {
    const token = await Session.sign(privateKey, 'user-1')
    expect(token.split('.')).toHaveLength(3)
  })
})

describe('set + fromRequest', () => {
  test('sets session cookie (bare/localhost)', async () => {
    const app = new Hono()
    app.get('/', async (c) => {
      await Session.set(c, privateKey, 'user-1')
      return c.text('ok')
    })
    const res = await app.request('http://localhost:3000/')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain=')
    expect(cookie).not.toContain('__Secure-')
  })

  test('sets __Secure- cookie on .tempo.xyz', async () => {
    const app = new Hono()
    app.get('/', async (c) => {
      await Session.set(c, privateKey, 'user-1')
      return c.text('ok')
    })
    const res = await app.request('https://connect.tempo.xyz/')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('__Secure-session=')
    expect(cookie).toContain('Domain=.tempo.xyz')
    expect(cookie).toContain('Secure')
  })

  test('sets domain cookie on .tempo.local', async () => {
    const app = new Hono()
    app.get('/', async (c) => {
      await Session.set(c, privateKey, 'user-1')
      return c.text('ok')
    })
    const res = await app.request('http://connect.tempo.local/')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('session=')
    expect(cookie).toContain('Domain=.tempo.local')
    expect(cookie).not.toContain('__Secure-')
  })

  test('sets SameSite=None when embed is true', async () => {
    const app = new Hono()
    app.get('/', async (c) => {
      await Session.set(c, privateKey, 'user-1', { embed: true })
      return c.text('ok')
    })
    const res = await app.request('http://localhost:3000/')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Secure')
  })

  test('fromRequest reads session cookie back', async () => {
    const app = new Hono()
    app.get('/set', async (c) => {
      await Session.set(c, privateKey, 'user-1', { email: 'a@b.com' })
      return c.text('ok')
    })
    app.get('/get', async (c) => {
      const session = await Session.fromRequest(c, publicKey)
      return c.json(session)
    })

    const setRes = await app.request('http://localhost:3000/set')
    const cookie = setRes.headers.get('set-cookie')!
    const tokenMatch = cookie.match(/session=([^;]+)/)!

    const getRes = await app.request('http://localhost:3000/get', {
      headers: { cookie: `session=${tokenMatch[1]}` },
    })
    const session = (await getRes.json()) as Session.DecodedPayload
    expect(session.sub).toMatchInlineSnapshot(`"user-1"`)
    expect(session.email).toMatchInlineSnapshot(`"a@b.com"`)
  })

  test('fromRequest returns null without cookies', async () => {
    const app = new Hono()
    app.get('/', async (c) => {
      const session = await Session.fromRequest(c, publicKey)
      return c.json(session)
    })
    const res = await app.request('http://localhost:3000/')
    expect(await res.json()).toMatchInlineSnapshot(`null`)
  })
})

describe('clear', () => {
  test('clears session cookie', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      Session.clear(c)
      return c.text('ok')
    })
    const res = await app.request('http://localhost:3000/')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('session=')
    expect(cookie).toContain('Max-Age=0')
  })
})
