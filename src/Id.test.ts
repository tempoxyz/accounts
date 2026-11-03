/**
 * Runs `Id.create` and its sign-in plugins against `apps/id`: the session, its store, its race
 * guard, and each plugin's flow. The suite runs no Tempo node, so no test sends a transaction.
 * @module
 */
import { Actions, Id, Plugin, Session, Store } from 'accounts'
import * as Plugins from 'accounts/plugins'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Address } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo, tempoTestnet } from 'viem/tempo/chains'
import { ousd } from 'viem/tokens'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import { waitFor } from 'xstate'
import * as Admin from '../test/Admin.js'
import * as Client from '../test/Client.js'
import * as Passkeys from '../test/Passkeys.js'
import { Database, Env, Harness, Realm, Schema, Sql } from '../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()
const server = Harness.create()

/** OUSD, which has its mainnet address on every Tempo chain. */
const ousdAddress = ousd(tempo.id).address

beforeAll(async () => {
  await Promise.all([admin.listen(), server.listen()])
})

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') {
    admin.debug()
    server.debug()
  }
  await Promise.all([admin.reset(), server.reset()])
})

afterAll(async () => {
  await Promise.all([admin.close(), database.end(), server.close()])
})

describe('Id.create', () => {
  test("defaults to Tempo mainnet's chain ID, or Tempo testnet's with dev, as Viem's chains name them", () => {
    expect(Id.create({ clientId: 'client_test' }).config.chainId).toBe(tempo.id)
    expect(
      Id.create({ clientId: 'client_test', dev: true }).config.chainId,
    ).toBe(tempoTestnet.id)
  })

  test('throws ClientIdRequiredError without a client ID outside a browser, and refuses a plugin whose ID an instance holds', () => {
    expect(() => Id.create()).toThrow(Id.ClientIdRequiredError)
    expect(() =>
      Id.create({
        clientId: 'client_test',
        plugins: [Plugin.from({ id: 'session' })],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid plugin ID: session is a member of every instance. Give the plugin another \`id\`.]`,
    )
  })

  test("flattens nested and falsy entries, applies each plugin's config under the options that create receives, and adds each plugin's members", () => {
    const store = Store.memory()
    const preset = () =>
      [
        Plugin.from({
          config: () => ({ redirectUri: 'myapp:/callback', store }),
          id: 'preset',
        }),
        Plugins.email(),
      ] as const
    const tempoId = Id.create({
      clientId: 'client_test',
      plugins: [
        preset(),
        false,
        Plugin.from({
          extend: (instance: Id.Id) => ({
            clientIdOf: () => instance.config.clientId,
          }),
          id: 'members',
        }),
      ],
      redirectUri: 'myapp:/other',
    })

    expect(tempoId.config.redirectUri).toBe('myapp:/other')
    expect(tempoId.config.store).toBe(store)
    // The preset's store holds the session, as a store that `create` receives does.
    expect(tempoId.session.actor).toBeDefined()
    expect(typeof tempoId.email.signIn).toBe('function')
    expect('preset' in tempoId).toBe(false)
    expect(tempoId.clientIdOf()).toBe('client_test')
  })

  test("passes a plugin's extend the context of its actions, whose session.reload sets another instance's later sign-in on the same store, such as another tab's", async () => {
    const store = Store.memory()
    const app = await seed()
    const email = address()
    const contexts: Plugin.Context[] = []
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: app.harness.fetch,
      plugins: [
        Plugin.from({
          extend: (_: Id.Id, context: Plugin.Context) => {
            contexts.push(context)
            return {}
          },
          id: 'reader',
        }),
      ],
      redirectUri: app.redirectUri,
      store,
      url: Env.origin,
    })
    const second = instance(app, { store })

    const before = await tempoId.session.get()
    await second.email.sendCode({ email })
    await second.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const cached = await tempoId.session.get()
    const reloaded = await contexts[0]?.session.reload()

    expect(before).toBeUndefined()
    expect(cached).toBeUndefined()
    expect(reloaded?.user.email).toBe(email)
    expect(tempoId.session.status.get().status).toBe('signedIn')
  })

  test("refuses a plugin's member whose name the instance holds", () => {
    expect(() =>
      Id.create({
        clientId: 'client_test',
        plugins: [
          Plugin.from({ extend: () => ({ signOut: () => {} }), id: 'clash' }),
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid plugin member: signOut is a member of the instance already. Give the member of the clash plugin another name.]`,
    )
  })

  test('keeps the namespace of a plugin whose ID is `__proto__`', () => {
    const tempoId = Id.create({
      clientId: 'client_test',
      plugins: [
        Plugin.from({
          actions: () => ({ ping: () => 'pong' }),
          id: '__proto__',
        }),
      ],
    }) as unknown as Record<string, { ping: () => string }>

    expect(Object.hasOwn(tempoId, '__proto__')).toBe(true)
    expect(tempoId['__proto__']!.ping()).toMatchInlineSnapshot(`"pong"`)
  })

  test("refuses a plugin's non-enumerable member whose name the instance holds", () => {
    expect(() =>
      Id.create({
        clientId: 'client_test',
        plugins: [
          Plugin.from({
            extend: () =>
              Object.defineProperty({}, 'session', {
                enumerable: false,
                value: undefined,
              }),
            id: 'hidden',
          }),
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid plugin member: session is a member of the instance already. Give the member of the hidden plugin another name.]`,
    )
  })

  test('holds the dialog plugin without a sign-in plugin, and none beside another sign-in plugin', () => {
    const plain = Id.create({ clientId: 'client_test' })
    const withEmail = Id.create({
      clientId: 'client_test',
      plugins: [Plugins.email()],
    })
    const withViem = Id.create({
      clientId: 'client_test',
      plugins: [Plugins.viem()],
    })

    expect(Object.keys(plain.dialog).sort()).toEqual(['callback', 'signIn'])
    expect(typeof withViem.dialog.signIn).toBe('function')
    expect('dialog' in withEmail).toBe(false)
  })

  test("signs in several users at once on an instance without a store, as a backend's, and none of them overtakes another", async () => {
    const app = await seed()
    const tempoId = instance(app, { store: undefined })
    const emails = [address(), address()]
    for (const email of emails) await tempoId.email.sendCode({ email })
    const codes = await Promise.all(
      emails.map((email) => Harness.code(server, { email })),
    )

    const sessions = await Promise.all(
      emails.map((email, index) =>
        tempoId.email.signIn({ code: codes[index]!, email }),
      ),
    )

    expect(sessions.map((session) => session.user.email)).toEqual(emails)
  })

  test('holds no session outside a browser without a store, so a sign-in returns its session and saves none', async () => {
    const app = await seed()
    const tempoId = instance(app, { store: undefined })
    const email = address()

    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    expect(session.user.email).toBe(email)
    expect(await tempoId.session.get()).toBeUndefined()
    expect(tempoId.session.actor).toBeUndefined()
  })
})

describe('session', () => {
  test('sets the session at a sign-in, notifies each subscriber, and saves it, which another instance on the same store restores', async () => {
    const store = Store.memory()
    const app = await seed()
    const tempoId = instance(app, { store })
    const seen: (string | undefined)[] = []
    tempoId.session.subscribe((session) => seen.push(session?.user.email))
    const email = address()

    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const restored = await instance(app, { store }).session.get()

    const { upgradeAvailable: _, ...stored } = session

    expect(seen).toEqual([email])
    expect(await tempoId.session.get()).toEqual(stored)
    expect(restored?.user).toEqual(session.user)
    expect(restored?.key?.keyAuthorization).toEqual(
      session.key?.keyAuthorization,
    )
    expect(
      Address.isEqual(restored!.account!.address, session.account!.address),
    ).toBe(true)
    expect(
      Address.isEqual(session.account!.address, session.key!.account),
    ).toBe(true)
  })

  test('reads the store again after a read that fails, as a transient store error does, and restores the saved session', async () => {
    const store = Store.memory()
    const app = await seed()
    const email = address()
    const signedIn = instance(app, { store })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const held = { failing: true }
    // The first read fails, as an aborted IndexedDB transaction does.
    const flaky = Store.from({
      ...store,
      getItem: (key) => {
        if (!held.failing) return store.getItem(key)
        held.failing = false
        return Promise.reject(new Error('The store is unavailable.'))
      },
    })
    const tempoId = instance(app, { store: flaky })

    const first = await tempoId.session.get()
    const second = await tempoId.session.get()

    expect(first).toBeUndefined()
    expect(second?.user.email).toBe(email)
  })

  test('empties the session at signOut, deletes the saved session, ends the server session, and revokes the refresh token', async () => {
    const store = Store.memory()
    const app = await seed()
    const tempoId = instance(app, { store })
    const email = address()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    await tempoId.signOut()
    const refresh = await Actions.refresh(tempoId.config, {
      refreshToken: session.refreshToken!,
    }).catch((error: Id.RequestError) => [error.status, error.code])
    const account = await app.harness.fetch(
      new URL(`/v1/account?client_id=${app.clientId}`, Env.origin),
      { credentials: 'include' },
    )

    expect(await tempoId.session.get()).toBeUndefined()
    expect(await instance(app, { store }).session.get()).toBeUndefined()
    expect(account.status).toMatchInlineSnapshot(`401`)
    expect(refresh).toMatchInlineSnapshot(`
      [
        400,
        "invalid_grant",
      ]
    `)
  })

  test('keeps the sign-in that commits last of two overlapping sign-ins, whose user the server session holds too', async () => {
    const app = await seed()
    const tempoId = instance(app, { store: Store.memory() })
    const emails = [address(), address()]
    for (const email of emails) await tempoId.email.sendCode({ email })
    const codes = await Promise.all(
      emails.map((email) => Harness.code(server, { email })),
    )

    const sessions = await Promise.all(
      emails.map((email, index) =>
        tempoId.email.signIn({ code: codes[index]!, email }),
      ),
    )
    const held = await tempoId.session.get()
    const account = await tempoId.account.get()

    expect(sessions.map((session) => session.user.email)).toEqual(emails)
    expect(emails).toContain(held?.user.email)
    expect(Address.isEqual(account!.address, held!.account!.address)).toBe(true)
  })

  test('throws SupersededError for a sign-in that a sign-out overtook, and keeps the session empty', async () => {
    const app = await seed()
    const tempoId = instance(app, { store: Store.memory() })
    const email = address()
    await tempoId.email.sendCode({ email })
    const code = await Harness.code(server, { email })

    const pending = tempoId.email
      .signIn({ code, email })
      .catch((error: unknown) => error)
    await tempoId.signOut()

    expect(await pending).toBeInstanceOf(Id.SupersededError)
    expect(await tempoId.session.get()).toBeUndefined()
  })

  test('keeps no key and no saved session after a sign-in without an access key, and holds the account that Tempo ID selects', async () => {
    const app = await seed()
    const tempoId = instance(app, { store: Store.memory() })
    const email = address()

    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      accessKey: false,
    })

    expect(session.key).toBeUndefined()
    expect(session.account?.address).toMatch(/^0x[0-9a-f]{40}$/i)
  })
  test('signs in with a plain accessKey object, which resolves at each sign-in, and with the accessKey of one sign-in in place of it', async () => {
    const app = await seed()
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: app.harness.fetch,
      accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()

    await tempoId.email.sendCode({ email })
    const before = Math.floor(Date.now() / 1000)
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const signed = KeyAuthorization.fromRpc(session.key!.keyAuthorization)

    expect(signed.expiry! - before).toBeGreaterThanOrEqual(86_400)
    expect(signed.expiry! - before).toBeLessThan(86_400 + 60)
    expect(signed.limits?.map((entry) => entry.limit)).toEqual([10_000_000n])

    await tempoId.email.sendCode({ email })
    const override = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      accessKey: { expiry: '1h', limits: [{ limit: '2', token: 'ousd' }] },
    })
    const overridden = KeyAuthorization.fromRpc(override.key!.keyAuthorization)

    expect(overridden.expiry! - before).toBeLessThan(3_600 + 60)
    expect(overridden.limits?.map((entry) => entry.limit)).toEqual([2_000_000n])
  })
})

