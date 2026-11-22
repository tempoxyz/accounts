/**
 * Tests the `expo` preset in Node, on an in-memory stand-in for the device's secure store, since
 * Expo's native modules load only in an app.
 * @module
 */
import * as Esbuild from 'esbuild'
import * as ChildProcess from 'node:child_process'
import * as Path from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

/** The folder of the library's source. */
const src = Path.resolve(import.meta.dirname, '../src')

/** Bundles `contents` with the secure store and the system browser of a device in memory, and runs it in Node without Web Locks, as React Native. */
async function run(contents: string) {
  const output = await Esbuild.build({
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    platform: 'node',
    plugins: [
      {
        name: 'device',
        setup(build) {
          build.onResolve(
            { filter: /^expo-(secure-store|web-browser)$/ },
            (args) => ({ namespace: 'device', path: args.path }),
          )
          build.onLoad({ filter: /.*/, namespace: 'device' }, (args) => ({
            contents:
              args.path === 'expo-secure-store'
                ? [
                    // One keychain on the device. The bundle holds the module once, so every import shares it.
                    'const items = new Map()',
                    'export async function getItemAsync(key) { return items.get(key) ?? null }',
                    'export async function setItemAsync(key, value) { items.set(key, value) }',
                    'export async function deleteItemAsync(key) { items.delete(key) }',
                  ].join('\n')
                : 'export async function openAuthSessionAsync() { return { type: "cancel" } }',
            loader: 'js',
          }))
        },
      },
    ],
    stdin: { contents, loader: 'ts', resolveDir: src },
    write: false,
  })
  const result = ChildProcess.spawnSync(
    process.execPath,
    ['--input-type=module', '--no-experimental-global-navigator'],
    { encoding: 'utf8', input: output.outputFiles[0]!.text },
  )
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

describe('expo', () => {
  test('sends one refresh for two instances of two presets, which share the secure store of the device', async () => {
    // Two instances on one `url`, `clientId`, and chain hold one session, such as a config that
    // two modules create, or that Fast Refresh runs again while the old instance lives. Each has its
    // own `expo()`, and both read the device's one secure store.
    const output = await run(
      [
        "import * as Accounts from './Accounts.ts'",
        "import * as Session from './Session.ts'",
        "import { expo } from './plugins/expo.ts'",
        'const requests = []',
        'const create = () => Accounts.create({',
        '  chain: 1337,',
        "  clientId: 'client_1',",
        '  async fetch(input, init) {',
        "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
        '    requests.push(new URL(String(input)).pathname + " " + token)',
        "    return Response.json({ access_token: 'access-token-1', expires_in: 3600, refresh_token: 'refresh-token-1', token_type: 'Bearer' })",
        '  },',
        "  plugins: [expo({ redirectUri: 'com.example.app:/callback' })],",
        "  url: 'http://127.0.0.1:9',",
        '})',
        'await expo({ redirectUri: \'com.example.app:/callback\' })[0].config().store.setItem(\'tempo-id:session:["http://127.0.0.1:9","client_1",1337]\', {',
        "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
        '  version: 0,',
        '})',
        'const instances = [create(), create()]',
        'await Promise.all(instances.map((accounts) => accounts.session.get()))',
        'const sessions = await Promise.all(instances.map((accounts) => accounts.session.refresh()))',
        'console.log(JSON.stringify({ refreshTokens: sessions.map((session) => session?.refreshToken), requests }))',
      ].join('\n'),
    )

    expect(output).toMatchInlineSnapshot(`
      {
        "refreshTokens": [
          "refresh-token-1",
          "refresh-token-1",
        ],
        "requests": [
          "/oauth2/token refresh-token",
        ],
      }
    `)
  }, 20_000)
  test('throws the first invalid_grant of a refresh on Store.memory without Web Locks, as React Native, with one request', async () => {
    // Without Web Locks, the store's lock serializes every refresh in the process. Only this process
    // holds a `Store.memory`, so no other process can rotate its token, and Tempo ID's refusal is final.
    const output = await run(
      [
        "import * as Accounts from './Accounts.ts'",
        "import * as Session from './Session.ts'",
        "import * as Store from './Store.ts'",
        "import { expo } from './plugins/expo.ts'",
        'const requests = []',
        'const store = Store.memory()',
        'const accounts = Accounts.create({',
        '  chain: 1337,',
        "  clientId: 'client_1',",
        '  async fetch(input, init) {',
        "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
        '    requests.push(new URL(String(input)).pathname + " " + token)',
        "    return Response.json({ error: 'invalid_grant', error_description: 'The refresh token is revoked.' }, { status: 400 })",
        '  },',
        "  plugins: [expo({ redirectUri: 'com.example.app:/callback' })],",
        '  store,',
        "  url: 'http://127.0.0.1:9',",
        '})',
        'await store.setItem(\'tempo-id:session:["http://127.0.0.1:9","client_1",1337]\', {',
        "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
        '  version: 0,',
        '})',
        'await accounts.session.get()',
        'const started = Date.now()',
        'const error = await accounts.session.refresh().then(() => undefined, (error) => error)',
        'console.log(JSON.stringify({ code: error?.code, fast: Date.now() - started < 500, requests, session: await accounts.session.get() ?? null }))',
      ].join('\n'),
    )

    expect(output).toMatchInlineSnapshot(`
      {
        "code": "invalid_grant",
        "fast": true,
        "requests": [
          "/oauth2/token refresh-token",
        ],
        "session": null,
      }
    `)
  }, 20_000)
  test("throws the first invalid_grant of a refresh on the preset's secure store, with one request", async () => {
    // Only the app's process reads its secure store, and the preset's lock serializes its refreshes,
    // so Tempo ID's refusal, such as after a revocation on another device, is final.
    const output = await run(
      [
        "import * as Accounts from './Accounts.ts'",
        "import * as Session from './Session.ts'",
        "import { expo } from './plugins/expo.ts'",
        'const requests = []',
        'const accounts = Accounts.create({',
        '  chain: 1337,',
        "  clientId: 'client_1',",
        '  async fetch(input, init) {',
        "    const token = new URLSearchParams(String(init?.body)).get('refresh_token')",
        '    requests.push(new URL(String(input)).pathname + " " + token)',
        "    return Response.json({ error: 'invalid_grant', error_description: 'The refresh token is revoked.' }, { status: 400 })",
        '  },',
        "  plugins: [expo({ redirectUri: 'com.example.app:/callback' })],",
        "  url: 'http://127.0.0.1:9',",
        '})',
        'await accounts.config.store.setItem(\'tempo-id:session:["http://127.0.0.1:9","client_1",1337]\', {',
        "  state: { session: Session.from({ accessToken: 'access-token', expiresAt: Date.now() + 3600000, refreshToken: 'refresh-token', user: { email: 'user@example.com', id: 'user_1' } }) },",
        '  version: 0,',
        '})',
        'await accounts.session.get()',
        'const started = Date.now()',
        'const error = await accounts.session.refresh().then(() => undefined, (error) => error)',
        'console.log(JSON.stringify({ code: error?.code, fast: Date.now() - started < 500, requests, session: await accounts.session.get() ?? null }))',
      ].join('\n'),
    )

    expect(output).toMatchInlineSnapshot(`
      {
        "code": "invalid_grant",
        "fast": true,
        "requests": [
          "/oauth2/token refresh-token",
        ],
        "session": null,
      }
    `)
  }, 20_000)
})
