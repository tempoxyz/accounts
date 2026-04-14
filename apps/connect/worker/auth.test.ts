import { describe, expect, test } from 'vp/test'

import { auth } from './auth.js'

describe('POST /otp/send', () => {
  test('generates and stores OTP in bypass mode', async () => {
    const kv = createKv()
    const res = await post('/otp/send', { email: uniqueEmail() }, env(kv))
    expect(res.status).toMatchInlineSnapshot(`200`)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "ok": true,
      }
    `)
  })

  test('returns 400 for invalid email', async () => {
    const res = await post('/otp/send', { email: 'bad' }, env(createKv()))
    expect(res.status).toMatchInlineSnapshot(`400`)
    const { success } = (await res.json()) as { success: boolean }
    expect(success).toMatchInlineSnapshot(`false`)
  })
})

describe('POST /otp/verify', () => {
  test('upserts user, sets session cookie, returns user object', async () => {
    const kv = createKv()
    const email = uniqueEmail()

    await post('/otp/send', { email }, env(kv))

    const res = await post('/otp/verify', { email, code: '000000' }, env(kv))
    expect(res.status).toMatchInlineSnapshot(`200`)

    const body = (await res.json()) as { user: { id: string; email: string } }
    const { id, ...rest } = body.user
    expect(id).toBeDefined()
    expect(rest).toMatchInlineSnapshot(`
      {
        "email": "${email}",
      }
    `)
    expect(res.headers.get('set-cookie')).toContain('session=')
    expect(res.headers.get('set-cookie')).toContain('SameSite=None')
  })

  test('returns same user id for repeat verification', async () => {
    const email = uniqueEmail()

    const kv1 = createKv()
    await post('/otp/send', { email }, env(kv1))
    const res1 = await post('/otp/verify', { email, code: '000000' }, env(kv1))
    const body1 = (await res1.json()) as { user: { id: string } }

    const kv2 = createKv()
    await post('/otp/send', { email }, env(kv2))
    const res2 = await post('/otp/verify', { email, code: '000000' }, env(kv2))
    const body2 = (await res2.json()) as { user: { id: string } }

    expect(body1.user.id).toBe(body2.user.id)
  })

  test('returns 400 for invalid email', async () => {
    const res = await post('/otp/verify', { email: 'bad', code: '000000' }, env(createKv()))
    expect(res.status).toMatchInlineSnapshot(`400`)
    const { success } = (await res.json()) as { success: boolean }
    expect(success).toMatchInlineSnapshot(`false`)
  })

  test('returns 400 for missing code', async () => {
    const res = await post('/otp/verify', { email: uniqueEmail() }, env(createKv()))
    expect(res.status).toMatchInlineSnapshot(`400`)
    const { success } = (await res.json()) as { success: boolean }
    expect(success).toMatchInlineSnapshot(`false`)
  })

  test('returns 400 for wrong code', async () => {
    const kv = createKv()
    const email = uniqueEmail()
    await post('/otp/send', { email }, env(kv))
    const res = await post('/otp/verify', { email, code: '999999' }, env(kv))
    expect(res.status).toMatchInlineSnapshot(`400`)
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": "Invalid or expired code",
      }
    `)
  })
})

function createKv(): KVNamespace {
  const store = new Map<string, { value: string; expiration?: number | undefined }>()
  return {
    get: async (key: string) => store.get(key)?.value ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, expiration: opts?.expirationTtl })
    },
    delete: async (key: string) => {
      store.delete(key)
    },
  } as unknown as KVNamespace
}

function createLimiter(): RateLimit {
  return { limit: async () => ({ success: true }) } as unknown as RateLimit
}

function env(kv: KVNamespace) {
  return {
    KV: kv,
    OTP_EMAIL_RATE_LIMITER: createLimiter(),
    OTP_IP_RATE_LIMITER: createLimiter(),
    OTP_VERIFY_EMAIL_RATE_LIMITER: createLimiter(),
  } as unknown as Env
}

function post(path: string, body: unknown, bindings: Env) {
  return auth.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    bindings,
  )
}

function uniqueEmail() {
  return `test-${crypto.randomUUID()}@example.com`
}