describe('authorize', () => {
  test('restores the same user in two instances on one store at once, such as two tabs, and supersedes neither', async () => {
    const store = Store.memory()
    const app = await seed()
    const email = address()
    const signedIn = instance(app, { store: Store.memory() })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const first = instance(app, { store })
    const second = instance(app, { store })

    const results = await Promise.all([
      first.authorize().catch((error: unknown) => error),
      second.authorize().catch((error: unknown) => error),
    ])

    expect(
      results.map(
        (result) =>
          (result as { user?: { email?: string } } | undefined)?.user?.email,
      ),
    ).toEqual([email, email])
  })

  test("keeps another instance's sign-in that the store holds when an authorization in flight finds no Tempo ID session, such as another tab's", async () => {
    const store = Store.memory()
    const app = await seed()
    const email = address()
    const second = instance(app, { store })
    const held = { done: false }
    // After Tempo ID reports no session, the second instance signs a user in.
    const tempoId = instance(app, {
      fetch: async (input, init) => {
        const response = await app.harness.fetch(input, init)
        const url = new URL(input instanceof Request ? input.url : input)
        if (!held.done && url.pathname === '/v1/auth/session') {
          held.done = true
          await second.email.sendCode({ email })
          await second.email.signIn({
            code: await Harness.code(server, { email }),
            email,
          })
        }
        return response
      },
      store,
    })

    const result = await tempoId.authorize()
    const restored = await instance(app, { store }).session.get()

    expect(held.done).toBe(true)
    expect(result).toBeUndefined()
    expect(restored?.user.email).toBe(email)
  })

  test("lets another instance's sign-in of another user that the store holds supersede an authorization in flight, such as another tab's, and keeps that sign-in", async () => {
    const store = Store.memory()
    const app = await seed()
    const email = address()
    const other = address()
    const signedIn = instance(app, { store: Store.memory() })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const second = instance(app, { store })
    const held = { done: false }
    // After Tempo ID answers the authorization, the second instance signs another user in.
    const tempoId = instance(app, {
      fetch: async (input, init) => {
        const response = await app.harness.fetch(input, init)
        const url = new URL(input instanceof Request ? input.url : input)
        if (!held.done && url.pathname.startsWith('/v1/authorize')) {
          held.done = true
          await second.email.sendCode({ email: other })
          await second.email.signIn({
            code: await Harness.code(server, { email: other }),
            email: other,
          })
        }
        return response
      },
      store,
    })

    const result = await tempoId.authorize().catch((error: unknown) => error)
    const restored = await instance(app, { store }).session.get()

    expect(held.done).toBe(true)
    expect(result).toBeInstanceOf(Id.SupersededError)
    expect(restored?.user.email).toBe(other)
  })

  test("sets the session from the browser's Tempo ID session with no sign-in, on a new store, and empties it without one", async () => {
    const app = await seed()
    const email = address()
    const signedIn = instance(app, { store: Store.memory() })
    await signedIn.email.sendCode({ email })
    const keyless = await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      accessKey: false,
    })
    const tempoId = instance(app, { store: Store.memory() })

    const session = await tempoId.authorize()
    await signedIn.signOut()
    const signedOut = await instance(app, { store: Store.memory() }).authorize()

    expect(session?.user.email).toBe(email)
    // The access key names the account, so the session reads no account of its own.
    expect(
      Address.isEqual(session!.key!.account, keyless.account!.address),
    ).toBe(true)
    expect(await tempoId.session.get()).toMatchObject({ user: { email } })
    expect(signedOut).toBeUndefined()
  })
})

