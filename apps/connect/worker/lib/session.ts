import type { Context } from 'hono'
import { getCookie, deleteCookie } from 'hono/cookie'
import { sign as hono_sign, verify as hono_verify } from 'hono/jwt'
import { parse, serialize } from 'hono/utils/cookie'

const oneYear = 31536000

export type Wallet = {
  credentialId: string
  publicKey: string
  label?: string | undefined
}

export type Payload = {
  sub: string
  sid: string
  iat: number
  exp: number
  eml?: string | undefined
  wal?: { cid: string; pk: string; lbl?: string | undefined } | undefined
}

export type DecodedPayload = {
  sub: string
  sid: string
  email: string | null
  wallet: Wallet | null
}

type CookieEnv =
  | { kind: 'production'; domain: '.tempo.xyz' }
  | { kind: 'local'; domain: '.tempo.local' }
  | { kind: 'bare' }

/** Signs a session payload as a JWT (EdDSA / Ed25519). */
export async function sign(privateKeyJwk: string, userId: string, options: sign.Options = {}) {
  const jwk = parseJwk(privateKeyJwk)
  const now = Math.floor(Date.now() / 1000)
  const { wallet, email } = options
  const payload: Payload = {
    sub: userId,
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + oneYear,
    ...(email && { eml: email }),
    ...(wallet && {
      wal: {
        cid: wallet.credentialId,
        pk: wallet.publicKey,
        ...(wallet.label && { lbl: wallet.label }),
      },
    }),
  }
  return hono_sign(payload, jwk, 'EdDSA')
}

export declare namespace sign {
  type Options = {
    wallet?: Wallet | undefined
    email?: string | undefined
  }
}

/** Verifies and decodes a session JWT. Returns `null` if invalid or expired. */
export async function verify(publicKeyJwk: string, token: string): Promise<DecodedPayload | null> {
  try {
    const jwk = parseJwk(publicKeyJwk)
    const payload = (await hono_verify(token, jwk, 'EdDSA')) as Payload
    return {
      sub: payload.sub,
      sid: payload.sid,
      email: payload.eml ?? null,
      wallet: payload.wal
        ? {
            credentialId: payload.wal.cid,
            publicKey: payload.wal.pk,
            ...(payload.wal.lbl && { label: payload.wal.lbl }),
          }
        : null,
    }
  } catch {
    return null
  }
}

/** Sets the session cookie on the response. */
export async function set(
  c: Context,
  privateKeyJwk: string,
  userId: string,
  options: set.Options = {},
) {
  const hostname = new URL(c.req.url).hostname
  for (const cookie of await cookies(privateKeyJwk, userId, hostname, options))
    c.header('set-cookie', cookie, { append: true })
}

export declare namespace set {
  type Options = {
    wallet?: Wallet | undefined
    email?: string | undefined
    embed?: boolean | undefined
  }
}

/** Clears the session cookie. */
export function clear(c: Context) {
  const url = new URL(c.req.url)
  const env = cookieEnv(url.hostname)
  const name = cookieName(env)
  deleteCookie(c, name, {
    path: '/',
    ...(env.kind !== 'bare' && { domain: env.domain }),
    ...(env.kind === 'production' && { prefix: 'secure' }),
  })
}

/** Returns raw `Set-Cookie` header values for the session token. */
export async function cookies(
  privateKeyJwk: string,
  userId: string,
  hostname: string,
  options: set.Options = {},
) {
  const token = await sign(privateKeyJwk, userId, options)
  const env = cookieEnv(hostname)
  const name = cookieName(env)
  const sameSite = options.embed ? 'None' : 'Lax'
  return [
    serialize(name, token, {
      path: '/',
      httpOnly: true,
      sameSite,
      maxAge: oneYear,
      secure: env.kind === 'production' || sameSite === 'None',
      ...(env.kind !== 'bare' && { domain: env.domain }),
    }),
  ]
}

/** Extracts and verifies the session from a Hono context's cookies. */
export async function fromRequest(c: Context, publicKeyJwk: string) {
  const token =
    getCookie(c, 'session', 'secure') ?? getCookie(c, 'session', 'host') ?? getCookie(c, 'session')
  if (!token) return null
  return verify(publicKeyJwk, token)
}

/** Extracts and verifies the session from a raw `Request`'s cookies. */
export async function fromRawRequest(request: Request, publicKeyJwk: string) {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return null
  const env = cookieEnv(new URL(request.url).hostname)
  const token = parse(cookieHeader)[cookieName(env)]
  if (!token) return null
  return verify(publicKeyJwk, token)
}

function parseJwk(jwk: string): JsonWebKey {
  const parsed = JSON.parse(jwk) as JsonWebKey
  if (parsed.alg === 'Ed25519') parsed.alg = 'EdDSA'
  return parsed
}

function cookieEnv(hostname: string): CookieEnv {
  if (hostname.endsWith('.tempo.xyz')) return { kind: 'production', domain: '.tempo.xyz' }
  if (hostname.endsWith('.tempo.local')) return { kind: 'local', domain: '.tempo.local' }
  return { kind: 'bare' }
}

function cookieName(env: CookieEnv) {
  return env.kind === 'production' ? '__Secure-session' : 'session'
}
