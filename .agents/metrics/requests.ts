/**
 * Writes Uphill's metric lines for the work that the package does on each request of an app: an
 * API's verification of an access token, and a client's DPoP proof. Each case is one item, run from
 * the build (`pnpm build`) against a key set in memory, so no case reaches the network.
 *
 * - `request-time`: CPU time per call, the median of 9 batches after a warm-up.
 * - `request-memory`: heap bytes that each call allocates: the growth of the used heap over a batch,
 *   plus what each garbage collection in the batch freed, as `v8.GCProfiler` reports it.
 *
 * Usage: node --expose-gc --single-threaded .agents/metrics/requests.ts
 * @module
 */
import * as Fs from 'node:fs'
import * as V8 from 'node:v8'
import { AccessToken } from 'accounts'
import { Dpop } from 'accounts/internal'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

/** The issuer of the tokens, which no case reaches. */
const issuer = 'https://id.test'

/** The app that receives the tokens. */
const clientId = 'bench'

/** The resource that a request names. */
const url = 'https://api.example.com/v1/orders'

/** The calls of each batch. */
const batch = 200

/** One case: a function that runs one call. */
type Case = () => Promise<unknown>

/** Returns the median of `values`. */
function median(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Returns the CPU time of one call of `fn`, in microseconds. */
async function time(fn: Case) {
  const samples: number[] = []
  for (let index = 0; index < 9; index++) {
    const start = process.cpuUsage()
    for (let call = 0; call < batch; call++) await fn()
    const usage = process.cpuUsage(start)
    samples.push((usage.user + usage.system) / batch)
  }
  return median(samples)
}

/** Returns the heap bytes that one call of `fn` allocates. */
async function allocated(fn: Case) {
  if (!globalThis.gc)
    throw new Error('Missing `gc`. Run the script with `--expose-gc`.')

  const samples: number[] = []
  for (let index = 0; index < 3; index++) {
    globalThis.gc()
    globalThis.gc()
    const profiler = new V8.GCProfiler()
    profiler.start()
    const before = V8.getHeapStatistics().used_heap_size
    for (let call = 0; call < batch; call++) await fn()
    const after = V8.getHeapStatistics().used_heap_size
    const freed = (profiler.stop()?.statistics ?? []).reduce(
      (total, event) =>
        total +
        event.beforeGC.heapStatistics.usedHeapSize -
        event.afterGC.heapStatistics.usedHeapSize,
      0,
    )
    samples.push((after - before + freed) / batch)
  }
  return median(samples)
}

const pair = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'bench' }
const verifier = AccessToken.create({
  clientId,
  fetch: () => Promise.resolve(Response.json({ keys: [jwk] })),
  url: issuer,
})

const dpop = await Dpop.create()

/** Signs an access token, bound to `dpop` when `bound` is set. */
function sign(bound: boolean) {
  return new SignJWT({
    client_id: clientId,
    scope: 'openid',
    ...(bound ? { cnf: { jkt: Dpop.thumbprint(dpop) } } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'bench', typ: 'at+jwt' })
    .setAudience(issuer)
    .setExpirationTime('1h')
    .setIssuedAt()
    .setIssuer(issuer)
    .setSubject('user_01KBVWH211PBG3MRJFXADJ37JS')
    .sign(pair.privateKey)
}

const bearer = await sign(false)
const bound = await sign(true)
const proof = await Dpop.proof(dpop, {
  accessToken: bound,
  method: 'GET',
  url,
})

const cases: Record<string, Case> = {
  'AccessToken.verify (Bearer)': () => verifier.verify({ accessToken: bearer }),
  'AccessToken.verify (DPoP)': () =>
    verifier.verify({
      accessToken: bound,
      dpop: { method: 'GET', proof, scheme: 'DPoP', url },
    }),
  'Dpop.proof': () =>
    Dpop.proof(dpop, { accessToken: bound, method: 'GET', url }),
}

const lines: string[] = []
for (const [name, fn] of Object.entries(cases)) {
  // A warm-up fetches the key set, and lets V8 optimize the call.
  for (let call = 0; call < batch * 5; call++) await fn()
  lines.push(
    `request-time "${name}" ${(await time(fn)).toFixed(2)}µs`,
    `request-memory "${name}" ${Math.round(await allocated(fn))}B`,
  )
}

const metrics = process.env.UPHILL_METRICS
if (!metrics)
  throw new Error('Missing `UPHILL_METRICS`. Run the script through `uphill`.')
Fs.appendFileSync(metrics, `${lines.join('\n')}\n`)