describe('session.status', () => {
  test('calls a listener with each new status and the one before it, until it unsubscribes', async () => {
    const app = await seed()
    const tempoId = instance(app, { store: Store.memory() })
    const email = address()
    const seen: (readonly [string, string])[] = []
    const unsubscribe = tempoId.session.status.subscribe((status, previous) =>
      seen.push([previous.status, status.status]),
    )

    await tempoId.session.get()
    await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    unsubscribe()
    await tempoId.signOut()

    expect(seen).toEqual([
      ['pending', 'signedOut'],
      ['signedOut', 'signedIn'],
    ])
    expect(tempoId.session.status.get().status).toBe('signedOut')
  })

  test('holds pending until the first read, signedOut without a saved session, and signedIn after a sign-in', async () => {
    const app = await seed()
    const tempoId = instance(app, { store: Store.memory() })
    const seen = statuses(tempoId)
    const email = address()

    const initial = tempoId.session.status.get()
    await tempoId.session.get()
    const read = tempoId.session.status.get()
    await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const signedIn = tempoId.session.status.get()

    expect(initial).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "status": "pending",
      }
    `)
    expect(read.status).toMatchInlineSnapshot(`"signedOut"`)
    expect(signedIn.status).toMatchInlineSnapshot(`"signedIn"`)
    expect(signedIn.session?.user.email).toBe(email)
    expect(tempoId.session.status.get()).toBe(signedIn)
    expect(seen).toMatchInlineSnapshot(`
      [
        "signedOut",
        "signedIn",
      ]
    `)
  })

  test('holds pending while session.get with authorize authorizes a visitor without a saved session, then signedIn', async () => {
    const app = await seed()
    const email = address()
    await signedInAt(app, { email })
    const tempoId = instance(app, { store: Store.memory() })
    const seen = statuses(tempoId)

    const session = await tempoId.session.get({ reauthorize: true })

    expect(session?.user.email).toBe(email)
    expect(session).not.toHaveProperty('upgradeAvailable')
    expect(seen).toMatchInlineSnapshot(`
      [
        "signedIn",
      ]
    `)
    expect(tempoId.session.status.get().session).toEqual(session)
  })

  test('shows a saved session whose access key expired as reauthorizing while session.get with authorize renews it, then signedIn with a new access key', async () => {
    const app = await seed()
    const email = address()
    const store = expiring(Store.memory())
    const signedIn = instance(app, { store })
    await signedIn.email.sendCode({ email })
    const first = await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const tempoId = instance(app, { store })
    const seen: (readonly [string, string | undefined])[] = []
    tempoId.session.status.subscribe((status) =>
      seen.push([status.status, status.session?.user.email]),
    )

    store.expire()
    const session = await tempoId.session.get({ reauthorize: true })

    expect(seen).toEqual([
      ['reauthorizing', email],
      ['signedIn', email],
    ])
    expect(session?.key?.keyAuthorization).not.toEqual(
      first.key?.keyAuthorization,
    )
    expect(tempoId.session.status.get().session).toEqual(session)
  })

  test('shows a saved session whose access key expired as reauthorizing, then signedOut when the browser holds no Tempo ID session', async () => {
    const app = await seed()
    const email = address()
    const store = expiring(Store.memory())
    const signedIn = instance(app, { store })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    // The logout ends the Tempo ID session, and the expired copy stays in the store.
    const logout = await signedIn.config.fetch!(
      new URL('/v1/auth/logout', signedIn.config.url),
      {
        body: '{}',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    expect(logout.ok).toBe(true)
    const tempoId = instance(app, { store })
    const seen = statuses(tempoId)

    store.expire()
    const session = await tempoId.session.get({ reauthorize: true })

    expect(session).toBeUndefined()
    expect(seen).toMatchInlineSnapshot(`
      [
        "reauthorizing",
        "signedOut",
      ]
    `)
  })

  test('never shows the expired session again, or signs in, after a sign-out during its renewal', async () => {
    const app = await seed()
    const email = address()
    const store = expiring(Store.memory())
    const signedIn = instance(app, { store })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const tempoId = instance(app, { store })
    const seen = statuses(tempoId)

    store.expire()
    const renewing = tempoId.session
      .get({ reauthorize: true })
      .catch((error: unknown) => error)
    await waitFor(tempoId.session.actor!, (snapshot) =>
      snapshot.matches('reauthorizing'),
    )
    await tempoId.signOut()
    const result = await renewing

    // The sign-out overtakes the renewal, which returns no session, or throws SupersededError.
    expect(result === undefined || result instanceof Id.SupersededError).toBe(
      true,
    )
    expect(seen[0]).toBe('reauthorizing')
    expect(seen.at(-1)).toBe('signedOut')
    expect(seen.slice(1)).not.toContain('reauthorizing')
    expect(seen).not.toContain('signedIn')
    expect(await tempoId.session.get()).toBeUndefined()
  })

  test("keeps its own session at a refresh when the store holds another instance's later sign-in of another user, whose access key expired", async () => {
    const app = await seed()
    const memory = Store.memory()
    const saved = expiring(memory)
    const signIn = async (tempoId: ReturnType<typeof instance>) => {
      const email = address()
      await tempoId.email.sendCode({ email })
      return tempoId.email.signIn({
        code: await Harness.code(server, { email }),
        email,
      })
    }
    // Two tabs on one store: the first holds its user, and the store holds the second's.
    const first = instance(app, { store: saved })
    const own = await signIn(first)
    await signIn(instance(app, { store: saved }))
    saved.expire()

    const refreshed = await first.session.refresh()

    expect(refreshed?.user.id).toBe(own.user.id)
    expect(first.session.status.get().session?.user.id).toBe(own.user.id)
  })

  test('restores no saved session whose access key expired at a refresh after a read of the store that failed', async () => {
    const app = await seed()
    const email = address()
    const memory = Store.memory()
    const signedIn = instance(app, { store: memory })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const saved = expiring(memory)
    // The first read fails, as a transient store error does, and every later read succeeds.
    const reads = { count: 0 }
    const store = Store.from({
      ...saved,
      async getItem(key) {
        if (++reads.count === 1) throw new Error('The store is unavailable.')
        return saved.getItem(key)
      },
    })
    const tempoId = instance(app, { store })
    saved.expire()

    const first = await tempoId.session.get()
    const refreshed = await tempoId.session.refresh()

    expect(first).toBeUndefined()
    expect(refreshed).toBeUndefined()
    expect(tempoId.session.status.get()).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "status": "signedOut",
      }
    `)
  })

  test('empties a saved session whose access key expired, and holds signedOut, at session.get without authorize', async () => {
    const app = await seed()
    const email = address()
    const store = expiring(Store.memory())
    const signedIn = instance(app, { store })
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const tempoId = instance(app, { store })
    const seen = statuses(tempoId)

    store.expire()
    const session = await tempoId.session.get()

    expect(session).toBeUndefined()
    expect(seen).toMatchInlineSnapshot(`
      [
        "signedOut",
      ]
    `)
  })

  test("returns no session, and holds signedOut, when session.get with reauthorize meets a passkey-owned account's webauthn_required", async () => {
    // Without a realm, the app reads the user's wallet.tempo account.
    const app = await seed({ realm: false })
    const email = address()
    await signedInAt(app, { email })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    // A wallet.tempo passkey owns the account, so only its ceremony on the page signs an access key.
    await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })
    const tempoId = instance(app, { store: Store.memory() })

    const session = await tempoId.session.get({ reauthorize: true })

    expect(session).toBeUndefined()
    expect(tempoId.session.status.get().status).toBe('signedOut')
  })
  test("returns no session when session.get with reauthorize and passkey meets Tempo ID's webauthn_required before any ceremony, such as on a page outside the passkey's relying party", async () => {
    // Without a realm, the app reads the user's wallet.tempo account. The page's origin is outside
    // the passkey's relying party, so Tempo ID refuses before any ceremony.
    const app = await seed({ realm: false })
    const email = address()
    await signedInAt(app, { email })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })
    const tempoId = instance(app, { store: Store.memory() })

    const session = await tempoId.session.get({
      reauthorize: {
        getFn: () => Promise.reject(new Error('No ceremony runs.')),
        passkey: true,
      },
    })

    expect(session).toBeUndefined()
    expect(tempoId.session.status.get().status).toBe('signedOut')
  })

  test('throws webauthn_required with its cause when session.get with reauthorize and passkey runs a ceremony on the page that fails', async () => {
    // The page's origin is inside the passkey's relying party, so Tempo ID sends the passkey's step,
    // and the ceremony runs on the page.
    const app = await seed({
      origin: `https://app.${Passkeys.rpId}`,
      realm: false,
    })
    const email = address()
    await signedInAt(app, { email })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })
    const tempoId = instance(app, { store: Store.memory() })
    const dismissed = new Error('The user dismissed the prompt.')

    const error = await tempoId.session
      .get({
        reauthorize: { getFn: () => Promise.reject(dismissed), passkey: true },
      })
      .catch((error: unknown) => error)

    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"webauthn_required"`,
    )
    // ox wraps the ceremony's error in its own, which the refusal holds as its cause.
    expect(causes(error)).toContain(dismissed)
  })

  test('runs a function in authorize as the authorization, and returns its session', async () => {
    const app = await seed()
    const email = address()
    await signedInAt(app, { email })
    const tempoId = instance(app, { store: Store.memory() })
    const during: string[] = []

    const session = await tempoId.session.get({
      async reauthorize() {
        during.push(tempoId.session.status.get().status)
        return await tempoId.authorize({ accessKey: false })
      },
    })

    expect(during).toMatchInlineSnapshot(`
      [
        "pending",
      ]
    `)
    expect(session?.user.email).toBe(email)
    expect(session?.key).toBeUndefined()
  })
})

describe('session (a change during a change)', () => {
  test("rejects a change that a status subscriber commits during another change when the store refuses that change's own write", async () => {
    const app = await seed()
    const email = address()
    const memory = Store.memory()
    // The store refuses only the nested change's session.
    const store = Store.from({
      ...memory,
      async setItem(key, value, options) {
        const saved = value as {
          state?: { session?: { accessToken?: string } }
        }
        if (saved.state?.session?.accessToken === 'nested')
          throw new Error('The store refused the write.')
        await memory.setItem(key, value, options)
      },
    })
    const holder: { context?: Plugin.Context } = {}
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: app.harness.fetch,
      accessKey: permissions,
      plugins: [
        Plugins.email(),
        Plugin.from({
          id: 'capture',
          setup: (context) => {
            holder.context = context
          },
        }),
      ],
      redirectUri: app.redirectUri,
      store,
      url: Env.origin,
    })
    const nested: Promise<unknown>[] = []
    tempoId.session.status.subscribe((status) => {
      if (status.status !== 'signedIn' || nested.length > 0) return
      nested.push(
        holder
          .context!.session.change({ update: true })
          .commit(Session.from({ ...status.session, accessToken: 'nested' }))
          .then(
            () => 'committed',
            (error: Error) => error.message,
          ),
      )
    })

    await tempoId.email.sendCode({ email })
    await tempoId.email
      .signIn({ code: await Harness.code(server, { email }), email })
      .catch(() => undefined)

    expect(await nested[0]).toMatchInlineSnapshot(
      `"The store refused the write."`,
    )
  })
})

describe('session.refresh', () => {
  test("replaces the session's tokens with the refresh token, keeps its key, and saves it, and returns undefined without a session", async () => {
    const store = Store.memory()
    const app = await seed()
    const tempoId = instance(app, { store })
    const email = address()

    const before = await tempoId.session.refresh()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const refreshed = await tempoId.session.refresh()

    expect(before).toBeUndefined()
    expect(refreshed?.accessToken).not.toBe(session.accessToken)
    expect(refreshed?.key).toEqual(session.key)
    expect((await instance(app, { store }).session.get())?.accessToken).toBe(
      refreshed?.accessToken,
    )
  })
})

describe('session.refresh (two instances)', () => {
  test("refreshes with the token that another instance on the same store rotated, such as another tab's, and never replays the earlier token", async () => {
    const store = Store.memory()
    const app = await seed()
    const first = instance(app, { store })
    const email = address()
    await first.email.sendCode({ email })
    await first.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const second = instance(app, { store })
    await second.session.get()

    const rotated = await first.session.refresh()
    const refreshed = await second.session.refresh()
    const again = await first.session.refresh()

    // A replay of the earlier token returns the rotation's tokens again, so a new access token shows
    // that the second instance sent the rotated token.
    expect(refreshed?.accessToken).not.toBe(rotated?.accessToken)
    expect(again?.accessToken).not.toBe(refreshed?.accessToken)
  })

  test("keeps another instance's later sign-in when Tempo ID refuses the refresh token that it replaced, such as another tab's, and returns that session", async () => {
    const store = Store.memory()
    const app = await seed()
    const first = instance(app, { store })
    const email = address()
    const other = address()
    await first.email.sendCode({ email })
    const session = await first.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    // While the second instance's refresh is in flight, the first instance signs another user in,
    // and the sent token is revoked, so Tempo ID refuses it.
    const second = instance(app, {
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (
          url.pathname === '/oauth2/token' &&
          String(init?.body).includes('refresh_token')
        ) {
          await first.email.sendCode({ email: other })
          await first.email.signIn({
            code: await Harness.code(server, { email: other }),
            email: other,
          })
          const revoked = await harnessFetch(
            new URL('/oauth2/revoke', first.config.url),
            {
              body: new URLSearchParams({
                client_id: first.config.clientId,
                token: session.refreshToken!,
                token_type_hint: 'refresh_token',
              }),
              method: 'POST',
            },
          )
          expect(revoked.ok).toBe(true)
        }
        return app.harness.fetch(input, init)
      },
      store,
    })
    await second.session.get()

    const refreshed = await second.session.refresh()
    const restored = await instance(app, { store }).session.get()

    expect(refreshed?.user.email).toBe(other)
    expect(restored?.user.email).toBe(other)
  })
})

describe('signOut (overlapping)', () => {
  test("revokes the session's refresh token once for overlapping sign-outs, so the user's session on another device keeps refreshing", async () => {
    const app = await seed()
    const email = address()
    const device = instance(app, { store: Store.memory() })
    await device.email.sendCode({ email })
    await device.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const tempoId = instance(app, { store: Store.memory() })
    await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    await Promise.all([tempoId.signOut(), tempoId.signOut()])
    const refreshed = await device.session.refresh()

    expect(await tempoId.session.get()).toBeUndefined()
    // A second revocation of the token would read as a reuse, which revokes the device's tokens too.
    expect(refreshed?.user.email).toBe(email)
  })
})

describe('signOut (two instances)', () => {
  test("revokes a shared session's refresh token once when two instances on one store sign out, such as two tabs, so the user's other device keeps refreshing", async () => {
    const app = await seed()
    const email = address()
    const device = instance(app, { store: Store.memory() })
    await device.email.sendCode({ email })
    await device.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const memory = Store.memory()
    const held = { gated: false, reads: 0 }
    const released = Promise.withResolvers<void>()
    // While `gated`, each save waits until both instances read the session, as two tabs that sign
    // out at once both read it before either empty session saves.
    const store = Store.from({
      ...memory,
      getItem(key) {
        if (held.gated && ++held.reads === 2) released.resolve()
        return memory.getItem(key) as never
      },
      async setItem(key, value, options) {
        if (held.gated) await released.promise
        return memory.setItem(key, value, options)
      },
    })
    const first = instance(app, { store })
    await first.email.sendCode({ email })
    await first.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    const second = instance(app, { store })
    await second.session.get()

    held.gated = true
    await Promise.all([first.signOut(), second.signOut()])
    const refreshed = await device.session.refresh()

    expect(await second.session.get()).toBeUndefined()
    expect(refreshed?.user.email).toBe(email)
  })
})

describe('signOut (during a sign-in)', () => {
  test('overtakes a sign-in that starts while a sign-out runs, also when a second sign-out shares the first', async () => {
    const app = await seed()
    const memory = Store.memory()
    const gate = Promise.withResolvers<void>()
    const held = { gated: false }
    // The store holds back each save while `gated`, so the first sign-out stays in progress.
    const tempoId = instance(app, {
      store: Store.from({
        ...memory,
        async setItem(key, value, options) {
          if (held.gated) await gate.promise
          return memory.setItem(key, value, options)
        },
      }),
    })
    const [first, second] = [address(), address()]
    for (const email of [first, second]) await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email: first }),
      email: first,
    })
    const code = await Harness.code(server, { email: second })

    held.gated = true
    const signingOut = tempoId.signOut()
    await expect.poll(() => tempoId.session.get()).toBeUndefined()
    const pending = tempoId.email
      .signIn({ code, email: second })
      .catch((error: unknown) => error)
    const shared = tempoId.signOut()
    gate.resolve()
    await Promise.all([signingOut, shared])

    expect(await pending).toBeInstanceOf(Id.SupersededError)
    expect(await tempoId.session.get()).toBeUndefined()
  })
})

describe('signOut (failed saves)', () => {
  test("revokes the refresh token that the instance holds, not the store's earlier copy, and rejects with the save's error when the store refuses every save", async () => {
    const app = await seed()
    const memory = Store.memory()
    const held = { failing: false }
    const tempoId = instance(app, {
      store: Store.from({
        ...memory,
        async setItem(key, value, options) {
          if (held.failing) throw new Error('The disk is full.')
          await memory.setItem(key, value, options)
        },
      }),
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    const first = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    // The refresh rotates the token in the instance, while the store keeps the earlier copy.
    held.failing = true
    await tempoId.session.refresh().catch(() => undefined)
    const current = await tempoId.session.get()
    const error = await tempoId.signOut().catch((error: unknown) => error)
    const refreshed = await Actions.refresh(tempoId.config, {
      refreshToken: current!.refreshToken!,
    }).catch((error: unknown) => error)

    expect(current?.refreshToken).not.toBe(first.refreshToken)
    expect((error as Error).message).toBe('The disk is full.')
    expect((refreshed as Id.RequestError).code).toBe('invalid_grant')
  })
})

describe('signOut (behind a refresh)', () => {
  test('keeps a sign-in that starts after a sign-out and commits while a refresh holds the lock', async () => {
    const app = await seed()
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    const held = { gated: false }
    // The first token request waits for `gate`, so the refresh holds the lock until then.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (held.gated && url.includes('/oauth2/token')) {
        held.gated = false
        reached.resolve()
        await gate.promise
      }
      return app.harness.fetch(input, init)
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const [first, second] = [address(), address()]
    for (const email of [first, second]) await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email: first }),
      email: first,
    })
    const code = await Harness.code(server, { email: second })

    held.gated = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut()
    await expect.poll(() => tempoId.session.get()).toBeUndefined()
    const session = await tempoId.email.signIn({ code, email: second })
    gate.resolve()
    await Promise.all([refreshing, signingOut])

    const refreshed = await tempoId.session.refresh()

    // The later sign-in owns the browser's Tempo ID session, so the sign-out ends no logout, and
    // the later sign-in's tokens still refresh.
    expect(refreshed?.user.email).toBe(second)
    expect(session.user.email).toBe(second)
  })
})

describe('signOut (behind a refresh, same user)', () => {
  test("revokes the refresh's new token when the same user signs in again during the refresh, and keeps the new sign-in", async () => {
    const app = await seed()
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    const issued = Promise.withResolvers<string>()
    const held = { gated: false }
    const revoked: string[] = []
    // The first token request waits for `gate`, and its new refresh token resolves `issued`. Each
    // revocation records its token. Tempo ID refuses a revocation from a page on another site, as
    // the suite's client is, so the test reads the requests the instance sends.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/oauth2/revoke'))
        revoked.push(new URLSearchParams(String(init?.body)).get('token')!)
      if (!held.gated || !url.includes('/oauth2/token'))
        return app.harness.fetch(input, init)
      held.gated = false
      reached.resolve()
      await gate.promise
      const response = await app.harness.fetch(input, init)
      const body = (await response.clone().json()) as { refresh_token: string }
      issued.resolve(body.refresh_token)
      return response
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    const first = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.gated = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut()
    await expect.poll(() => tempoId.session.get()).toBeUndefined()
    await tempoId.email.sendCode({ email })
    const again = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    gate.resolve()
    await Promise.all([refreshing, signingOut])

    const refreshed = await tempoId.session.refresh()

    // The refresh rotated the first token, so only the refresh's new token is revoked. The later
    // sign-in owns the Tempo ID session, so its tokens still refresh.
    expect(revoked).toEqual([await issued.promise])
    expect(revoked).not.toContain(first.refreshToken)
    expect(refreshed?.user.email).toBe(email)
    expect(refreshed?.refreshToken).not.toBe(again.refreshToken)
  })
})

describe('signOut (authorize during the sign-out)', () => {
  test('ends the Tempo ID session once when an authorize runs while the sign-out waits for a refresh, and restores no session', async () => {
    const app = await seed()
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    const held = { gated: false }
    const logouts: string[] = []
    // The first token request waits for `gate`. Each logout is recorded.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/v1/auth/logout')) logouts.push(url)
      if (held.gated && url.includes('/oauth2/token')) {
        held.gated = false
        reached.resolve()
        await gate.promise
      }
      return app.harness.fetch(input, init)
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.gated = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut()
    await expect.poll(() => tempoId.session.get()).toBeUndefined()
    const restored = await tempoId.authorize().catch((error: unknown) => error)
    gate.resolve()
    await Promise.all([refreshing, signingOut])

    // The overtaken refresh and restore revoke only the tokens that they received, and the
    // sign-out alone ends the Tempo ID session.
    expect(restored).toBeInstanceOf(Id.SupersededError)
    expect(logouts).toHaveLength(1)
    expect(await tempoId.session.get()).toBeUndefined()
  })
})

describe('signOut (authorize across the sign-out)', () => {
  test('restores no session from an authorize that starts during a sign-out and completes after it', async () => {
    const app = await seed()
    const read = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<void>()
    const held = { gated: false }
    // While `gated`, the logout waits until the authorize receives its tokens, and the
    // authorize's response waits until the sign-out completes.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (held.gated && url.includes('/v1/auth/logout')) await read.promise
      const response = await app.harness.fetch(input, init)
      if (held.gated && url.endsWith('/v1/authorize')) {
        read.resolve()
        await ended.promise
      }
      return response
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.gated = true
    const signingOut = tempoId.signOut()
    await expect.poll(() => tempoId.session.get()).toBeUndefined()
    const restoring = tempoId.authorize().catch((error: unknown) => error)
    await signingOut
    ended.resolve()
    const restored = await restoring

    expect(restored).toBeInstanceOf(Id.SupersededError)
    expect(await tempoId.session.get()).toBeUndefined()
  })
})

describe('signOut (authorize on another device)', () => {
  test("keeps the app's tokens on the user's other devices when an authorize completes after the sign-out's logout", async () => {
    const app = await seed()
    const email = address()
    const read = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<void>()
    const held = { gated: false }
    // The revocation goes without the page's origin, which Tempo ID refuses from another site, as a
    // same-site page's or a native app's does. While `gated`, the logout waits until the authorize
    // receives its tokens, and the authorize's response waits until the sign-out completes, so the
    // authorize's tokens end in the logout.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/oauth2/revoke')) return harnessFetch(input, init)
      if (held.gated && url.includes('/v1/auth/logout')) await read.promise
      const response = await app.harness.fetch(input, init)
      if (held.gated && url.endsWith('/v1/authorize')) {
        read.resolve()
        await ended.promise
      }
      return response
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    // Another device of the user holds a session of the same app, with cookies of its own.
    const other = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: Client.create(server, {
        clientId: app.clientId,
        origin: new URL(app.redirectUri).origin,
      }).fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    for (const device of [tempoId, other]) {
      await device.email.sendCode({ email })
      await device.email.signIn({
        code: await Harness.code(server, { email }),
        email,
      })
    }

    held.gated = true
    const signingOut = tempoId.signOut()
    await expect.poll(() => tempoId.session.get()).toBeUndefined()
    const restoring = tempoId.authorize().catch((error: unknown) => error)
    await signingOut
    ended.resolve()

    // A revocation of the authorize's tokens, which the logout revoked, counts as a reuse, which
    // revokes the app's tokens on the other device.
    expect(await restoring).toBeInstanceOf(Id.SupersededError)
    expect(await other.session.refresh()).toBeDefined()
  })
})

describe('signOut (behind a failed refresh)', () => {
  test('revokes the refresh token that a refresh sent when Tempo ID refused that refresh during the sign-out', async () => {
    const app = await seed()
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    const held = { gated: false }
    const revoked: string[] = []
    // The first token request waits for `gate`, then fails with a refusal that rotates nothing.
    // Each revocation records its token, as Tempo ID refuses one from the suite's page origin.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/oauth2/revoke'))
        revoked.push(new URLSearchParams(String(init?.body)).get('token')!)
      if (held.gated && url.includes('/oauth2/token')) {
        held.gated = false
        reached.resolve()
        await gate.promise
        return Response.json({ error: 'invalid_request' }, { status: 400 })
      }
      return app.harness.fetch(input, init)
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.gated = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut()
    gate.resolve()
    await Promise.all([refreshing, signingOut])

    expect(revoked).toEqual([session.refreshToken])
  })
})

describe('signOut (behind an unanswered refresh)', () => {
  test('revokes no token that an unanswered refresh may have rotated during the sign-out', async () => {
    const app = await seed()
    const reached = Promise.withResolvers<void>()
    const held = { failing: false }
    const logouts: string[] = []
    const revoked: string[] = []
    // While `failing`, each token request receives a 503, which leaves its rotation unknown. Each
    // revocation records its token, and each logout is recorded.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/v1/auth/logout')) logouts.push(url)
      if (url.includes('/oauth2/revoke'))
        revoked.push(new URLSearchParams(String(init?.body)).get('token')!)
      if (held.failing && url.includes('/oauth2/token')) {
        reached.resolve()
        return new Response(null, { status: 503 })
      }
      return app.harness.fetch(input, init)
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.failing = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut().catch((error: unknown) => error)
    await refreshing

    // Outside a page, the sign-out revokes nothing, so it rejects with the refresh's error after
    // it ends the Tempo ID session.
    const error = await signingOut
    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).status).toMatchInlineSnapshot(`503`)
    expect(revoked).not.toContain(session.refreshToken)
    expect(logouts).toHaveLength(1)
    expect(await tempoId.session.get()).toBeUndefined()
  }, 30_000)

  test('revokes no token when a refresh that Tempo ID refused had an unanswered attempt before', async () => {
    const app = await seed()
    const reached = Promise.withResolvers<void>()
    const held = { attempts: 0, failing: false }
    const revoked: string[] = []
    // While `failing`, the first token request receives a 503, which leaves its rotation unknown,
    // and each later one a refusal that the refresh does not retry.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/oauth2/revoke'))
        revoked.push(new URLSearchParams(String(init?.body)).get('token')!)
      if (held.failing && url.includes('/oauth2/token')) {
        held.attempts++
        if (held.attempts > 1)
          return Response.json(
            { error: 'invalid_request', error_description: 'Refused.' },
            { status: 400 },
          )
        reached.resolve()
        return new Response(null, { status: 503 })
      }
      return app.harness.fetch(input, init)
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.failing = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut().catch((error: unknown) => error)
    await refreshing

    expect(await signingOut).toBeInstanceOf(Id.RequestError)
    expect(held.attempts).toMatchInlineSnapshot(`2`)
    expect(revoked).not.toContain(session.refreshToken)
  })

  test('revokes no token when each retry after an unanswered attempt receives invalid_grant', async () => {
    const app = await seed()
    const reached = Promise.withResolvers<void>()
    const held = { attempts: 0, failing: false }
    const revoked: string[] = []
    // While `failing`, the first token request receives a 503, and each later one `invalid_grant`,
    // as during a rotation that has not returned yet.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/oauth2/revoke'))
        revoked.push(new URLSearchParams(String(init?.body)).get('token')!)
      if (held.failing && url.includes('/oauth2/token')) {
        held.attempts++
        if (held.attempts > 1)
          return Response.json(
            { error: 'invalid_grant', error_description: 'Refused.' },
            { status: 400 },
          )
        reached.resolve()
        return new Response(null, { status: 503 })
      }
      return app.harness.fetch(input, init)
    }
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    const email = address()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.failing = true
    const refreshing = tempoId.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = tempoId.signOut().catch((error: unknown) => error)
    await refreshing

    expect(await signingOut).toBeInstanceOf(Id.RequestError)
    expect(revoked).not.toContain(session.refreshToken)
  }, 30_000)
})

describe('signOut (a sign-in during its read of the store)', () => {
  test('keeps a sign-in of the same user that commits while the sign-out reads the store under its lock, and revokes only the ended session', async () => {
    const app = await seed()
    const email = address()
    const memory = Store.memory()
    // Once armed, the store holds its second read, the one that the sign-out makes under its lock.
    const gate = {
      armed: false,
      opened: Promise.withResolvers<void>(),
      reached: Promise.withResolvers<void>(),
      reads: 0,
    }
    const store = Store.from({
      ...memory,
      async getItem(key) {
        if (gate.armed && ++gate.reads === 2) {
          gate.reached.resolve()
          await gate.opened.promise
        }
        return memory.getItem(key)
      },
    })
    const tempoId = instance(app, { store })
    const signInWithoutKey = async () => {
      await tempoId.email.sendCode({ email })
      return tempoId.email.signIn({
        accessKey: false,
        code: await Harness.code(server, { email }),
        email,
      })
    }
    const first = await signInWithoutKey()
    // The store loads first, so the sign-out's reads are the one before it empties the session and
    // the one under its lock.
    await tempoId.session.get()

    gate.armed = true
    const signingOut = tempoId.signOut()
    await gate.reached.promise
    const second = await signInWithoutKey()
    gate.opened.resolve()
    await signingOut

    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect((await tempoId.session.get())?.refreshToken).toBe(
      second.refreshToken,
    )
    expect(tempoId.session.status.get().status).toBe('signedIn')
    expect(await tempoId.session.refresh()).toMatchObject({
      user: { email },
    })
  })
})

describe('signOut (another tab signs in)', () => {
  test("keeps another instance's later sign-in of the same user, which the store holds when the sign-out takes the lock", async () => {
    const app = await seed()
    const store = Store.memory()
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    const held = { gated: false }
    // The first token request of the instance that signs out waits for `gate`, then fails, so the
    // refresh reads no other session and only holds the lock.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (held.gated && url.includes('/oauth2/token')) {
        held.gated = false
        reached.resolve()
        await gate.promise
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      return app.harness.fetch(input, init)
    }
    const first = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store,
      url: Env.origin,
    })
    const second = instance(app, { store })
    const email = address()
    await first.email.sendCode({ email })
    await first.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    held.gated = true
    const refreshing = first.session.refresh().catch(() => undefined)
    await reached.promise
    const signingOut = first.signOut()
    await expect.poll(() => first.session.get()).toBeUndefined()
    await second.email.sendCode({ email })
    const later = await second.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })
    gate.resolve()
    await Promise.all([refreshing, signingOut])
    const restored = await instance(app, { store }).session.get()

    expect(restored?.refreshToken).toBe(later.refreshToken)
  })
})

describe('session.refresh (during a sign-in)', () => {
  test("keeps a sign-in that commits while the refresh reads the store, and never restores the earlier user's session", async () => {
    const app = await seed()
    const memory = Store.memory()
    const gate = Promise.withResolvers<void>()
    const held = { gated: false }
    // The store returns a read's value only after `gate` resolves, as a slow store does.
    const tempoId = instance(app, {
      store: Store.from({
        ...memory,
        async getItem(key) {
          const value = await memory.getItem(key)
          if (held.gated) await gate.promise
          return value as never
        },
      }),
    })
    const [first, second] = [address(), address()]
    for (const email of [first, second]) await tempoId.email.sendCode({ email })
    await tempoId.email.signIn({
      code: await Harness.code(server, { email: first }),
      email: first,
    })

    await tempoId.session.get()
    held.gated = true
    const refreshing = tempoId.session.refresh()
    await tempoId.email.signIn({
      code: await Harness.code(server, { email: second }),
      email: second,
    })
    const users: (string | undefined)[] = []
    tempoId.session.subscribe((session) => users.push(session?.user.email))
    gate.resolve()
    await refreshing.catch(() => undefined)

    expect((await tempoId.session.get())?.user.email).toBe(second)
    expect(users).not.toContain(first)
  })
})

describe('account.get', () => {
  test("returns the account that Tempo ID selects for the app on the instance's chain, which the session holds", async () => {
    const app = await seed()
    const tempoId = instance(app, { store: Store.memory() })
    const email = address()
    await tempoId.email.sendCode({ email })
    const session = await tempoId.email.signIn({
      code: await Harness.code(server, { email }),
      email,
    })

    const account = await tempoId.account.get()

    expect(Address.isEqual(account!.address, session.account!.address)).toBe(
      true,
    )
  })
})

describe('Plugins.redirect', () => {
  test('signs in through `open`, which receives the sign-in URL and resolves with the callback URL, as on a device', async () => {
    const app = await seed()
    const email = address()
    const cookie = await signedIn({ email })
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: app.harness.fetch,
      accessKey: permissions,
      plugins: [Plugins.redirect({ open: (url) => follow({ cookie, url }) })],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })

    // An access key needs the approval page, which a browser shows. A sign-in without one returns at once.
    const session = await tempoId.redirect.signIn({ accessKey: false })

    expect(session?.user.email).toBe(email)
    expect(session?.key).toBeUndefined()
    expect(await tempoId.session.get()).toEqual(session)
  })

  test('returns undefined, and leaves the session as it was, when `open` resolves with no URL', async () => {
    const app = await seed()
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: app.harness.fetch,
      accessKey: permissions,
      plugins: [Plugins.redirect({ open: () => Promise.resolve(undefined) })],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })

    expect(await tempoId.redirect.signIn()).toBeUndefined()
    expect(await tempoId.session.get()).toBeUndefined()
  })

  test("prefetches nothing outside a browser, and returns the absolute URLs of the sign-in page's assets", async () => {
    const app = await seed()
    const tempoId = Id.create({
      clientId: app.clientId,
      fetch: app.harness.fetch,
      plugins: [Plugins.redirect()],
      redirectUri: app.redirectUri,
      url: Env.origin,
    })

    const urls = await tempoId.redirect.prefetch()

    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((url) => url.startsWith(`${Env.origin}/`))).toBe(true)
  })
})

describe('Plugins.device', () => {
  test('passes the code to onCode, sets the session once the user approves it, saves it to a file that another instance restores, and revokes it at the signOut of a new instance', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'tempo-id-'))
    const file = Path.join(directory, 'session.json')
    const clientId = await deviceApp()
    const cookie = await signedIn({ email: address() })
    const create = () =>
      Id.create({
        chainId: tempoTestnet.id,
        clientId,
        fetch: harnessFetch,
        accessKey: permissions,
        plugins: [
          Plugins.device({
            async onCode(code) {
              const approved = await server.fetch('/v1/device/approve', {
                body: JSON.stringify({ code: code.userCode }),
                headers: {
                  'content-type': 'application/json',
                  cookie,
                  origin: Env.origin,
                },
                method: 'POST',
              })
              await approved.body?.cancel()
            },
          }),
        ],
        store: Store.file(file),
        url: Env.origin,
      })

    try {
      const session = await create().device.signIn()
      const saved = await create().session.get()
      // A new process signs out without reading the session first, as a CLI's `logout` does.
      const restored = create()
      await restored.signOut()
      const refresh = await Actions.refresh(restored.config, {
        refreshToken: session.refreshToken!,
      }).catch((error: Id.RequestError) => [error.status, error.code])

      expect(session.key?.chainId).toBe(tempoTestnet.id)
      expect(saved?.key?.keyAuthorization).toEqual(
        session.key?.keyAuthorization,
      )
      expect(Fs.statSync(file).mode & 0o777).toBe(0o600)
      // The CLI holds no cookie, so the sign-out revokes its refresh token.
      expect(refresh).toMatchInlineSnapshot(`
        [
          400,
          "invalid_grant",
        ]
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('throws KeyRequiredError without an access key, since the device grant always requests a key', async () => {
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: await deviceApp(),
      fetch: harnessFetch,
      plugins: [Plugins.device({ onCode: () => {} })],
      url: Env.origin,
    })

    await expect(tempoId.device.signIn()).rejects.toThrow(Id.KeyRequiredError)
  })
})

