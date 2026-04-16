import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod/mini'

import * as Db from './lib/db/index.js'
import { accounts, eq } from './lib/db/schema.js'
import * as Middleware from './lib/middleware.js'
import * as Otp from './lib/otp.js'
import * as RateLimit from './lib/rate-limit.js'

export const email = new Hono<{ Bindings: Env }>()
  /** `POST /send-otp` — send a verification code to the given email. Requires a valid session. */
  .post(
    '/send-otp',
    Middleware.requireSession(),
    zValidator('json', z.object({ email: z.email() })),
    async (c) => {
      const { email } = c.req.valid('json')

      const bypass = process.env.BYPASS_EMAIL_OTP === 'true'
      const ip = c.req.header('cf-connecting-ip') ?? 'unknown'

      if (!bypass) {
        if (!(await RateLimit.check(c.env.OTP_EMAIL_RATE_LIMITER, email)))
          return c.json({ error: 'Too many requests' }, 429)
        if (!(await RateLimit.check(c.env.OTP_IP_RATE_LIMITER, ip)))
          return c.json({ error: 'Too many requests' }, 429)
        if (!(await RateLimit.checkDailyGlobal(c.env.KV)))
          return c.json({ error: 'Too many requests' }, 429)
        if (!(await RateLimit.checkDailyEmail(c.env.KV, email)))
          return c.json({ error: 'Too many requests' }, 429)
      }

      const code = Otp.generate(bypass)
      await Otp.set(c.env.KV, email, code)

      if (!bypass) {
        const form = new FormData()
        form.append('from', 'Tempo <noreply@tempo.xyz>')
        form.append('to', email)
        form.append('subject', `${code} is your Tempo verification code`)
        form.append(
          'text',
          `Your verification code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request this code, you can safely ignore this email.`,
        )

        const res = await fetch(
          `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
          {
            method: 'POST',
            headers: { Authorization: `Basic ${btoa(`api:${process.env.MAILGUN_API_KEY}`)}` },
            body: form,
          },
        )
        if (!res.ok) return c.json({ error: 'Failed to send email' }, 500)
      }

      return c.json({ ok: true })
    },
  )

  /** `POST /verify-otp` — verify the code and bind the email to the session's account. */
  .post(
    '/verify-otp',
    Middleware.requireSession(),
    zValidator('json', z.object({ email: z.email(), code: z.string().check(z.minLength(1)) })),
    async (c) => {
      const { email, code } = c.req.valid('json')
      const { address } = c.var.session

      const bypass = process.env.BYPASS_EMAIL_OTP === 'true'
      const ip = c.req.header('cf-connecting-ip') ?? 'unknown'

      if (!bypass) {
        if (!(await RateLimit.check(c.env.OTP_IP_RATE_LIMITER, ip)))
          return c.json({ error: 'Too many requests' }, 429)
        if (!(await RateLimit.check(c.env.OTP_VERIFY_EMAIL_RATE_LIMITER, email)))
          return c.json({ error: 'Too many requests' }, 429)
      }

      const valid = await Otp.verify(c.env.KV, email, code)
      if (!valid) return c.json({ error: 'Invalid or expired code' }, 400)

      const db = Db.get(c.env.HYPERDRIVE)
      await db
        .update(accounts)
        .set({ email, updatedAt: new Date() })
        .where(eq(accounts.address, address as `0x${string}`))

      return c.json({ ok: true, email })
    },
  )
