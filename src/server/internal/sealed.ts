import { Base64, Bytes, Hash } from 'ox'

/**
 * Encrypts a JSON payload into an opaque, URL-safe string bound to `kind`.
 *
 * Uses AES-256-GCM keyed by `SHA-256(secret)`. Sealed values are
 * self-contained, so hosts backed by eventually consistent storage (for
 * example Cloudflare KV) can verify them on any instance immediately.
 */
export async function seal(options: seal.Options): Promise<string> {
  const { kind, payload, secret, ttl } = options
  const iv = Bytes.random(12)
  const body = Bytes.fromString(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttl, kind, payload }),
  )
  const encrypted = await crypto.subtle.encrypt(
    { iv: iv as never, name: 'AES-GCM' },
    await key(secret),
    body as never,
  )
  return Base64.fromBytes(Bytes.concat(iv, new Uint8Array(encrypted)), { pad: false, url: true })
}

export declare namespace seal {
  /** Options for {@link seal}. */
  export type Options = {
    /** Purpose label checked by {@link unseal}; prevents cross-use of values. */
    kind: string
    /** JSON-serializable payload. */
    payload: unknown
    /** Server secret (at least 32 characters). */
    secret: string
    /** Lifetime in seconds. */
    ttl: number
  }
}

/**
 * Decrypts a value produced by {@link seal}. Returns `undefined` when the
 * value is malformed, tampered with, expired, or sealed for another `kind`.
 */
export async function unseal<payload = unknown>(
  options: unseal.Options,
): Promise<payload | undefined> {
  const { kind, secret, value } = options
  try {
    const bytes = Base64.toBytes(value)
    if (bytes.length < 29) return undefined
    const decrypted = await crypto.subtle.decrypt(
      { iv: bytes.slice(0, 12) as never, name: 'AES-GCM' },
      await key(secret),
      bytes.slice(12) as never,
    )
    const body = JSON.parse(Bytes.toString(new Uint8Array(decrypted))) as {
      exp: number
      kind: string
      payload: payload
    }
    if (body.kind !== kind) return undefined
    if (body.exp < Math.floor(Date.now() / 1000)) return undefined
    return body.payload
  } catch {
    return undefined
  }
}

export declare namespace unseal {
  /** Options for {@link unseal}. */
  export type Options = {
    /** Expected purpose label. */
    kind: string
    /** Server secret used by {@link seal}. */
    secret: string
    /** Sealed value. */
    value: string
  }
}

async function key(secret: string) {
  if (secret.length < 32) throw new Error('Sealing secret must be at least 32 characters.')
  return await crypto.subtle.importKey(
    'raw',
    Hash.sha256(Bytes.fromString(secret), { as: 'Bytes' }) as never,
    'AES-GCM',
    false,
    ['decrypt', 'encrypt'],
  )
}