describe('Plugins.passkey', () => {
  test("returns the email step for a passkey that no account knows, and leaves the session as it was, then sets it at the account's passkey sign-in, also through a prepared sign-in", async () => {
    const origin = `https://app.${Passkeys.rpId}`
    // The default realm's relying party covers the app's page, so the app reaches no realm of its own.
    const app = await seed({ origin, realm: false })
    const email = address()
    const signedOut = Id.create({
      chainId: tempoTestnet.id,
      clientId: app.clientId,
      fetch: app.harness.fetch,
      accessKey: permissions,
      plugins: [Plugins.email()],
      redirectUri: app.redirectUri,
      store: Store.memory(),
      url: Env.origin,
    })
    await signedOut.email.sendCode({ email })
    await signedOut.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      accessKey: false,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })
    const wallet = Passkeys.wallet()
    await Harness.seedWallet(server, {
      credential: wallet.credential,
      id: wallet.passkey.id,
    })
    const create = (getFn: ReturnType<typeof passkey.getFn>) =>
      Id.create({
        chainId: tempoTestnet.id,
        clientId: app.clientId,
        fetch: app.harness.fetch,
        accessKey: permissions,
        plugins: [Plugins.passkey({ getFn: getFn as never })],
        redirectUri: app.redirectUri,
        store: Store.memory(),
        url: Env.origin,
      })

    const unknown = create(wallet.passkey.getFn({ origin }))
    const step = await unknown.passkey.signIn()
    const known = create(passkey.getFn({ origin }))
    const session = await known.passkey.signIn()
    await known.signOut()
    const prepared = known.passkey.prepare()
    const again = await prepared.signIn()

    expect('step' in step && step.step.type).toMatchInlineSnapshot(`"email"`)
    expect(await unknown.session.get()).toBeUndefined()
    if ('step' in session) throw new Error('Expected a session.')
    expect(
      Address.isEqual(session.key!.account, Passkeys.address(passkey)),
    ).toBe(true)
    if ('step' in again) throw new Error('Expected a session.')
    expect(again.user.id).toBe(session.user.id)
    expect((await known.session.get())?.user.id).toBe(session.user.id)
  })

  test("authorizes with the instance's `getFn` when `authorize` names none", async () => {
    const origin = `https://app.${Passkeys.rpId}`
    const app = await seed({ origin, realm: false })
    const email = address()
    const create = (getFn?: unknown) =>
      Id.create({
        chainId: tempoTestnet.id,
        clientId: app.clientId,
        fetch: app.harness.fetch,
        accessKey: permissions,
        plugins: [Plugins.email(), Plugins.passkey({ getFn: getFn as never })],
        redirectUri: app.redirectUri,
        store: Store.memory(),
        url: Env.origin,
      })
    const signedIn = create()
    await signedIn.email.sendCode({ email })
    await signedIn.email.signIn({
      code: await Harness.code(server, { email }),
      email,
      accessKey: false,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })

    // Node has no `navigator.credentials`, so only the instance's `getFn` runs the ceremony.
    const session = await create(passkey.getFn({ origin })).authorize({
      passkey: true,
    })

    expect(
      Address.isEqual(session!.key!.account, Passkeys.address(passkey)),
    ).toBe(true)
  })

  test("sets the instance's `getFn`, which a restored session's account uses, unless `Id.create` names its own", () => {
    const getFn = () => Promise.resolve(null)
    const own = () => Promise.resolve(null)

    const plugin = Id.create({
      clientId: 'client_test',
      plugins: [Plugins.passkey({ getFn: getFn as never })],
    })
    const option = Id.create({
      clientId: 'client_test',
      getFn: own as never,
      plugins: [Plugins.passkey({ getFn: getFn as never })],
    })

    const both = Id.create({
      clientId: 'client_test',
      plugins: [Plugins.passkey({ getFn: getFn as never }), Plugins.email()],
    })

    expect(plugin.config.getFn).toBe(getFn)
    expect(option.config.getFn).toBe(own)
    // A plugin without a `getFn` of its own keeps another plugin's.
    expect(both.config.getFn).toBe(getFn)
  })
})

