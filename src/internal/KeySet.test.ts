/**
 * Runs the key set's machine on its own, with no I/O: the states that its events reach, and the
 * steps that `decide` and `rotate` choose from them. The tests of `create` verify tokens that the
 * test signs from a copy in `Store.memory`, against an issuer address that refuses each connection,
 * so a verification that needs no fetch succeeds only without one.
 * @module
 */
import { exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT } from 'jose'
import { describe, expect, test } from 'vite-plus/test'
import { createActor } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Store from '../Store.js'
import * as KeySet from './KeySet.js'

/** An issuer address where nothing listens, so each fetch of its key set fails. */
const url = 'http://127.0.0.1:1'

const first = await key('first')
const second = await key('second')

/** Returns a key set entry of `keys` that a fetch returned at `fetchedAt`. */
const entry = (fetchedAt: number, keys: JWK[] = [first.jwk]) => ({
  fetchedAt,
  jwks: { keys },
})

describe('machines.keySet', () => {
  test('reaches every state along its shortest paths', () => {
    const paths = getShortestPaths(KeySet.machines.keySet, {
      events: [
        { entry: entry(0), type: 'cache.read' },
        { now: 0, type: 'fetch.start' },
        { entry: entry(0), now: 0, type: 'fetch.end' },
        { now: 0, type: 'fetch.fail' },
      ],
    })

    expect([...new Set(paths.map((path) => path.state.value))].sort())
      .toMatchInlineSnapshot(`
        [
          "empty",
          "failing",
          "loaded",
          "unavailable",
        ]
      `)
  })

  test('keeps the newer set when an older copy of the cache arrives', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    actor.send({ entry: entry(2), now: 2, type: 'fetch.end' })

    actor.send({ entry: entry(1), type: 'cache.read' })

    expect(actor.getSnapshot().context.entry?.fetchedAt).toMatchInlineSnapshot(
      `2`,
    )
  })

  test('leaves `failing` for `loaded` when a fetch returns a set', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    actor.send({ entry: entry(0), now: 0, type: 'fetch.end' })
    actor.send({ now: 1, type: 'fetch.fail' })
    const failing = actor.getSnapshot().value

    actor.send({ entry: entry(2), now: 2, type: 'fetch.end' })

    expect([failing, actor.getSnapshot().value]).toMatchInlineSnapshot(`
      [
        "failing",
        "loaded",
      ]
    `)
  })
})

describe('decide', () => {
  const maxAge = KeySet.maxAge

  test('uses a fresh set, refreshes a stale one, and fetches an expired one or none', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    const none = KeySet.decide(actor.getSnapshot(), { maxAge, now: 0 })
    actor.send({ now: 0, type: 'fetch.start' })
    actor.send({ entry: entry(0), now: 0, type: 'fetch.end' })

    expect([
      none,
      KeySet.decide(actor.getSnapshot(), { maxAge, now: maxAge / 2 - 1 }),
      KeySet.decide(actor.getSnapshot(), { maxAge, now: maxAge / 2 }),
      KeySet.decide(actor.getSnapshot(), { maxAge, now: maxAge }),
    ]).toMatchInlineSnapshot(`
      [
        "fetch",
        "use",
        "refresh",
        "fetch",
      ]
    `)
  })

  test('refreshes a stale set at most once each cooldown after the last fetch started', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    actor.send({ entry: entry(0), now: 0, type: 'fetch.end' })
    const stale = maxAge / 2
    actor.send({ now: stale, type: 'fetch.start' })

    expect([
      KeySet.decide(actor.getSnapshot(), {
        maxAge,
        now: stale + KeySet.cooldown - 1,
      }),
      KeySet.decide(actor.getSnapshot(), {
        maxAge,
        now: stale + KeySet.cooldown,
      }),
    ]).toMatchInlineSnapshot(`
      [
        "use",
        "refresh",
      ]
    `)
  })

  test('holds no verification on a fetch that never ends', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    // The fetch of an earlier verification never ends, as when a Worker cancels its request.
    actor.send({ now: 0, type: 'fetch.start' })

    expect(
      KeySet.decide(actor.getSnapshot(), { maxAge, now: 1 }),
    ).toMatchInlineSnapshot(`"fetch"`)
  })

  test('refreshes a stale copy of the cache', () => {
    const actor = createActor(KeySet.machines.keySet).start()

    actor.send({ entry: entry(0), type: 'cache.read' })

    expect(
      KeySet.decide(actor.getSnapshot(), { maxAge, now: maxAge / 2 }),
    ).toMatchInlineSnapshot(`"refresh"`)
  })
})

