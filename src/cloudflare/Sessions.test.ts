/**
 * Tests of `Sessions.durableObject` against the Durable Objects of `DurableObject.sessions` in
 * Miniflare, which runs workerd.
 * @module
 */
import * as Esbuild from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { describe, expect, onTestFinished, test } from 'vite-plus/test'

/**
 * Runs `contents` in the `fetch` of a Worker, with `accounts`, an instance whose `backend`
 * keeps its sessions in the Worker's Durable Objects, and `names`, the object names that it
 * reached. Returns the JSON that it returns.
 */
async function run(contents: readonly string[]) {
  const output = await Esbuild.build({
    bundle: true,
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:workers'],
    format: 'esm',
    logLevel: 'silent',
    platform: 'browser',
    stdin: {
      contents: [
        "import * as Accounts from '../Accounts.ts'",
        "import { backend } from '../plugins/backend.ts'",
        "import { DurableObject, Sessions } from './index.ts'",
        "export const SESSIONS = DurableObject.sessions(() => ({ clientSecret: 'secret' }))",
        'export default {',
        '  async fetch(request, env) {',
        '    const names = []',
        '    const namespace = {',
        '      getByName: (name) => (names.push(name), env.SESSIONS.getByName(name)),',
        '    }',
        '    const accounts = Accounts.create({',
        '      chain: 42431,',
        "      clientId: 'app',",
        "      clientSecret: 'secret',",
        '      plugins: [backend({ sessions: Sessions.durableObject(namespace) })],',
        "      redirectUri: 'https://app.example.com/callback',",
        "      url: 'http://127.0.0.1:9',",
        '    })',
        '    const error = (e) => ({ field: e.field, name: e.name, objects: names.length })',
        ...contents,
        '  },',
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
      durableObjects: { SESSIONS: { className: 'SESSIONS', useSQLite: true } },
      modules: true,
      script: output.outputFiles[0]!.text,
    }),
  )
  onTestFinished(() => miniflare.dispose())
  const response = await miniflare.dispatchFetch('http://localhost/')
  return (await response.json()) as unknown
}

describe('Sessions.durableObject', () => {
  test('behavior: refuses an `id` of `start` and `save` that is no session ID before it reaches an object', async () => {
    const result = await run([
      "const ids = ['a b', 'a'.repeat(2000)]",
      'const results = []',
      'for (const id of ids) {',
      '  names.length = 0',
      '  results.push(await accounts.backend.start({ id }).catch(error))',
      '  names.length = 0',
      '  results.push(',
      '    await accounts.backend',
      "      .save({ id, session: { accessToken: 'access-token', expiresAt: Date.now() + 3600000, user: { email: 'user@example.com', id: 'user_1' } } })",
      '      .catch(error),',
      '  )',
      '}',
      'return Response.json(results)',
    ])

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "field": "id",
          "name": "Accounts.RequestError",
          "objects": 0,
        },
        {
          "field": "id",
          "name": "Accounts.RequestError",
          "objects": 0,
        },
        {
          "field": "id",
          "name": "Accounts.RequestError",
          "objects": 0,
        },
        {
          "field": "id",
          "name": "Accounts.RequestError",
          "objects": 0,
        },
      ]
    `)
  })

  test("behavior: a sign-in requests the scope of the Worker's instance", async () => {
    const result = await run([
      'const scoped = Accounts.create({',
      '  chain: 42431,',
      "  clientId: 'app',",
      "  clientSecret: 'secret',",
      '  plugins: [backend({ sessions: Sessions.durableObject(namespace) })],',
      "  redirectUri: 'https://app.example.com/callback',",
      "  scope: 'offline_access api:read',",
      "  url: 'http://127.0.0.1:9',",
      '})',
      'const { url } = await scoped.backend.start({ par: false })',
      "return Response.json(new URL(url).searchParams.get('scope'))",
    ])

    expect(result).toMatchInlineSnapshot(
      `"openid email offline_access api:read"`,
    )
  })
})