/** Returns a new test address. */
function address() {
  return `tempo-id-test+${crypto.randomUUID()}@example.org`
}

/** Seeds an app of the device grant that reaches a new realm, and returns its client ID. */
async function deviceApp() {
  const realmId = await realm()
  const { app } = await Admin.createApp(admin, {
    device: true,
    name: 'Tempo CLI',
  })
  await Admin.setAppRealms(admin, {
    clientId: app.clientId,
    realms: [realmId],
  })
  return app.clientId
}

/**
 * Returns `store`, whose reads after `expire` return the saved session with an access key that
 * expired, as a session saved before its key's expiry does.
 */
function expiring(store: Store.Store) {
  const held = { expired: false }
  return {
    ...Store.from({
      ...store,
      async getItem(key) {
        const value = (await store.getItem(key)) as {
          state?: {
            session?: { key?: { keyAuthorization: { expiry?: string } } }
          }
        } | null
        const keyAuthorization = value?.state?.session?.key?.keyAuthorization
        if (!held.expired || !keyAuthorization) return value
        return {
          ...value,
          state: {
            ...value.state,
            session: {
              ...value.state!.session,
              key: {
                ...value.state!.session!.key,
                keyAuthorization: { ...keyAuthorization, expiry: '0x1' },
              },
            },
          },
        }
      },
    }),
    /** Makes every later read return an expired access key. */
    expire() {
      held.expired = true
    },
  }
}

