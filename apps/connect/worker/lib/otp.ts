import { Hash, Hex } from 'ox'

const ttlSeconds = 5 * 60
const ttlMs = ttlSeconds * 1000
const maxAttempts = 5
const maxCodes = 5

type CodeEntry = { hash: string; createdAt: number }
type OtpData = { codes: CodeEntry[]; attempts: number }

/** Generates a 6-digit OTP code. Returns `'000000'` when `bypass` is true. */
export function generate(bypass?: boolean | undefined) {
  if (bypass) return '000000'
  return ((crypto.getRandomValues(new Uint32Array(1))[0]! % 900000) + 100000).toString()
}

/** Hashes and stores a code in KV for the given email. */
export async function set(kv: KVNamespace, email: string, code: string) {
  const hash = sha256(code)
  const raw = await kv.get(key(email))
  const existing = raw ? (JSON.parse(raw) as OtpData) : null
  let data: OtpData
  if (existing) {
    data = pruneExpired(existing)
    data.codes.push({ hash, createdAt: Date.now() })
    if (data.codes.length > maxCodes) data.codes = data.codes.slice(-maxCodes)
  } else {
    data = { codes: [{ hash, createdAt: Date.now() }], attempts: 0 }
  }
  await kv.put(key(email), JSON.stringify(data), { expirationTtl: ttlSeconds })
}

/** Verifies a code against stored hashes. Returns `true` if valid. */
export async function verify(kv: KVNamespace, email: string, code: string) {
  const raw = await kv.get(key(email))
  if (!raw) return false

  const pruned = pruneExpired(JSON.parse(raw) as OtpData)
  if (pruned.codes.length === 0) return false

  const hash = sha256(code)
  if (!pruned.codes.some((c) => c.hash === hash)) {
    if (pruned.attempts + 1 >= maxAttempts) await kv.delete(key(email))
    else
      await kv.put(key(email), JSON.stringify({ ...pruned, attempts: pruned.attempts + 1 }), {
        expirationTtl: ttlSeconds,
      })
    return false
  }

  await kv.delete(key(email))
  return true
}

function key(email: string) {
  return `otp:${email}`
}

function pruneExpired(data: OtpData): OtpData {
  const now = Date.now()
  return { ...data, codes: data.codes.filter((c) => now - c.createdAt < ttlMs) }
}

function sha256(input: string) {
  return Hash.sha256(Hex.fromString(input))
}
