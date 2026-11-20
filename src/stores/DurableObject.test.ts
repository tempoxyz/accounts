/**
 * Tests of `Store.durableObject` against a Durable Object of Miniflare, which runs workerd's
 * storage.
 * @module
 */
import * as Esbuild from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { describe, expect, onTestFinished, test } from 'vite-plus/test'

/**
 * Runs `contents` in the `fetch` of a Durable Object, with `store`, the object's
 * `Store.durableObject`. Returns the JSON that it returns, and `read`, which returns the JSON of
 * the object's `this.read()`.
 */
async function run(contents: readonly string[]) {
  const output = await Esbuild.build({
    bundle: true,
    external: ['cloudflare:workers'],
    format: 'esm',
    logLevel: 'silent',
    conditions: ['workerd', 'worker', 'browser'],
    platform: 'browser',
    stdin: {
      contents: [
        "import { DurableObject } from 'cloudflare:workers'",
        "import * as Accounts from '../Accounts.ts'",
        "import * as Session from '../Session.ts'",
        "import * as DurableObjectStore from './DurableObject.ts'",
        'export class STORE extends DurableObject {',
        '  store = DurableObjectStore.create(this.ctx.storage)',
        '  async fetch(request) {',
        "    if (new URL(request.url).pathname === '/read') return Response.json(this.read())",
        '    const store = this.store',
        ...contents,
        '  }',
        '}',
        'export default {',
        "  fetch: (request, env) => env.STORE.get(env.STORE.idFromName('store')).fetch(request),",
        '}',
      ].join('\n'),
      loader: 'ts',
      resolveDir: import.meta.dirname,
    },
    write: false,
  })
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: '2026-01-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { STORE: { className: 'STORE', useSQLite: true } },
      modules: true,
      script: output.outputFiles[0]!.text,
    }),
  )
  onTestFinished(() => miniflare.dispose())
  const response = await miniflare.dispatchFetch('http://localhost/')
  const read = async () =>
    (await (
      await miniflare.dispatchFetch('http://localhost/read')
    ).json()) as unknown
  return { read, result: (await response.json()) as unknown }
}

describe('Store.durableObject', () => {
  test('behavior: sends one refresh for two instances in one object, whose runtime has no Web Locks', async () => {
    const { result } = await run([
      'const requests = []',
      'const create = () => Accounts.create({',
      '  chain: 1337,',
      "  clientId: 'https://app.example.com',",
      '  async fetch(input, init) {',
      "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
      '    requests.push(new URL(String(input)).pathname + " " + token)',
      "    return Response.json({ access_token: 'access-token-1', expires_in: 3600, refresh_token: 'refresh-token-1', token_type: 'Bearer' })",
      '  },',
      '  store,',
      "  url: 'http://127.0.0.1:9',",
      '})',
      'await store.setItem(\'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]\', {',
      "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
      '  version: 0,',
      '})',
      'const instances = [create(), create()]',
      'await Promise.all(instances.map((accounts) => accounts.session.get()))',
      'const sessions = await Promise.all(instances.map((accounts) => accounts.session.refresh()))',
      'return Response.json({ locks: typeof navigator.locks, refreshTokens: sessions.map((session) => session?.refreshToken), requests })',
    ])

    expect(result).toMatchInlineSnapshot(`
      {
        "locks": "undefined",
        "refreshTokens": [
          "refresh-token-1",
          "refresh-token-1",
        ],
        "requests": [
          "/oauth2/token refresh-token",
        ],
      }
    `)
  }, 30_000)

  test('behavior: a sign-out of one instance in the object empties the session of another at once', async () => {
    const { read } = await run([
      'const requests = []',
      'const create = () => Accounts.create({',
      '  chain: 1337,',
      "  clientId: 'https://app.example.com',",
      '  async fetch(input) {',
      '    requests.push(new URL(String(input)).pathname)',
      '    return new Response(null, { status: 200 })',
      '  },',
      '  store,',
      "  url: 'http://127.0.0.1:9',",
      '})',
      'await store.setItem(\'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]\', {',
      "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
      '  version: 0,',
      '})',
      'const [first, second] = [create(), create()]',
      'await Promise.all([first.session.get(), second.session.get()])',
      'await first.signOut()',
      'this.read = () => ({ first: first.session.status.get().status, requests, second: second.session.status.get().status })',
      'return Response.json(null)',
    ])

    await expect.poll(read).toMatchObject({ second: 'signedOut' })
    expect(await read()).toMatchInlineSnapshot(`
      {
        "first": "signedOut",
        "requests": [
          "/oauth2/revoke",
        ],
        "second": "signedOut",
      }
    `)
  }, 30_000)
})