/** Follows the sign-in URL for `cookie` to the app's callback, and returns the callback URL. */
async function follow(options: { cookie: string; url: string }) {
  let url = new URL(options.url)
  for (let hop = 0; hop < 5; hop++) {
    if (url.origin !== Env.origin) return url.href
    const response = await server.fetch(`${url.pathname}${url.search}`, {
      headers: { cookie: options.cookie },
      redirect: 'manual',
    })
    // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
    const location =
      response.headers.get('location') ??
      ((await response.json()) as { url?: string }).url
    if (!location)
      throw new Error(`The sign-in URL returned ${response.status}.`)
    url = new URL(location, Env.origin)
  }
  throw new Error('The sign-in URL redirected too many times.')
}

/**
 * Calls the harness as a backend or a CLI does, without a page's origin. The harness's fetch returns
 * Miniflare's `Response`, which the global `fetch` type does not name.
 */
const harnessFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input)
  return server.fetch(
    `${url.pathname}${url.search}`,
    init as Parameters<typeof server.fetch>[1],
  )
}) as unknown as typeof globalThis.fetch

/** Returns an instance of `app` with the email plugin, on Tempo testnet. */
function instance(
  app: Awaited<ReturnType<typeof seed>>,
  options: {
    /** The instance's fetch. Defaults to the harness's. */
    fetch?: typeof fetch | undefined
    store?: Store.Store | undefined
  },
) {
  return Id.create({
    chainId: tempoTestnet.id,
    clientId: app.clientId,
    fetch: options.fetch ?? app.harness.fetch,
    accessKey: permissions,
    plugins: [Plugins.email()],
    redirectUri: app.redirectUri,
    // An instance without a store outside a browser holds no session.
    store: 'store' in options ? options.store : Store.memory(),
    url: Env.origin,
  })
}