describe('rotate', () => {
  test('fetches for an unknown `kid` at most once each cooldown after the last fetch ended', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    const none = KeySet.rotate(actor.getSnapshot(), { now: 0 })
    // A slow fetch starts at 0 and ends a cooldown later.
    actor.send({ now: 0, type: 'fetch.start' })
    actor.send({
      entry: entry(KeySet.cooldown),
      now: KeySet.cooldown,
      type: 'fetch.end',
    })

    expect([
      none,
      KeySet.rotate(actor.getSnapshot(), { now: 2 * KeySet.cooldown - 1 }),
      KeySet.rotate(actor.getSnapshot(), { now: 2 * KeySet.cooldown }),
    ]).toMatchInlineSnapshot(`
      [
        "fetch",
        "refuse",
        "fetch",
      ]
    `)
  })

  test('throws the key set as unavailable within the cooldown of a failed fetch', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    actor.send({ entry: entry(0), now: 0, type: 'fetch.end' })
    actor.send({ now: 1, type: 'fetch.start' })
    actor.send({ now: 2, type: 'fetch.fail' })

    expect([
      KeySet.rotate(actor.getSnapshot(), { now: 3 }),
      KeySet.rotate(actor.getSnapshot(), { now: 2 + KeySet.cooldown }),
    ]).toMatchInlineSnapshot(`
      [
        "unavailable",
        "fetch",
      ]
    `)
  })
})

describe('create', () => {
  test('verifies with a fresh copy of the cache, without a fetch', async () => {
    const keys = await setup(Date.now())

    await keys.verify(await first.sign())

    expect(keys.deferred.length).toMatchInlineSnapshot(`0`)
  })

  test('verifies with a stale copy of the cache, and refreshes it in `defer`', async () => {
    const keys = await setup(Date.now() - KeySet.maxAge / 2)

    await keys.verify(await first.sign())

    expect(keys.deferred.length).toMatchInlineSnapshot(`1`)
  })

  test('throws the key set as unavailable for an unknown `kid` after a failed refresh', async () => {
    const keys = await setup(Date.now() - KeySet.maxAge / 2)
    await keys.verify(await first.sign())
    // The refresh fails, since nothing listens at the issuer address.
    await Promise.all(keys.deferred)

    await expect(
      keys.verify(await second.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Key set unavailable: the last fetch of the key set failed. Retry later.]`,
    )
  })

  test('throws for a set that the issuer does not return', async () => {
    const keys = KeySet.create({ url })

    await expect(
      jwtVerify(await first.sign(), keys),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TypeError: fetch failed]`)
  })
})

describe('status', () => {
  test('returns `fresh`, `stale`, and `expired` by the age of the set', () => {
    const maxAge = 600_000

    expect([
      KeySet.status({ fetchedAt: undefined, maxAge, now: 0 }),
      KeySet.status({ fetchedAt: 0, maxAge, now: 299_999 }),
      KeySet.status({ fetchedAt: 0, maxAge, now: 300_000 }),
      KeySet.status({ fetchedAt: 0, maxAge, now: 600_000 }),
    ]).toMatchInlineSnapshot(`
      [
        "expired",
        "fresh",
        "stale",
        "expired",
      ]
    `)
  })
})

/** Returns the key pair of `kid`: its public JWK, and a signer of tokens that name it. */
async function key(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk: JWK = { ...(await exportJWK(publicKey)), alg: 'RS256', kid }
  return {
    jwk,
    sign: () =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid })
        .sign(privateKey),
  }
}

/**
 * Returns a key function whose cache holds the first key in a set that a fetch returned at
 * `fetchedAt`, and the background work that it defers.
 */
async function setup(fetchedAt: number) {
  const cache = Store.memory()
  await cache.setItem(`${url}/oauth2/jwks`, entry(fetchedAt))
  const deferred: Promise<unknown>[] = []
  const keys = KeySet.create({
    keySet: { cache, defer: (promise) => void deferred.push(promise) },
    url,
  })
  return {
    deferred,
    /** Verifies `token` with the key function. */
    verify: (token: string) => jwtVerify(token, keys),
  }
}
