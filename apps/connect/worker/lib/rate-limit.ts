const dailyEmailLimit = 20
const dailyGlobalLimit = 100_000
const oneDay = 86_400

/** Checks a CF Rate Limiter binding. Returns `true` if allowed. */
export async function check(limiter: RateLimit, key: string) {
  const result = await limiter.limit({ key })
  return result.success
}

/** Increments and checks daily email OTP counter (20/email/day). Returns `true` if allowed. */
export async function checkDailyEmail(kv: KVNamespace, email: string) {
  return (await incrementDaily(`daily-otp:email:${email}:${todayKey()}`, kv)) <= dailyEmailLimit
}

/** Increments and checks daily global OTP counter (100k/day). Returns `true` if allowed. */
export async function checkDailyGlobal(kv: KVNamespace) {
  return (await incrementDaily(`daily-otp:global:${todayKey()}`, kv)) <= dailyGlobalLimit
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

async function incrementDaily(key: string, kv: KVNamespace) {
  const raw = await kv.get(key)
  const count = raw ? Number.parseInt(raw, 10) + 1 : 1
  await kv.put(key, count.toString(), { expirationTtl: oneDay })
  return count
}