/** Returns the permissions of an access key: OUSD's transfers, up to $1,000, for 364 days. */
function permissions() {
  return {
    expiry: Expiry.days(364),
    limits: [{ limit: 1_000_000_000n, token: ousdAddress }],
    scopes: [Scopes.tip20(ousdAddress).transfer()],
  }
}

/** Seeds a realm whose secp256k1 owners the harness holds, and returns its ID. */
async function realm() {
  const id = `cash-${crypto.randomUUID().replaceAll('-', '')}`
  await Admin.addRealm(admin, { id, name: 'Tempo Cash' })
  // The Admin API has no route for a realm's secp256k1 owners.
  await Realm.setSecp256k1(database.db, { enabled: true, realmId: id })
  return id
}

/**
 * Seeds a public app that reaches a new realm, unless `realm` is `false`, with its redirect URI on
 * `origin`, and returns its
 * client ID, its redirect URI, and the harness's client of its page.
 */
async function seed(
  options: {
    origin?: string | undefined
    realm?: boolean | undefined
  } = {},
) {
  const { origin = 'https://app.example.com' } = options
  const clientId = crypto.randomUUID()
  const redirectUri = `${origin}/callback`
  await Admin.createApp(admin, {
    clientId,
    name: 'Example',
    redirectUris: [redirectUri],
  })
  if (options.realm !== false)
    await Admin.setAppRealms(admin, { clientId, realms: [await realm()] })
  const harness = Client.create(server, { clientId, origin })
  return { clientId, harness, redirectUri }
}

