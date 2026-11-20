/**
 * Runs the key set's machines on their own, with no I/O: the states that their events reach, and the
 * steps that `decide` and `rotate` choose from them. The tests of `create` verify tokens that the
 * test signs from a copy in `Store.memory`, against an issuer address that refuses each connection,
 * so a verification that needs no fetch succeeds only without one, or against a local issuer that
 * answers each fetch when the test releases it.
 * @module
 */
import { once } from 'node:events'
import * as Http from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT } from 'jose'
import { describe, expect, test } from 'vite-plus/test'
import { createActor, fromPromise, waitFor } from 'xstate'
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

    // A state without a set holds no entry, and a state with one holds it. A state after a fetch
    // ended or failed knows when, and only a state of a fetch in progress is `fetching` and knows
    // when it started.
    for (const { state } of paths) {
      const { ended, entry, started } = state.context
      const value = state.value as string
      expect(entry === undefined).toBe(
        ['empty', 'pending', 'unavailable'].includes(value),
      )
      if (['failing', 'unavailable'].includes(value))
        expect(ended).toBeTypeOf('number')
      expect(KeySet.machines.fetching(state)).toBe(
        ['pending', 'refreshing'].includes(value),
      )
      if (KeySet.machines.fetching(state)) expect(started).toBeTypeOf('number')
    }

    expect([...new Set(paths.map((path) => path.state.value))].sort())
      .toMatchInlineSnapshot(`
        [
          "empty",
          "failing",
          "loaded",
          "pending",
          "refreshing",
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

describe('machines.fetch', () => {
  /** The outcomes of the request and the timer, which the runner's actor and `after` send. */
  const outcomes = {
    'xstate.after.timeout.fetch.fetching': {
      type: 'xstate.after.timeout.fetch.fetching',
    },
    'xstate.done.actor.request': {
      output: entry(0),
      type: 'xstate.done.actor.request',
    },
    'xstate.error.actor.request': {
      error: new Error('request'),
      type: 'xstate.error.actor.request',
    },
  } as const

  test('reaches every state along its shortest paths, and ends each fetch in a final state', () => {
    const paths = getShortestPaths(KeySet.machines.fetch, {
      // The traversal runs no request or timer, so it offers their outcomes while the fetch runs.
      events: (state) =>
        state.matches('fetching') ? Object.values(outcomes) : [],
    })

    // Each outcome is handled, and only `fetched` holds a set, and only `failed` an error.
    const fetching = paths.find((path) => path.state.matches('fetching'))!
    expect(
      Object.values(outcomes).every((event) => fetching.state.can(event)),
    ).toBe(true)
    expect(
      paths.map(({ state }) => [
        String(state.value),
        state.status,
        state.context.entry !== undefined,
        state.context.error !== undefined,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "fetching",
          "active",
          false,
          false,
        ],
        [
          "timedOut",
          "done",
          false,
          false,
        ],
        [
          "fetched",
          "done",
          true,
          false,
        ],
        [
          "failed",
          "done",
          false,
          true,
        ],
      ]
    `)
  })

  test('returns the set of the request', async () => {
    const actor = start(() => Promise.resolve(entry(1)))

    const snapshot = await waitFor(actor, (state) => state.status === 'done')

    expect(KeySet.machines.entry(snapshot).fetchedAt).toMatchInlineSnapshot(`1`)
  })

  test('throws the error of a failed request', async () => {
    const actor = start(() => Promise.reject(new Error('request')))

    const snapshot = await waitFor(actor, (state) => state.status === 'done')

    expect(() =>
      KeySet.machines.entry(snapshot),
    ).toThrowErrorMatchingInlineSnapshot(`[Error: request]`)
  })

  test('aborts a request that never settles at `timeout`, and throws a `TimeoutError`', async () => {
    const signals: AbortSignal[] = []
    const actor = start(({ signal }) => {
      signals.push(signal)
      return new Promise<never>(() => {})
    })

    const snapshot = await waitFor(actor, (state) => state.status === 'done')

    expect([snapshot.value, signals.map((signal) => signal.aborted)])
      .toMatchInlineSnapshot(`
      [
        "timedOut",
        [
          true,
        ],
      ]
    `)
    expect(() => KeySet.machines.entry(snapshot)).toThrow(
      expect.objectContaining({ name: 'TimeoutError' }),
    )
  })

  /** Starts a fetch whose request is `request`, with a `timeout` of 10 milliseconds. */
  function start(
    request: (args: { signal: AbortSignal }) => Promise<KeySet.Entry>,
  ) {
    return createActor(
      KeySet.machines.fetch.provide({
        actors: { request: fromPromise(request) },
        delays: { timeout: 10 },
      }),
    ).start()
  }
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

  test('starts at most one fetch each cooldown for tokens of unknown `kid`s', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    actor.send({ entry: entry(0), now: 0, type: 'fetch.end' })
    const start = 2 * KeySet.cooldown
    const first = KeySet.rotate(actor.getSnapshot(), { now: start })
    actor.send({ now: start, type: 'fetch.start' })
    // Later tokens arrive while the fetch runs, and once it ends.
    const running = KeySet.rotate(actor.getSnapshot(), { now: start + 1 })
    actor.send({ entry: entry(start + 2), now: start + 2, type: 'fetch.end' })

    expect([
      first,
      running,
      KeySet.rotate(actor.getSnapshot(), { now: start + 3 }),
    ]).toMatchInlineSnapshot(`
      [
        "fetch",
        "wait",
        "refuse",
      ]
    `)
  })

  test('fetches again a cooldown after a fetch that never ends', () => {
    const actor = createActor(KeySet.machines.keySet).start()
    actor.send({ entry: entry(0), now: 0, type: 'fetch.end' })
    const start = 2 * KeySet.cooldown
    actor.send({ now: start, type: 'fetch.start' })

    expect(
      KeySet.rotate(actor.getSnapshot(), { now: start + KeySet.cooldown }),
    ).toMatchInlineSnapshot(`"fetch"`)
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

  test('starts one background fetch for verifications of a stale set that arrive together', async () => {
    const keys = await setup(Date.now() - KeySet.maxAge / 2)
    const token = await first.sign()

    await Promise.all([
      keys.verify(token),
      keys.verify(token),
      keys.verify(token),
    ])

    expect(keys.deferred.length).toMatchInlineSnapshot(`1`)
  })

  test('fetches in the foreground, without a background fetch, for an unknown `kid` in a stale set', async () => {
    const keys = await setup(Date.now() - KeySet.maxAge / 2)

    // The one fetch fails, since nothing listens at the issuer address.
    await expect(
      keys.verify(await second.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TypeError: fetch failed]`)

    expect(keys.deferred.length).toMatchInlineSnapshot(`0`)
  })

  test('throws the key set as unavailable for an unknown `kid` after a failed refresh', async () => {
    const keys = await setup(Date.now() - KeySet.maxAge / 2)
    await keys.verify(await first.sign())
    // The refresh fails, since nothing listens at the issuer address.
    await Promise.all(keys.deferred)

    await expect(
      keys.verify(await second.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Key set unavailable: the last fetch of the key set failed or did not end in time. Retry later.]`,
    )
  })

  test('verifies a burst of tokens of a new `kid` with the one fetch of a rotation', async () => {
    await using issuer = await serve()
    const keys = await setup(Date.now(), { url: issuer.url })
    await keys.verify(await first.sign())
    const tokens = await Promise.all([1, 2, 3, 4].map(() => second.sign()))

    // The first token fetches, and the others arrive while its fetch runs.
    const verified = Promise.all(tokens.map((token) => keys.verify(token)))
    await issuer.received()
    issuer.respond(200, { keys: [first.jwk, second.jwk] })

    expect([
      (await verified).map(({ protectedHeader }) => protectedHeader.kid),
      issuer.requests.length,
    ]).toMatchInlineSnapshot(`
      [
        [
          "second",
          "second",
          "second",
          "second",
        ],
        1,
      ]
    `)
  })

  test('throws the key set as unavailable for tokens of a new `kid` that wait for a fetch that never settles, at `timeout`', async () => {
    await using issuer = await serve()
    const keys = await setup(Date.now(), { timeout: 100, url: issuer.url })
    await keys.verify(await first.sign())
    const tokens = await Promise.all([1, 2, 3].map(() => second.sign()))

    // The issuer never answers, so the fetch ends at `timeout`, which aborts its request.
    const results = await Promise.allSettled(
      tokens.map((token) => keys.verify(token)),
    )
    await issuer.aborted()

    expect([
      results.map((result) =>
        result.status === 'rejected' ? String(result.reason) : result.status,
      ),
      issuer.requests.length,
    ]).toMatchInlineSnapshot(`
      [
        [
          "TimeoutError: Key set unavailable: the fetch of the key set did not end within \`timeout\`. Retry later.",
          "Error: Key set unavailable: the last fetch of the key set failed or did not end in time. Retry later.",
          "Error: Key set unavailable: the last fetch of the key set failed or did not end in time. Retry later.",
        ],
        1,
      ]
    `)
  })

  test('throws the key set as unavailable for tokens of a new `kid` that wait for a fetch that fails', async () => {
    await using issuer = await serve()
    const keys = await setup(Date.now(), { url: issuer.url })
    await keys.verify(await first.sign())
    const tokens = await Promise.all([1, 2, 3].map(() => second.sign()))

    const results = Promise.allSettled(
      tokens.map((token) => keys.verify(token)),
    )
    await issuer.received()
    issuer.respond(503, {})

    expect([
      (await results).map((result) =>
        result.status === 'rejected' ? String(result.reason) : result.status,
      ),
      issuer.requests.length,
    ]).toMatchInlineSnapshot(`
      [
        [
          "Error: Key set unavailable: the issuer answered with status 503. Retry later.",
          "Error: Key set unavailable: the last fetch of the key set failed or did not end in time. Retry later.",
          "Error: Key set unavailable: the last fetch of the key set failed or did not end in time. Retry later.",
        ],
        1,
      ]
    `)
  })

  test('fetches once for verifications without a set that arrive together', async () => {
    await using issuer = await serve()
    const keys = KeySet.create({ url: issuer.url })
    const tokens = await Promise.all([1, 2, 3].map(() => first.sign()))

    const verified = Promise.all(tokens.map((token) => jwtVerify(token, keys)))
    // Each verification reaches the key function in the tick that starts it, before the first request.
    await issuer.received()
    issuer.respond(200, { keys: [first.jwk] })

    expect([
      (await verified).map(({ protectedHeader }) => protectedHeader.kid),
      issuer.requests.length,
    ]).toMatchInlineSnapshot(`
      [
        [
          "first",
          "first",
          "first",
        ],
        1,
      ]
    `)
  })

  test('ignores a malformed copy of the cache', async () => {
    const cache = Store.memory()
    await cache.setItem(`${url}/oauth2/jwks`, {
      fetchedAt: Date.now(),
      jwks: { keys: [null] },
    })
    const keys = KeySet.create({ keySet: { cache }, url })

    // The copy is ignored, so the verification fetches, which fails at the issuer address.
    await expect(
      jwtVerify(await first.sign(), keys),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TypeError: fetch failed]`)
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
 * `fetchedAt`, and the background work that it defers. The issuer is at `url`, which defaults to an
 * address that refuses each connection.
 */
async function setup(
  fetchedAt: number,
  options: { timeout?: number; url?: string } = {},
) {
  const { timeout, url: issuer = url } = options
  const cache = Store.memory()
  await cache.setItem(`${issuer}/oauth2/jwks`, entry(fetchedAt))
  const deferred: Promise<unknown>[] = []
  const keys = KeySet.create(
    {
      keySet: { cache, defer: (promise) => void deferred.push(promise) },
      url: issuer,
    },
    { timeout },
  )
  return {
    deferred,
    /** Verifies `token` with the key function. */
    verify: (token: string) => jwtVerify(token, keys),
  }
}

/**
 * Starts a local issuer that holds each request until `respond`, and returns its URL, its requests,
 * and waits for a request to arrive or to be aborted. Disposing it closes the server.
 */
async function serve() {
  const requests: Http.IncomingMessage[] = []
  const held: Http.ServerResponse[] = []
  const server = Http.createServer((request, response) => {
    requests.push(request)
    held.push(response)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    /** Waits for the client to abort the first held request. */
    aborted: async () => {
      const [response] = held
      if (response && !response.destroyed) await once(response, 'close')
    },
    /** Waits for the first request to arrive. */
    received: async () => {
      if (requests.length === 0) await once(server, 'request')
    },
    requests,
    /** Answers each held request with `status` and the JSON of `body`. */
    respond: (status: number, body: unknown) => {
      for (const response of held.splice(0))
        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify(body))
    },
    url: `http://127.0.0.1:${port}`,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}
