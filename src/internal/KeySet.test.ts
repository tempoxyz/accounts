/**
 * Tests the key function of `KeySet.create` with tokens that the test signs, an injected `fetch`
 * that serves their key set, an injected clock, and a `defer` that holds the background work.
 * @module
 */
import { exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT } from 'jose'
import { describe, expect, test } from 'vite-plus/test'
import * as Store from '../Store.js'
import * as KeySet from './KeySet.js'

/** The origin of the issuer, which no test reaches. */
const url = 'https://id.test'

/** How the next fetch answers: `hang` until its signal aborts, or `never`, as a cancelled request. */
type Answer = 'hang' | 'never'

/** The key pair of a `kid`: its public JWK, and a signer of tokens that name it. */
type Key = {
  /** The public key, as the key set serves it. */
  jwk: JWK
  /** Signs a token that names the `kid`. */
  sign: () => Promise<string>
}

const first = await key('first')
const second = await key('second')

describe('create', () => {
  test('fetches the set once, and then verifies from memory', async () => {
    const keys = setup()

    await keys.verify(await first.sign())
    await keys.verify(await first.sign())

    expect(keys.state.fetches).toMatchInlineSnapshot(`1`)
  })

  test('verifies a stale set at once, while a background fetch replaces it', async () => {
    const keys = setup()
    await keys.verify(await first.sign())
    keys.advance(KeySet.maxAge / 2)
    keys.state.jwks = [first.jwk, second.jwk]
    const gate = Promise.withResolvers<void>()
    keys.state.gate = gate.promise

    // The verification ends while the background fetch that it started waits for the issuer.
    await keys.verify(await first.sign())
    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)

    gate.resolve()
    await keys.flush()
    await keys.verify(await second.sign())

    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)
  })

  test('waits for a new set from `maxAge`, so a removed signing key stops verifying', async () => {
    const keys = setup()
    await keys.verify(await first.sign())
    keys.state.jwks = [second.jwk]
    keys.advance(KeySet.maxAge)

    await expect(
      keys.verify(await first.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[JWKSNoMatchingKey: no applicable key found in the JSON Web Key Set]`,
    )
    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)
  })

  test('starts from the copy of `cache` without a fetch, as a new instance', async () => {
    const cache = Store.memory()
    const one = setup({ cache })
    await one.verify(await first.sign())
    await one.flush()
    const two = setup({ cache })

    await two.verify(await first.sign())

    expect(two.state.fetches).toMatchInlineSnapshot(`0`)
  })

  test('fetches without the copy of `cache` from `maxAge`', async () => {
    const cache = Store.memory()
    const one = setup({ cache })
    await one.verify(await first.sign())
    await one.flush()
    const two = setup({ cache })
    two.advance(KeySet.maxAge)

    await two.verify(await first.sign())

    expect(two.state.fetches).toMatchInlineSnapshot(`1`)
  })

  test('fetches for an unknown `kid` at most once each cooldown after the last fetch ended', async () => {
    const keys = setup()
    await keys.verify(await first.sign())
    keys.advance(KeySet.cooldown)
    keys.state.jwks = [first.jwk, second.jwk]

    await keys.verify(await second.sign())
    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)

    const unknown = await key('unknown')
    await expect(
      keys.verify(await unknown.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[JWKSNoMatchingKey: no applicable key found in the JSON Web Key Set]`,
    )
    await expect(
      keys.verify(await unknown.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[JWKSNoMatchingKey: no applicable key found in the JSON Web Key Set]`,
    )

    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)
  })

  test('measures the cooldown from the end of a slow fetch, not its start', async () => {
    const keys = setup()
    keys.state.delay = KeySet.cooldown
    await keys.verify(await first.sign())
    keys.state.delay = 0
    keys.advance(KeySet.cooldown - 1)
    const unknown = await key('unknown')

    await expect(
      keys.verify(await unknown.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[JWKSNoMatchingKey: no applicable key found in the JSON Web Key Set]`,
    )

    expect(keys.state.fetches).toMatchInlineSnapshot(`1`)
  })

  test('throws for an issuer that stops answering within `timeout`, and fetches again next time', async () => {
    const keys = setup({ timeout: 20 })
    keys.state.next = ['hang']

    await expect(
      keys.verify(await first.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TimeoutError: The operation was aborted due to timeout]`,
    )
    await keys.verify(await first.sign())

    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)
  })

  test('throws for a status other than 2xx, and for a body without `keys`', async () => {
    const keys = setup()
    keys.state.status = 503

    await expect(
      keys.verify(await first.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Key set unavailable: the issuer answered with status 503. Retry later.]`,
    )

    keys.state.status = 200
    keys.state.jwks = undefined
    await expect(
      keys.verify(await first.sign()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid key set: the issuer returned no \`keys\` array. Retry later.]`,
    )
  })

  test('holds no other verification on a fetch that never settles, and no later background fetch', async () => {
    const keys = setup()
    const token = await first.sign()
    // The fetch of the first verification never settles, as when a Worker cancels its request.
    keys.state.next = ['never']
    void keys.verify(token)

    await keys.verify(token)
    expect(keys.state.fetches).toMatchInlineSnapshot(`2`)

    keys.advance(KeySet.maxAge / 2)
    keys.state.next = ['never']
    await keys.verify(token)
    keys.drop()
    keys.advance(KeySet.cooldown)
    keys.state.jwks = [first.jwk, second.jwk]
    await keys.verify(token)
    await keys.flush()
    expect(keys.state.fetches).toMatchInlineSnapshot(`4`)

    // The second signing key verifies from the set of the later background fetch.
    keys.state.jwks = []
    await keys.verify(await second.sign())
  })

  test('verifies a rotated signing key while a background fetch runs', async () => {
    const keys = setup()
    await keys.verify(await first.sign())
    keys.advance(KeySet.maxAge / 2)
    keys.state.jwks = [first.jwk, second.jwk]
    const gate = Promise.withResolvers<void>()
    keys.state.gate = gate.promise
    const token = await second.sign()

    // The first verification starts the background fetch, and then fetches for the unknown `kid`.
    // The second arrives while both fetches wait for the issuer, and starts its own.
    const verified = Promise.all([keys.verify(token), keys.verify(token)])
    await expect.poll(() => keys.state.fetches).toBe(4)
    gate.resolve()

    await expect(verified).resolves.toHaveLength(2)
    await keys.flush()
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

/** Returns the key pair of `kid`. */
async function key(kid: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid }
  return {
    jwk,
    sign: () =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(url)
        .sign(privateKey),
  }
}

/** Returns a key function whose clock, fetches, cache, and background work the test controls. */
function setup(options: setup.Options = {}) {
  const deferred: Promise<unknown>[] = []
  let time = 1_000_000
  const state = {
    /** How long each fetch advances the clock, in milliseconds. */
    delay: 0,
    /** The number of fetches. */
    fetches: 0,
    /** While set, each fetch waits for it. */
    gate: undefined as Promise<void> | undefined,
    /** The keys that the set serves. Absent, the body holds no `keys`. */
    jwks: [first.jwk] as JWK[] | undefined,
    /** How the next fetches answer, in order. */
    next: [] as Answer[],
    /** The status of each answer. */
    status: 200,
  }
  const keys = KeySet.create(
    {
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        state.fetches++
        const answer = state.next.shift()
        if (answer === 'never') return new Promise<never>(() => {})
        if (answer === 'hang')
          return new Promise<never>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            ),
          )
        await state.gate
        time += state.delay
        return Response.json(state.jwks ? { keys: state.jwks } : {}, {
          status: state.status,
        })
      }) as typeof globalThis.fetch,
      keySet: {
        cache: options.cache,
        defer: (promise) => void deferred.push(promise),
      },
      url,
    },
    { now: () => time, timeout: options.timeout },
  )

  return {
    /** Advances the clock by `ms`. */
    advance: (ms: number) => void (time += ms),
    /** Forgets the background work that never settles. */
    drop: () => void deferred.splice(0),
    /** Waits for the background work. */
    flush: () => Promise.all(deferred.splice(0)),
    state,
    /** Verifies `token` with the key function. */
    verify: (token: string) => jwtVerify(token, keys, { issuer: url }),
  }
}

declare namespace setup {
  type Options = {
    /** The cache of the key set. */
    cache?: KeySet.Cache | undefined
    /** How long a fetch may take, in milliseconds. */
    timeout?: number | undefined
  }
}