/** Signs `email` in on Tempo ID's own page, and returns the session cookie. */
async function signedIn(options: { email: string }) {
  const { email } = options
  const code = await Harness.sendCode(server, { email })
  const verify = await server.fetch('/v1/auth/code/verify', {
    body: JSON.stringify({ code, email }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  await verify.body?.cancel()
  const cookie = verify.headers
    .getSetCookie()
    .find((entry) => entry.includes('tempo-id-session'))
    ?.split(';')[0]
  if (!cookie) throw new Error(`The sign-in failed with ${verify.status}.`)
  return cookie
}

/** Signs `email` in at Tempo ID in the harness's browser, without a saved session. */
async function signedInAt(
  app: Awaited<ReturnType<typeof seed>>,
  options: { email: string },
) {
  const { email } = options
  const signedIn = instance(app, { store: Store.memory() })
  await signedIn.email.sendCode({ email })
  await signedIn.email.signIn({
    code: await Harness.code(server, { email }),
    email,
    accessKey: false,
  })
}

/** Returns each status that `tempoId` changes to from now on. */
function statuses(tempoId: { session: Id.Id['session'] }) {
  const seen: string[] = []
  tempoId.session.status.subscribe((status) => seen.push(status.status))
  return seen
}

/** Returns the chain of causes of `error`, from its own cause to the first. */
function causes(error: unknown) {
  const chain: unknown[] = []
  let current = (error as { cause?: unknown } | undefined)?.cause
  while (current !== undefined && chain.length < 10) {
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}
