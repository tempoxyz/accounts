/**
 * Tests of the store of the `expo` preset, on a secure store in memory.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as DeviceStore from './DeviceStore.js'

describe('create', () => {
  test("empties the session of an instance on another preset's store at once, as `Store.memory` does", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    const secureStore = memory()
    // Each instance creates its own store, as two `expo` presets of one app do.
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'https://app.example.com',
        store: DeviceStore.create(secureStore),
        url: 'http://127.0.0.1:9',
      })
    await DeviceStore.create(secureStore).setItem(name, {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: Date.now() + 3_600_000,
          refreshToken: 'refresh-token',
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const accounts = create()
    const other = create()
    await Promise.all([accounts.session.get(), other.session.get()])

    // Nothing listens at the URL, so the revocation rejects. The sign-out still empties the session.
    await accounts.signOut().catch(() => undefined)

    await expect
      .poll(() => other.session.status.get().status, { timeout: 1_000 })
      .toBe('signedOut')
    expect(await other.session.get()).toMatchInlineSnapshot(`undefined`)
  })

  test('sets local, since only the app reads its secure store, so a refusal of a refresh token is final', () => {
    const store = DeviceStore.create(memory())

    expect({
      local: store.local,
      lock: typeof store.lock,
    }).toMatchInlineSnapshot(`
      {
        "local": true,
        "lock": "function",
      }
    `)
  })
})

/**
 * Returns the platform capability that `expo-secure-store` provides on a device: strings at keys, in
 * memory.
 */
function memory() {
  const values = new Map<string, string>()
  return {
    deleteItemAsync(key: string) {
      values.delete(key)
      return Promise.resolve()
    },
    getItemAsync: (key: string) => Promise.resolve(values.get(key) ?? null),
    setItemAsync(key: string, value: string) {
      values.set(key, value)
      return Promise.resolve()
    },
  } satisfies DeviceStore.create.SecureStore
}
