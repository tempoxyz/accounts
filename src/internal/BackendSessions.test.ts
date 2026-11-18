/**
 * Runs the logout index of a backend's sessions on a store that two replicas share, without a
 * server.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Store from '../Store.js'
import * as BackendSessions from './BackendSessions.js'

describe('BackendSessions.create', () => {
  test('ends a session that one replica links while another replica closes its `sid` at a logout token', async () => {
    const store = Store.memory()
    const [a, b] = [replica(remote(store)), replica(remote(store))]

    const [linked, closed] = await Promise.all([
      a.link({ expiresAt: Date.now() + 3_600_000, id: 'a', sid: 'sid' }),
      b.close({ sid: 'sid' }),
    ])

    // Either the logout token finds the session, or the sign-in finds the logout.
    expect(
      linked.closed || closed.some((entry) => entry.id === 'a'),
    ).toMatchInlineSnapshot(`true`)
  })

  test('keeps the close of a `sid` once another replica links a session of it at the same time', async () => {
    const store = Store.memory()
    const [a, b] = [replica(remote(store)), replica(remote(store))]
    const expiresAt = Date.now() + 3_600_000

    await Promise.all([
      b.close({ sid: 'sid' }),
      a.link({ expiresAt, id: 'a', sid: 'sid' }),
    ])
    const later = await b.link({ expiresAt, id: 'b', sid: 'sid' })

    expect(later).toMatchInlineSnapshot(`
      {
        "closed": true,
      }
    `)
  })

  test('keeps a sign-in of a `sid` whose tokens Tempo ID issued after the logout token that closed it', async () => {
    const store = Store.memory()
    const [a, b] = [replica(store), replica(store)]
    const expiresAt = Date.now() + 3_600_000
    const issuedAt = 1_800_000_000_000

    await a.link({
      expiresAt,
      id: 'before',
      issuedAt: issuedAt - 1_000,
      sid: 'sid',
    })
    const closed = await b.close({ issuedAt, sid: 'sid' })
    // The app disconnects, which keeps the Tempo ID session, so the user signs in again with it.
    const again = await a.link({
      expiresAt,
      id: 'again',
      issuedAt: issuedAt + 1_000,
      sid: 'sid',
    })
    const during = await a.link({
      expiresAt,
      id: 'during',
      issuedAt,
      sid: 'sid',
    })
    // Tempo ID retries the logout token after a failure.
    const retried = await b.close({ issuedAt, sid: 'sid' })
    // A process of an earlier release reads only whether the logout key is `true`.
    const logout = await store.getItem('tempo-id:logout:sid')

    expect({
      again,
      closed: closed.map((entry) => entry.id),
      during,
      logout,
      retried: retried.map((entry) => entry.id),
    }).toMatchInlineSnapshot(`
      {
        "again": {
          "closed": false,
        },
        "closed": [
          "before",
        ],
        "during": {
          "closed": true,
        },
        "logout": true,
        "retried": [
          "before",
          "again",
          "during",
        ],
      }
    `)
  })

  test('keeps the latest logout token issue of a `sid` after a delayed delivery of an earlier token', async () => {
    const store = Store.memory()
    const [a, b] = [replica(store), replica(store)]
    const expiresAt = Date.now() + 3_600_000
    const issuedAt = 1_800_000_000_000

    await a.close({ issuedAt, sid: 'sid' })
    await b.close({ issuedAt: issuedAt - 60_000, sid: 'sid' })
    const between = await a.link({
      expiresAt,
      id: 'between',
      issuedAt: issuedAt - 30_000,
      sid: 'sid',
    })

    expect({
      between,
      issuedAt: await store.getItem('tempo-id:logout-issued-at:sid'),
    }).toMatchInlineSnapshot(`
      {
        "between": {
          "closed": true,
        },
        "issuedAt": 1800000000000,
      }
    `)
  })

  test('opens the index of a `sid` 20 minutes after its close, also while a kept session holds it', async () => {
    const store = Store.memory()
    const [a, b] = [replica(store), replica(store)]
    const expiresAt = Date.now() + 3_600_000
    const issuedAt = Date.now() - 1_300_000

    await a.link({
      expiresAt,
      id: 'before',
      issuedAt: issuedAt - 1_000,
      sid: 'sid',
    })
    await b.close({ issuedAt, sid: 'sid' })
    await a.link({
      expiresAt,
      id: 'kept',
      issuedAt: issuedAt + 1_000,
      sid: 'sid',
    })
    await a.unlink({ ids: ['before'], sid: 'sid' })
    // The close happened 20 minutes ago, past the store's expiry of its logout key.
    const index = (await store.getItem('tempo-id:sid:sid')) as object
    await store.setItem('tempo-id:sid:sid', {
      ...index,
      closedUntil: Date.now() - 1,
    })
    await Promise.all([
      store.removeItem('tempo-id:logout:sid'),
      store.removeItem('tempo-id:logout-issued-at:sid'),
    ])
    const later = await a.link({ expiresAt, id: 'later', sid: 'sid' })

    expect(later).toMatchInlineSnapshot(`
      {
        "closed": false,
      }
    `)
  })

  test('writes the logout cutoff of a `sid` before its logout key', async () => {
    const memory = Store.memory()
    const writes: string[] = []
    const store = Store.from({
      ...memory,
      async removeItem(key) {
        writes.push(key)
        return memory.removeItem(key)
      },
      async setItem(key, value, options) {
        writes.push(key)
        return memory.setItem(key, value, options)
      },
    })

    await replica(store).close({ issuedAt: 1_800_000_000_000, sid: 'sid' })

    expect(writes.filter((key) => key.startsWith('tempo-id:logout')))
      .toMatchInlineSnapshot(`
      [
        "tempo-id:logout-issued-at:sid",
        "tempo-id:logout:sid",
      ]
    `)
  })

  test('keeps the later issue of an entry that saves of one ID link out of order', async () => {
    const store = Store.memory()
    const sessions = replica(store)
    const expiresAt = Date.now() + 3_600_000
    const issuedAt = 1_800_000_000_000

    await sessions.link({
      expiresAt,
      id: 'id',
      issuedAt: issuedAt + 2_000,
      sid: 'sid',
    })
    await sessions.link({
      expiresAt,
      id: 'id',
      issuedAt: issuedAt - 2_000,
      sid: 'sid',
    })
    const index = (await store.getItem('tempo-id:sid:sid')) as {
      entries: readonly { issuedAt?: number }[]
    }

    expect(index.entries.map((entry) => entry.issuedAt)).toMatchInlineSnapshot(`
      [
        1800000002000,
      ]
    `)
  })

  test('returns the entry of an ID whose saves link a later issue than the session they store', async () => {
    const store = Store.memory()
    const sessions = replica(store)
    const expiresAt = Date.now() + 3_600_000
    const issuedAt = 1_800_000_000_000

    // The save of the later session links first, and the save of the earlier session stores last.
    await sessions.link({
      expiresAt,
      id: 'id',
      issuedAt: issuedAt + 2_000,
      sid: 'sid',
    })
    await sessions.link({
      expiresAt,
      id: 'id',
      issuedAt: issuedAt - 2_000,
      sid: 'sid',
    })
    const closed = await sessions.close({ issuedAt, sid: 'sid' })

    expect(closed.map((entry) => entry.id)).toMatchInlineSnapshot(`
      [
        "id",
      ]
    `)
  })

  test('closes each session of a `sid` that two instances on one store link at the same time', async () => {
    const store = Store.memory()
    const [a, b] = [replica(store), replica(store)]
    const expiresAt = Date.now() + 3_600_000

    await Promise.all([
      a.link({ expiresAt, id: 'a', sid: 'sid' }),
      b.link({ expiresAt, id: 'b', sid: 'sid' }),
    ])
    const closed = await a.close({ sid: 'sid' })

    expect(closed.map((entry) => entry.id).sort()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
      ]
    `)
  })
})

/**
 * Returns the data of `store` as another process reads it, without the `lock` that orders the
 * calls of one process.
 */
function remote(store: Store.Store): Store.Store {
  return { ...store, lock: undefined }
}

/** Returns the sessions of one replica of a backend on `store`. */
function replica(store: Store.Store) {
  const accounts = Accounts.create({
    clientId: 'https://app.example.com',
    url: 'http://127.0.0.1:9',
  })
  return BackendSessions.create(accounts.config, { shared: true, store })
}
