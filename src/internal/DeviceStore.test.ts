/**
 * Tests of the store of the `expo` preset, on a secure store in memory.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as DeviceStore from './DeviceStore.js'

describe('create', () => {
  test("empties the session of another instance on the device's secure store at once, as `Store.memory` does", async () => {
    const name =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",1337]'
    // The device's secure store, which holds strings, as `expo-secure-store` does.
    const values = new Map<string, string>()
    const secureStore = {
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
    const requests: string[] = []
    // Each instance creates its own preset, as two configs of one app do.
    const create = () =>
      Accounts.create({
        chain: 1337,
        clientId: 'https://app.example.com',
        fetch(input) {
          requests.push(new URL(String(input)).pathname)
          return Promise.resolve(new Response(null, { status: 200 }))
        },
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

    await accounts.signOut()

    await expect
      .poll(() => other.session.status.get().status, { timeout: 1_000 })
      .toBe('signedOut')
    expect({ requests, session: await other.session.get() })
      .toMatchInlineSnapshot(`
        {
          "requests": [
            "/oauth2/revoke",
          ],
          "session": undefined,
        }
      `)
  })
})
