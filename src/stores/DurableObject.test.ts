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
async function run(contents: readonly string[], options: run.Options = {}) {
  const { compatibilityDate = '2026-01-01' } = options

  const output = await Esbuild.build({
    bundle: true,
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:workers'],
    format: 'esm',
    logLevel: 'silent',
    platform: 'browser',
    stdin: {
      contents: [
        "import { DurableObject } from 'cloudflare:workers'",
        "import * as Accounts from '../Accounts.ts'",
        "import * as Session from '../Session.ts'",
        "import * as DurableObjectStore from './DurableObject.ts'",
        'export class STORE extends DurableObject {',
        '  store = DurableObjectStore.create(this.ctx.storage)',
        '  alarm() { return this.store.alarm() }',
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
      compatibilityDate,
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

declare namespace run {
  type Options = {
    /** The compatibility date of the Worker. Defaults to `2026-01-01`. */
    compatibilityDate?: string | undefined
  }
}

describe('Store.durableObject', () => {
  test('behavior: restores a session in a Worker without `WeakRef`', async () => {
    const { result } = await run(
      [
        'const accounts = Accounts.create({',
        '  chain: 1337,',
        "  clientId: 'https://app.example.com',",
        '  store,',
        "  url: 'http://127.0.0.1:9',",
        '})',
        'await store.setItem(\'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]\', {',
        "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
        '  version: 0,',
        '})',
        'const session = await accounts.session.get()',
        'return Response.json({ status: accounts.session.status.get().status, user: session?.user.id, weakRef: typeof WeakRef })',
      ],
      { compatibilityDate: '2025-01-01' },
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "status": "signedIn",
        "user": "user_1",
        "weakRef": "undefined",
      }
    `)
  }, 30_000)

  test('behavior: lock runs a second call of a key after the first settles, in a runtime without Web Locks', async () => {
    const { result } = await run([
      'const order = []',
      'let release',
      'const held = new Promise((resolve) => { release = resolve })',
      "const first = store.lock('session', async () => { order.push('first.start'); await held; order.push('first.end') })",
      "const second = store.lock('session', async () => { order.push('second') })",
      "const other = store.lock('other', async () => { order.push('other') })",
      'release()',
      'await Promise.all([first, second, other])',
      'return Response.json({ locks: typeof navigator.locks, order })',
    ])

    expect(result).toMatchInlineSnapshot(`
      {
        "locks": "undefined",
        "order": [
          "first.start",
          "other",
          "first.end",
          "second",
        ],
      }
    `)
  }, 30_000)

  test('behavior: connect delivers a post to the other listeners of its key only', async () => {
    const { result } = await run([
      'const received = []',
      "const first = (message) => received.push(['first', message])",
      "const second = (message) => received.push(['second', message])",
      "const other = (message) => received.push(['other', message])",
      "const post = store.connect('session', first)",
      "store.connect('session', second)",
      "store.connect('other', other)",
      "post('signedOut')",
      'await new Promise((resolve) => queueMicrotask(resolve))',
      'return Response.json({ received })',
    ])

    expect(result).toMatchInlineSnapshot(`
      {
        "received": [
          [
            "second",
            "signedOut",
          ],
        ],
      }
    `)
  }, 30_000)

  test('behavior: takeItem returns a value to one of concurrent calls, and no expired value', async () => {
    const { result } = await run([
      "await store.setItem('challenge', 'value')",
      "await store.setItem('expired', 'value', { expiresAt: Date.now() - 1 })",
      "const taken = await Promise.all([store.takeItem('challenge'), store.takeItem('challenge'), store.takeItem('challenge')])",
      "const expired = await store.takeItem('expired')",
      "const after = await store.getItem('challenge')",
      'return Response.json({ after: after ?? null, expired: expired ?? null, taken: taken.map((value) => value ?? null) })',
    ])

    expect(result).toMatchInlineSnapshot(`
      {
        "after": null,
        "expired": null,
        "taken": [
          "value",
          null,
          null,
        ],
      }
    `)
  }, 30_000)

  test('behavior: session.refresh that Tempo ID refuses throws after one request', async () => {
    const { result } = await run([
      'const requests = []',
      'const accounts = Accounts.create({',
      '  chain: 1337,',
      "  clientId: 'https://app.example.com',",
      '  async fetch(input, init) {',
      "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
      "    requests.push(new URL(String(input)).pathname + ' ' + token)",
      "    return Response.json({ error: 'invalid_grant' }, { status: 400 })",
      '  },',
      '  store,',
      "  url: 'http://127.0.0.1:9',",
      '})',
      'await store.setItem(\'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]\', {',
      "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
      '  version: 0,',
      '})',
      'await accounts.session.get()',
      'const error = await accounts.session.refresh().then(() => undefined, (error) => error)',
      'return Response.json({ error: error?.name + " " + error?.code, requests, status: accounts.session.status.get().status })',
    ])

    expect(result).toMatchInlineSnapshot(`
      {
        "error": "Accounts.RequestError invalid_grant",
        "requests": [
          "/oauth2/token refresh-token",
        ],
        "status": "signedOut",
      }
    `)
  }, 30_000)
})
