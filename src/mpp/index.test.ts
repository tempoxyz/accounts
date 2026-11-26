/**
 * Runs the `mpp` plugin without a server: payments of a session whose access key expired, and of a
 * named account outside a page, which the payer refuses before any request.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import { Challenge } from 'mppx'
import { Mppx, Store as MppxStore, tempo } from 'mppx/server'
import { Methods } from 'mppx/tempo'
import * as Fs from 'node:fs/promises'
import * as Http from 'node:http'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Address, type Hex, Secp256k1 } from 'ox'
import { KeyAuthorization, TempoAddress } from 'ox/tempo'
import { createClient, http, type Transport } from 'viem'
import { describe, expect, onTestFinished, test, vi } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as AccessKey from '../internal/AccessKey.js'
import * as Dpop from '../internal/Dpop.js'
import * as Plugin from '../Plugin.js'
import { backend } from '../plugins/backend.js'
import { viem } from '../plugins/viem.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { ChainError, mpp } from './index.js'

describe('mpp', () => {
  test.each([
    { allowedChainIds: undefined },
    { allowedChainIds: [42431, 4217] },
  ])(
    'refuses a session challenge on another chain with allowedChainIds %s',
    async (options) => {
      const challenge = Challenge.fromMethod(Methods.session, {
        id: 'wrong-chain',
        realm: 'mpp.test',
        request: {
          amount: '0.01',
          chainId: 4217,
          currency: '0x20c0000000000000000000000000000000000000',
          decimals: 6,
          recipient: '0x00000000000000000000000000000000000000aa',
          sessionProtocol: 'v2',
          suggestedDeposit: '5',
          unitType: 'request',
        },
      })
      const credentials: boolean[] = []
      const accounts = instance({
        fetch: ((input, init) => {
          credentials.push(
            new Headers(
              init?.headers ??
                (input instanceof Request ? input.headers : undefined),
            ).has('Authorization'),
          )
          return Promise.resolve(
            new Response(null, {
              headers: { 'WWW-Authenticate': Challenge.serialize(challenge) },
              status: 402,
            }),
          )
        }) as typeof globalThis.fetch,
      })
      await expect(
        (async () => {
          const manager = accounts
            .mpp({ session: session({ expiry: 3600 }) })
            .session(options)
          return manager.fetch('https://mpp.test/paid')
        })(),
      ).rejects.toThrow(ChainError)
      expect(credentials).toEqual([false])
    },
  )

  test.each([{ allowedChainIds: [] }, { allowedChainIds: [4217] }])(
    'refuses an allowlist excluding the payer before requests: %j',
    ({ allowedChainIds }) => {
      const fetch = vi.fn()
      const accounts = instance({ fetch })
      expect(() =>
        accounts
          .mpp({ session: session({ expiry: 3600 }) })
          .session({ allowedChainIds }),
      ).toThrow('Include chain 42431 in allowedChainIds')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  test.each([
    { chainless: false, skip: false },
    { chainless: true, skip: false },
    { chainless: false, skip: true },
  ])(
    'selects a payable session offer before signing: %j',
    async ({ chainless, skip }) => {
      const stopped = new Error('account resolution reached')
      const resolveAccount = vi.fn((_parameters: { chainId: number }) =>
        Promise.reject(stopped),
      )
      const offers = [4217, chainless ? undefined : 42431].map((chainId) =>
        Challenge.fromMethod(Methods.session, {
          id: String(chainId),
          realm: 'mpp.test',
          request: {
            amount: '0.01',
            ...(chainId === undefined ? {} : { chainId }),
            currency: '0x20c0000000000000000000000000000000000000',
            decimals: 6,
            recipient: '0x00000000000000000000000000000000000000aa',
            sessionProtocol: 'v2',
            suggestedDeposit: '5',
            unitType: 'request',
          },
        }),
      )
      const credentials: boolean[] = []
      const accounts = instance({
        chain: 4217,
        fetch: ((input, init) => {
          credentials.push(
            new Headers(
              init?.headers ??
                (input instanceof Request ? input.headers : undefined),
            ).has('Authorization'),
          )
          return Promise.resolve(
            new Response(null, {
              status: 402,
              headers: {
                'WWW-Authenticate': offers.map(Challenge.serialize).join(', '),
              },
            }),
          )
        }) as typeof globalThis.fetch,
      })
      const manager = accounts
        .mpp({ session: session({ expiry: 3600 }) })
        .session({
          allowedChainIds: [42431, 42431, 4217],
          resolveAccount,
        })
      if (skip) {
        const orderChallenges = vi.fn(() => [])
        const init = { orderChallenges, signal: new AbortController().signal }
        await expect(
          manager.fetch('https://mpp.test/paid', init),
        ).rejects.toThrow('No method found for challenges')
        expect(orderChallenges).toHaveBeenCalledOnce()
        expect(resolveAccount).not.toHaveBeenCalled()
      } else {
        await expect(manager.fetch('https://mpp.test/paid')).rejects.toBe(
          stopped,
        )
        expect(resolveAccount).toHaveBeenCalledOnce()
        expect(resolveAccount.mock.calls[0]?.[0]).toMatchObject({
          chainId: 42431,
        })
      }
      expect(credentials).toEqual([false])
    },
  )

  test('preserves inherited payment opt-outs before creating a credential', async () => {
    const resolveAccount = vi.fn()
    const offer = Challenge.fromMethod(Methods.session, {
      id: 'payer-chain',
      realm: 'mpp.test',
      request: {
        amount: '0.01',
        chainId: 42431,
        currency: '0x20c0000000000000000000000000000000000000',
        decimals: 6,
        recipient: '0x00000000000000000000000000000000000000aa',
        sessionProtocol: 'v2',
        suggestedDeposit: '5',
        unitType: 'request',
      },
    })
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 402,
          headers: { 'WWW-Authenticate': Challenge.serialize(offer) },
        }),
      ),
    )
    const manager = instance({ fetch })
      .mpp({ session: session({ expiry: 3600 }) })
      .session({ resolveAccount })
    const init = Object.create({
      headers: { 'Accept-Payment': 'tempo/session;q=0' },
    })
    await expect(manager.fetch('https://mpp.test/paid', init)).rejects.toThrow(
      'No method found for challenges',
    )
    expect(resolveAccount).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('preserves the receiver of inherited SSE signal getters', async () => {
    class Options {
      #controller = new AbortController()
      get signal() {
        return this.#controller.signal
      }
    }
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response('data: hello\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const manager = instance({ fetch })
      .mpp({ session: session({ expiry: 3600 }) })
      .session()
    const stream = await manager.sse('https://mpp.test/stream', new Options())
    const chunks: string[] = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks).toEqual(['hello'])
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('refuses malformed wire chain IDs without coercing attacker objects', async () => {
    const challenge = Challenge.from({
      id: 'malformed-chain',
      intent: 'session',
      method: 'tempo',
      realm: 'mpp.test',
      request: {
        amount: '10000',
        currency: '0x20c0000000000000000000000000000000000000',
        recipient: '0x00000000000000000000000000000000000000aa',
        unitType: 'request',
        suggestedDeposit: '5000000',
        methodDetails: {
          sessionProtocol: 'v2',
          chainId: { toString: null, valueOf: null },
        },
      },
    })
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 402,
          headers: { 'WWW-Authenticate': Challenge.serialize(challenge) },
        }),
      ),
    )
    const manager = instance({ fetch })
      .mpp({ session: session({ expiry: 3600 }) })
      .session()
    await expect(manager.fetch('https://mpp.test/paid')).rejects.toThrow(
      'Invalid session chain ID',
    )
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('translates chain refusals raised during SSE iteration', async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(new Error('Chain ID not allowed: 4217.'))
        },
      },
      { highWaterMark: 0 },
    )
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const manager = instance({ fetch })
      .mpp({ session: session({ expiry: 3600 }) })
      .session()
    const stream = await manager.sse('https://mpp.test/paid')
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      ChainError,
    )
  })

  test("reads the registration mark of a fixed session's access key from the store of `backend({ store })` without the `viem` plugin", async () => {
    const memory = Store.memory()
    const reads: string[] = []
    const store = Store.from({
      ...memory,
      getItem: (key) => {
        reads.push(key)
        return memory.getItem(key)
      },
    })
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      plugins: [backend({ store }), mpp()],
      url: 'http://127.0.0.1:9',
    })

    // Nothing listens at the URL, so a request that the payer sends rejects with a network error.
    await accounts
      .mpp({ session: session({ expiry: 3600 }) })
      .fetch('http://127.0.0.1:9/fortune')
      .catch(() => undefined)

    expect(reads.map((key) => key.split(':').slice(0, 2).join(':')))
      .toMatchInlineSnapshot(`
      [
        "tempo-id:registered",
      ]
    `)
  })

  test('rejects a payment of a fixed session whose access key expired with Accounts.SignedOutError, before any request', async () => {
    const accounts = instance()

    // Nothing listens at the URL, so a request that the payer sends rejects with a network error.
    const error = await accounts
      .mpp({ session: session({ expiry: -60 }) })
      .fetch('http://127.0.0.1:9/fortune')
      .catch((error: unknown) => error)

    expect({
      message: (error as Error).message,
      name: (error as Error).name,
    }).toMatchInlineSnapshot(`
      {
        "message": "The client's account is signed out. Sign in before sending.",
        "name": "Accounts.SignedOutError",
      }
    `)
  })

  test('pays with the stored session in a session manager of a new instance, without a read of the session first', async () => {
    const store = Store.memory()
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    const accounts = instance({ store })

    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await (async () =>
      accounts.mpp.session().fetch('http://127.0.0.1:9/content'))().catch(
      (error: unknown) => error,
    )

    expect(error).toMatchInlineSnapshot(`[TypeError: fetch failed]`)
  })

  test('reads the stored session once before the first request of a session manager of a new instance', async () => {
    const memory = Store.memory()
    const reads: string[] = []
    const store = Store.from({
      ...memory,
      getItem: (key) => {
        if (key === name) reads.push(key)
        return memory.getItem(key)
      },
    })
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    const accounts = instance({ store })

    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    await accounts.mpp
      .session()
      .fetch('http://127.0.0.1:9/content')
      .catch(() => undefined)

    expect(reads.length).toMatchInlineSnapshot(`1`)
  })

  test('refuses the first request of a session manager created before the restore with Accounts.SignedOutError once another instance on the store signs out', async () => {
    const store = Store.memory()
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    const first = instance({ store })
    const second = instance({ store })
    const manager = first.mpp.session()
    await Promise.all([first.session.get(), second.session.get()])

    // Nothing listens at Tempo ID's URL, so the revocation fails, but the sign-out empties the store.
    await second.signOut().catch(() => undefined)
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('refuses each request of a session manager of an instance without a stored session with Accounts.SignedOutError, before any request', async () => {
    const accounts = instance({ store: Store.memory() })

    const error = await (async () =>
      accounts.mpp.session().fetch('http://127.0.0.1:9/content'))().catch(
      (error: unknown) => error,
    )

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('refuses a session manager of a fixed session whose access key expired with Accounts.SignedOutError', () => {
    const accounts = instance()

    const error = (() => {
      try {
        accounts.mpp({ session: session({ expiry: -60 }) }).session()
        return undefined
      } catch (error) {
        return error
      }
    })()

    expect((error as Error | undefined)?.name).toMatchInlineSnapshot(
      `"Accounts.SignedOutError"`,
    )
  })

  test('refuses each request of a session manager of a fixed session with Accounts.SignedOutError, before any request, once its access key expires', async () => {
    const accounts = instance()
    const manager = accounts.mpp({ session: session({ expiry: 2 }) }).session()

    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    await expect
      .poll(
        async () =>
          (
            (await manager
              .fetch('http://127.0.0.1:9/content')
              .catch((error: unknown) => error)) as Error
          ).name,
        { timeout: 4_000 },
      )
      .toBe('Accounts.SignedOutError')
  })

  test('refuses each request of a session manager with Accounts.SignedOutError, before any request, once the sign-out ends its access key', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    await accounts.signOut()
    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const signedOut = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(signedOut).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('keeps a session manager paying with its access key once the same user signs in with another access key', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(name, {
      state: { session: session({ expiry: 3600, owner }) },
      version: 0,
    })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    // A limit's renewal commits a new access key of the same user and Tempo Account.
    await accounts.renew.commit(session({ expiry: 3600, owner }))
    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(`[TypeError: fetch failed]`)
  })

  test('keeps a session manager paying with its access key once a chain switch moves the access key to `accessKeys`', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const held = session({ expiry: 3600 })
    await store.setItem(name, { state: { session: held }, version: 0 })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    // A switch to a chain without an access key commits the session with its access key in
    // `accessKeys`.
    const { accessKey, ...rest } = held
    await accounts.renew.commit(
      Session.from({ ...rest, accessKeys: [accessKey!] }),
    )
    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(`[TypeError: fetch failed]`)
  })

  test('keeps a session manager paying with its access key once a renewal drops a parked access key of another Tempo Account', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const owner = Secp256k1.randomPrivateKey()
    const held = session({ expiry: 3600, owner })
    const parked = session({ expiry: 3600 }).accessKey!
    await store.setItem(name, {
      state: { session: Session.from({ ...held, accessKeys: [parked] }) },
      version: 0,
    })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    // A renewal commits only its own access key, of the same Tempo Account.
    await accounts.renew.commit(session({ expiry: 3600, owner }))
    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(`[TypeError: fetch failed]`)
  })

  test('refuses each request of a session manager with Accounts.SignedOutError once later sessions drop its Tempo Account over several changes', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const held = session({ expiry: 3600 })
    await store.setItem(name, { state: { session: held }, version: 0 })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    // A switch to a chain of another Tempo Account parks the manager's access key, then a sign-in
    // of that other Tempo Account drops it.
    const other = Secp256k1.randomPrivateKey()
    await accounts.renew.commit(
      Session.from({
        ...session({ expiry: 3600, owner: other }),
        accessKeys: [held.accessKey!],
      }),
    )
    await accounts.renew.commit(session({ expiry: 3600, owner: other }))
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Accounts.SignedOutError)
  })

  test('keeps a session manager paying with its access key once a switch parks it and a renewal of its Tempo Account follows', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const owner = Secp256k1.randomPrivateKey()
    const held = session({ expiry: 3600, owner })
    await store.setItem(name, { state: { session: held }, version: 0 })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    // A switch to a chain of another Tempo Account parks the manager's access key, then a renewal
    // of the manager's Tempo Account follows.
    await accounts.renew.commit(
      Session.from({
        ...session({ expiry: 3600 }),
        accessKeys: [held.accessKey!],
      }),
    )
    await accounts.renew.commit(session({ expiry: 3600, owner }))
    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(`[TypeError: fetch failed]`)
  })

  test('refuses each request of a session manager with Accounts.SignedOutError once the same user signs in again after the sign-out', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(name, {
      state: { session: session({ expiry: 3600, owner }) },
      version: 0,
    })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    await accounts.signOut()
    await accounts.renew.commit(session({ expiry: 3600, owner }))
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('refuses each request of a session manager with Accounts.SignedOutError, before any request, once its access key expires', async () => {
    const store = Store.memory()
    const accounts = instance({ store })
    await store.setItem(name, {
      state: { session: session({ expiry: 2 }) },
      version: 0,
    })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    await expect
      .poll(
        async () =>
          (
            (await manager
              .fetch('http://127.0.0.1:9/content')
              .catch((error: unknown) => error)) as Error
          ).name,
        { timeout: 4_000 },
      )
      .toBe('Accounts.SignedOutError')
  })

  test('refuses a payment with Accounts.SignedOutError, before the access key signs, once another instance on the store signs out', async () => {
    const store = Store.memory()
    const endpoint = server()
    const first = instance({ fetch: endpoint.fetch, store })
    // Another process on the same entries, whose messages never reach the first instance.
    const second = instance({
      store: Store.from({
        getItem: (key) => store.getItem(key),
        removeItem: (key) => store.removeItem(key),
        setItem: (key, value, options) => store.setItem(key, value, options),
      }),
    })
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    await Promise.all([first.session.get(), second.session.get()])

    // Nothing listens at Tempo ID's URL, so the revocation fails, but the sign-out empties the store.
    await second.signOut().catch(() => undefined)
    const error = await first
      .fetch('http://mpp.test/proof')
      .catch((error: unknown) => error)

    expect({ credentials: endpoint.credentials, error }).toMatchInlineSnapshot(`
      {
        "credentials": [
          false,
        ],
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
      }
    `)
  })

  test('pays a charge when a read of the store fails', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    const store = Store.file(path)
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch, store })
    await accounts.session.get()

    // A damaged file fails each read of the store, as a hand edit does.
    await Fs.writeFile(path, 'not json')

    await accounts.fetch('http://mpp.test/proof').catch(() => undefined)

    expect(endpoint.credentials.slice(0, 2)).toMatchInlineSnapshot(`
      [
        false,
        true,
      ]
    `)
  })

  test("rejects a charge with the reason of the request's signal when it aborts during a store read that stalls", async () => {
    const memory = Store.memory()
    const controller = new AbortController()
    let stalled = false
    // A store that queues commands while it reconnects, such as a Redis client, answers no read.
    const store = Store.from({
      ...memory,
      getItem: (key) => {
        if (!stalled || key !== name) return memory.getItem(key)
        controller.abort(new Error('The request timed out.'))
        return new Promise(() => {})
      },
    })
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch, store })
    await accounts.session.get()
    stalled = true

    const error = await accounts
      .fetch('http://mpp.test/proof', { signal: controller.signal })
      .catch((error: unknown) => error)

    expect({ credentials: endpoint.credentials, error }).toMatchInlineSnapshot(`
      {
        "credentials": [
          false,
        ],
        "error": [Error: The request timed out.],
      }
    `)
  })

  test('refuses each request of a session manager with Accounts.SignedOutError, before any request, once another instance on the store signs out', async () => {
    const store = Store.memory()
    const first = instance({ store })
    const second = instance({ store })
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    await Promise.all([first.session.get(), second.session.get()])
    const manager = first.mpp.session()

    // Nothing listens at Tempo ID's URL, so the revocation fails, but the sign-out empties the store.
    await second.signOut().catch(() => undefined)
    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('refuses a charge of a fixed session with Accounts.SignedOutError, before the access key signs, once its access key expires during the request', async () => {
    const gate = Promise.withResolvers<void>()
    const endpoint = server({ hold: gate.promise })
    const accounts = instance({ fetch: endpoint.fetch })
    const fixed = session({ expiry: 2 })

    // The endpoint answers the first request only once the access key expired.
    const pending = accounts
      .mpp({ session: fixed })
      .fetch('http://mpp.test/proof')
      .catch((error: unknown) => error)
    await expect
      .poll(() => AccessKey.expired(fixed.accessKey!), { timeout: 4_000 })
      .toBe(true)
    gate.resolve()
    const error = await pending

    expect({ credentials: endpoint.credentials, error }).toMatchInlineSnapshot(`
      {
        "credentials": [
          false,
        ],
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
      }
    `)
  })

  test("refuses a charge with Accounts.SignedOutError, before the access key signs, once the access key of the instance's session expires during the request", async () => {
    const store = Store.memory()
    const gate = Promise.withResolvers<void>()
    const endpoint = server({ hold: gate.promise })
    const accounts = instance({ fetch: endpoint.fetch, store })
    const stored = session({ expiry: 2 })
    await store.setItem(name, { state: { session: stored }, version: 0 })
    await accounts.session.get()

    // The endpoint answers the first request only once the access key expired.
    const pending = accounts
      .fetch('http://mpp.test/proof')
      .catch((error: unknown) => error)
    await expect
      .poll(() => AccessKey.expired(stored.accessKey!), { timeout: 4_000 })
      .toBe(true)
    gate.resolve()
    const error = await pending

    expect({ credentials: endpoint.credentials, error }).toMatchInlineSnapshot(`
      {
        "credentials": [
          false,
        ],
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
      }
    `)
  })

  test('refuses a charge with Accounts.SignedOutError, before the access key signs, once the same user signs in again after a sign-out during the request', async () => {
    const store = Store.memory()
    const gate = Promise.withResolvers<void>()
    const endpoint = server({ hold: gate.promise })
    const accounts = instance({ fetch: endpoint.fetch, store })
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(name, {
      state: { session: session({ expiry: 3600, owner }) },
      version: 0,
    })
    await accounts.session.get()

    // The endpoint answers the first request only once the same user signed in again. Nothing
    // listens at Tempo ID's URL, so the revocation fails, but the sign-out ends the session.
    const pending = accounts
      .fetch('http://mpp.test/proof')
      .catch((error: unknown) => error)
    await expect.poll(() => endpoint.credentials).toEqual([false])
    await accounts.signOut().catch(() => undefined)
    await accounts.renew.commit(session({ expiry: 3600, owner }))
    gate.resolve()
    const error = await pending

    expect({ credentials: endpoint.credentials, error }).toMatchInlineSnapshot(`
      {
        "credentials": [
          false,
        ],
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
      }
    `)
  })

  test('pays a charge of a session that holds the same access key again after a sign-out', async () => {
    const store = Store.memory()
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch, store })
    const stored = session({ expiry: 3600 })
    await store.setItem(name, { state: { session: stored }, version: 0 })
    await accounts.session.get()
    await accounts.fetch('http://mpp.test/proof').catch(() => undefined)
    // Nothing listens at Tempo ID's URL, so the revocation fails, but the sign-out ends the session.
    await accounts.signOut().catch(() => undefined)
    await accounts.renew.commit(stored)
    endpoint.credentials.length = 0

    await accounts.fetch('http://mpp.test/proof').catch(() => undefined)

    expect(endpoint.credentials.slice(0, 2)).toMatchInlineSnapshot(`
      [
        false,
        true,
      ]
    `)
  })

  test('rejects a charge whose only offer names another chain with mpp.ChainError, before the access key signs', async () => {
    const database = new PGlite()
    onTestFinished(() => database.close())
    const endpoint = server({ amount: '0.5' })
    // The endpoint offers its charge on Tempo mainnet only, and the access key acts on Tempo testnet.
    const mainnet = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await endpoint.fetch(input, init)
      if (response.status !== 402) return response
      const challenge = Challenge.fromResponse(response)
      const rewritten = Challenge.from({
        ...challenge,
        request: {
          ...challenge.request,
          methodDetails: {
            ...(challenge.request.methodDetails as object),
            chainId: 4217,
          },
        },
      })
      return new Response(null, {
        headers: { 'WWW-Authenticate': Challenge.serialize(rewritten) },
        status: 402,
      })
    }
    const store = Store.postgres({
      query: (text, values) => database.query(text, [...values]) as never,
    })
    const error = await instance({ fetch: mainnet, store })
      .mpp({ session: session({ expiry: 3600 }) })
      .fetch('http://mpp.test/proof')
      .catch((error: Error) => error)

    expect({
      credentials: endpoint.credentials,
      error: error instanceof ChainError,
      message: (error as Error).message,
    }).toMatchInlineSnapshot(`
      {
        "credentials": [
          false,
        ],
        "error": true,
        "message": "The charge is on chain 4217, but the payer acts on chain 42431. Pay on chain 42431.",
      }
    `)
  })

  test("passes a charge in a Tempo-format currency within the access key's limits to its signature", async () => {
    const pathUsd = '0x20c0000000000000000000000000000000000000'
    const endpoint = server({ amount: '0.5' })
    const fixed = session({
      expiry: 3600,
      limits: [{ limit: 1_000_000n, token: pathUsd }],
    })

    // The endpoint names its currency in the Tempo format, which the method's schema accepts.
    const tempoFormat = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const response = await endpoint.fetch(input, init)
      if (response.status !== 402) return response
      const challenge = Challenge.fromResponse(response)
      const rewritten = Challenge.from({
        ...challenge,
        request: {
          ...challenge.request,
          currency: TempoAddress.format(pathUsd),
        },
      })
      return new Response(null, {
        headers: { 'WWW-Authenticate': Challenge.serialize(rewritten) },
        status: 402,
      })
    }
    const error = await instance({ fetch: tempoFormat })
      .mpp({ session: fixed })
      .fetch('http://mpp.test/proof')
      .catch((error: unknown) => (error as Error).name)

    expect(error === 'Address.InvalidAddressError').toMatchInlineSnapshot(
      `false`,
    )
  })

  test("reads the chain's limit of a charge in a token whose limit pays only network fees, before the access key signs", async () => {
    const mach = '0x20c000000000000000000000f37de3740adec032'
    const pathUsd = '0x20c0000000000000000000000000000000000000'
    const endpoint = server({ amount: '0.05' })
    const sent: { method: string; params: [{ data?: string }] }[] = []
    // Nothing listens at the URL, so the transport records each request that would reach a node.
    const transport = http('http://127.0.0.1:9', {
      async onFetchRequest(request) {
        sent.push(await request.clone().json())
      },
      retryCount: 0,
    })
    // Returns the token of each read of a remaining limit that precedes the charge's transaction.
    const reads = async (
      scopes: KeyAuthorization.KeyAuthorization['scopes'],
    ) => {
      sent.length = 0
      const fixed = session({
        expiry: 3600,
        limits: [
          { limit: 2_000_000n, token: mach },
          { limit: 100_000n, token: pathUsd },
        ],
        scopes,
      })
      await instance({ fetch: endpoint.fetch, transport })
        .mpp({ session: fixed })
        .fetch('http://mpp.test/proof')
        .catch(() => undefined)
      const fill = sent.findIndex(
        (request) => request.method === 'eth_fillTransaction',
      )
      return sent
        .slice(0, fill)
        .map((request) => request.params[0].data ?? '')
        .filter((data) => data.startsWith('0xa7f72cab'))
        .map((data) => `0x${data.slice(-40)}`)
    }

    // A scope calls pathUSD, so the access key sends it, and the signed limit covers the charge.
    const sends = await reads([{ address: mach }, { address: pathUsd }])
    // No scope calls pathUSD, so its limit is a fee allowance, which covers no charge.
    const fees = await reads([{ address: mach }])

    expect({ fees, sends }).toMatchInlineSnapshot(`
      {
        "fees": [
          "0x20c0000000000000000000000000000000000000",
        ],
        "sends": [],
      }
    `)
  })

  test('refuses a payment of a named account outside a page with mpp.SubscriptionOnlyError, before any request', async () => {
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch })
    const account = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )

    const error = await accounts
      .mpp({ account })
      .fetch('http://mpp.test/proof')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[mpp.SubscriptionOnlyError: The payer names a Tempo Account without a session, so it pays only subscriptions, in a page. Pay charges and sessions with a session, and subscriptions from a page.]`,
    )
    expect(endpoint.credentials).toMatchInlineSnapshot(`[]`)
  })

  test('refuses a session manager of a named account with mpp.SubscriptionOnlyError', () => {
    const accounts = instance()
    const account = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )

    const error = (() => {
      try {
        accounts.mpp({ account }).session()
        return undefined
      } catch (error) {
        return error
      }
    })()

    expect((error as Error | undefined)?.name).toMatchInlineSnapshot(
      `"mpp.SubscriptionOnlyError"`,
    )
  })

  test('pays with a fixed session over a named account', async () => {
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch })
    const account = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )

    // The endpoint's chain URL refuses the credential, after the session's access key signed it.
    await accounts
      .mpp({ account, session: session({ expiry: 60 }) })
      .fetch('http://mpp.test/proof')
      .catch(() => undefined)

    expect(endpoint.credentials.slice(0, 2)).toMatchInlineSnapshot(`
      [
        false,
        true,
      ]
    `)
  })

  test("reads the registration mark of a connection's `accessKey` alone, since its `accessKeys` are no session's access keys of other chains", async () => {
    const endpoint = server()
    const memory = Store.memory()
    const reads: string[] = []
    const store = Store.from({
      ...memory,
      getItem(key) {
        if (key.startsWith('tempo-id:registered:')) reads.push(key)
        return memory.getItem(key)
      },
    })
    const accounts = instance({ fetch: endpoint.fetch, store })
    // An API holds the connection that `connections.connect` returned.
    const accessKey = session({ expiry: 60 }).accessKey!
    const connection = {
      accessKey,
      accessKeys: [accessKey, session({ expiry: 60 }).accessKey!],
      clientId: 'https://app.example.com',
      resource: 'https://api.example.com',
      userId: 'user_1',
    }

    // The endpoint's chain URL refuses the credential, after the connection's access key signed it.
    await accounts
      .mpp({ session: connection })
      .fetch('http://mpp.test/proof')
      .catch(() => undefined)

    expect(reads.length).toMatchInlineSnapshot(`1`)
  })

  test('refuses an invalid or too precise maxAmount before any request', async () => {
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch })
    const fixed = session({ expiry: 3600 })

    const errors = await Promise.all(
      ['', '1e3', '-1', '0.0000001', 0.1 as unknown as string].map(
        (maxAmount) =>
          accounts
            .mpp({ maxAmount, session: fixed })
            .fetch('http://mpp.test/proof')
            .then(
              () => undefined,
              (error: Error) => [error.name, error.message],
            ),
      ),
    )

    expect({ credentials: endpoint.credentials, errors })
      .toMatchInlineSnapshot(`
        {
          "credentials": [],
          "errors": [
            [
              "mpp.MaxAmountInvalidError",
              "Invalid \`maxAmount\`: "" is not a decimal amount of 0 or more. Pass a decimal string, such as \`'0.1'\`.",
            ],
            [
              "mpp.MaxAmountInvalidError",
              "Invalid \`maxAmount\`: "1e3" is not a decimal amount of 0 or more. Pass a decimal string, such as \`'0.1'\`.",
            ],
            [
              "mpp.MaxAmountInvalidError",
              "Invalid \`maxAmount\`: "-1" is not a decimal amount of 0 or more. Pass a decimal string, such as \`'0.1'\`.",
            ],
            [
              "mpp.MaxAmountPrecisionError",
              "Invalid \`maxAmount\`: 0.0000001 has more than 6 decimals. Round it to 6 decimals.",
            ],
            [
              "mpp.MaxAmountInvalidError",
              "Invalid \`maxAmount\`: "0.1" is not a decimal amount of 0 or more. Pass a decimal string, such as \`'0.1'\`.",
            ],
          ],
        }
      `)
  })

  test('refuses an untyped NaN, null, number, or symbol maxAmount after a payment of the same access key', async () => {
    const endpoint = server()
    const accounts = instance({ fetch: endpoint.fetch })
    const fixed = session({ expiry: 3600 })
    await accounts.mpp({ session: fixed }).fetch('http://mpp.test/proof')
    await accounts
      .mpp({ maxAmount: '0.1', session: fixed })
      .fetch('http://mpp.test/proof')

    const errors = await Promise.all(
      [Number.NaN, null, 0.1, Symbol()].map((maxAmount) =>
        accounts
          .mpp({ maxAmount: maxAmount as unknown as string, session: fixed })
          .fetch('http://mpp.test/proof')
          .then(
            () => undefined,
            (error: Error) => error.name,
          ),
      ),
    )

    expect({ credentials: endpoint.credentials.length, errors })
      .toMatchInlineSnapshot(`
        {
          "credentials": 8,
          "errors": [
            "mpp.MaxAmountInvalidError",
            "mpp.MaxAmountInvalidError",
            "mpp.MaxAmountInvalidError",
            "mpp.MaxAmountInvalidError",
          ],
        }
      `)
  })

  test('sends each request of a session manager when a read of the store fails', async () => {
    const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-'))
    const path = Path.join(directory, 'session.json')
    const store = Store.file(path)
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    const accounts = instance({ store })
    await accounts.session.get()
    const manager = accounts.mpp.session()

    // A damaged file fails each read of the store, as a hand edit does.
    await Fs.writeFile(path, 'not json')

    // Nothing listens at the URL, so a request that the manager sends rejects with a network error.
    const error = await manager
      .fetch('http://127.0.0.1:9/content')
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(`[TypeError: fetch failed]`)
  })

  test('sends the identity to an origin of `identity.scope` that the app names with a trailing slash', async () => {
    const store = Store.memory()
    await store.setItem(name, {
      state: { session: { ...session({ expiry: 3600 }), idToken: 'id-token' } },
      version: 0,
    })
    // A free API records the headers of each request that it receives.
    const headers: Http.IncomingHttpHeaders[] = []
    const api = Http.createServer((request, response) => {
      headers.push(request.headers)
      response.end('free')
    })
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
    const address = api.address()
    if (!address || typeof address === 'string') throw new Error('No port.')
    const origin = `http://127.0.0.1:${address.port}`
    const accounts = instance({
      // An origin read from the environment often ends with a slash, such as `API_URL`.
      identity: { scope: [`${origin}/`] },
      store,
    })

    await accounts.mpp().fetch(`${origin}/fortune`)
    await new Promise((resolve) => api.close(resolve))

    expect(
      headers.map((entry) => [entry.authorization, entry['tempo-id-token']]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Bearer access-token",
          "id-token",
        ],
      ]
    `)
  })

  test('refuses an entry of `identity.scope` with a path, without its secrets in the error, before any request', () => {
    expect(() =>
      mpp({
        identity: {
          scope: ['https://user:secret@api.example.com/v1?key=secret'],
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Invalid identity scope: an entry of \`https://api.example.com\` names a path, a query, or a fragment. Name the origin alone.]`,
    )
  })

  test("sends the access token and the ID token of the instance's session to the origins of `identity.scope`, and none to another origin", async () => {
    const store = Store.memory()
    await store.setItem(name, {
      state: { session: { ...session({ expiry: 3600 }), idToken: 'id-token' } },
      version: 0,
    })
    const requests: Request[] = []
    const accounts = instance({
      fetch: (input, init) => {
        requests.push(new Request(input, init))
        return Promise.resolve(new Response('free'))
      },
      identity: { scope: ['https://api.example.com'] },
      store,
    })

    await accounts.mpp().fetch('https://api.example.com/fortune')
    await accounts.mpp().fetch('https://other.example.com/fortune')

    expect(
      requests.map((request) => [
        request.url,
        request.headers.get('authorization'),
        request.headers.get('tempo-id-token'),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "https://api.example.com/fortune",
          "Bearer access-token",
          "id-token",
        ],
        [
          "https://other.example.com/fortune",
          null,
          null,
        ],
      ]
    `)
  })

  test("sends the access token and the ID token of the instance's session from a session manager to the origins of `identity.scope`", async () => {
    const store = Store.memory()
    await store.setItem(name, {
      state: { session: { ...session({ expiry: 3600 }), idToken: 'id-token' } },
      version: 0,
    })
    const requests: Request[] = []
    const accounts = instance({
      fetch: (input, init) => {
        requests.push(new Request(input, init))
        return Promise.resolve(new Response('free'))
      },
      identity: { scope: ['https://api.example.com'] },
      store,
    })

    await accounts.mpp.session().fetch('https://api.example.com/content')

    expect(
      requests.map((request) => [
        request.url,
        request.headers.get('authorization'),
        request.headers.get('tempo-id-token'),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "https://api.example.com/content",
          "Bearer access-token",
          "id-token",
        ],
      ]
    `)
  })

  test('sends a Bearer access token that no DPoP key binds as Bearer, without a proof, from an instance with a `dpop` key', async () => {
    const store = Store.memory()
    // A session that the app saved before it set its `dpop` key holds a Bearer token until a refresh.
    await store.setItem(name, {
      state: { session: session({ expiry: 3600 }) },
      version: 0,
    })
    // A free API records the headers of each request that it receives.
    const headers: Http.IncomingHttpHeaders[] = []
    const api = Http.createServer((request, response) => {
      headers.push(request.headers)
      response.end('free')
    })
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
    const address = api.address()
    if (!address || typeof address === 'string') throw new Error('No port.')
    const origin = `http://127.0.0.1:${address.port}`
    const accounts = instance({
      dpop: await Dpop.create(),
      identity: { scope: [origin] },
      store,
    })

    await accounts.mpp().fetch(`${origin}/fortune`)
    await new Promise((resolve) => api.close(resolve))

    // An API that verifies Tempo ID tokens refuses a Bearer token sent with the `DPoP` scheme.
    expect(
      headers.map((entry) => [entry.authorization, entry.dpop !== undefined]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Bearer access-token",
          false,
        ],
      ]
    `)
  })

  test('sends the paid retry without identity once the session can no longer read its access token', async () => {
    const owner = Secp256k1.randomPrivateKey()
    const store = Store.memory()
    await store.setItem(name, {
      state: {
        session: { ...session({ expiry: 3600, owner }), idToken: 'id-token' },
      },
      version: 0,
    })
    const gate = Promise.withResolvers<void>()
    const endpoint = server({ hold: gate.promise, requiresAuth: true })
    const accounts = instance({
      fetch: endpoint.fetch,
      identity: { scope: ['https://mpp.test'] },
      store,
    })

    const response = accounts.mpp().fetch('https://mpp.test/fortune')
    await expect.poll(() => endpoint.requests.length).toBe(1)
    // An access token at its expiry needs a refresh, and nothing listens at Tempo ID's URL.
    await accounts.renew.commit({
      ...session({ expiry: 3600, owner }),
      expiresAt: Date.now(),
    })
    gate.resolve()
    expect((await response).status).toBe(402)

    expect(
      endpoint.requests.map((request) => [
        request.headers.get('authorization'),
        request.headers.get('tempo-id-token'),
        request.headers.has('payment-authorization'),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Bearer access-token",
          "id-token",
          false,
        ],
        [
          null,
          null,
          true,
        ],
        [
          null,
          null,
          true,
        ],
        [
          null,
          null,
          true,
        ],
      ]
    `)
  })

  test('sends the paid retry without identity to an endpoint of `identity.scope` that takes the credential in Authorization', async () => {
    const store = Store.memory()
    await store.setItem(name, {
      state: { session: { ...session({ expiry: 3600 }), idToken: 'id-token' } },
      version: 0,
    })
    const endpoint = server()
    const accounts = instance({
      fetch: endpoint.fetch,
      identity: { scope: ['https://mpp.test'] },
      store,
    })

    // Nothing listens at the endpoint's chain, so it refuses each credential.
    const result = await accounts
      .fetch('https://mpp.test/fortune')
      .then((response) => response.status)
      .catch((error: unknown) => error)

    expect({
      requests: endpoint.requests.map((request) => [
        request.headers.get('authorization')?.split(' ')[0] ?? null,
        request.headers.get('tempo-id-token'),
      ]),
      result,
    }).toMatchInlineSnapshot(`
      {
        "requests": [
          [
            "Bearer",
            "id-token",
          ],
          [
            "Payment",
            null,
          ],
          [
            "Payment",
            null,
          ],
          [
            "Payment",
            null,
          ],
        ],
        "result": 402,
      }
    `)
  })

  test('sends a request that carries a payment credential without identity once the session can no longer read its access token', async () => {
    const store = Store.memory()
    // An access token at its expiry needs a refresh, and nothing listens at Tempo ID's URL.
    await store.setItem(name, {
      state: {
        session: {
          ...session({ expiry: 3600 }),
          expiresAt: Date.now(),
          idToken: 'id-token',
        },
      },
      version: 0,
    })
    const requests: Request[] = []
    const accounts = instance({
      fetch: (input, init) => {
        requests.push(new Request(input, init))
        return Promise.resolve(new Response('closed'))
      },
      identity: { scope: ['https://api.example.com'] },
      store,
    })

    const error = await accounts
      .mpp()
      .fetch('https://api.example.com/fortune')
      .catch((error: unknown) => error)
    await accounts.mpp().fetch('https://api.example.com/close', {
      headers: { 'Payment-Authorization': 'Payment credential' },
      method: 'POST',
    })

    expect(error).toBeInstanceOf(Error)
    expect(
      requests.map((request) => [
        request.url,
        request.headers.get('authorization'),
        request.headers.get('tempo-id-token'),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "https://api.example.com/close",
          null,
          null,
        ],
      ]
    `)
  })
})

/** Returns an instance with the `mpp` plugin, whose chain and Tempo ID are at a URL where nothing listens. */
function instance(
  options: {
    chain?: 4217 | 42431 | undefined
    /** The instance's DPoP key. Absent, the instance holds none. */
    dpop?: Dpop.Dpop | undefined
    fetch?: typeof globalThis.fetch | undefined
    identity?: mpp.Identity | undefined
    store?: Store.Store | undefined
    /** The transport of the chain's clients. Defaults to one to the URL where nothing listens. */
    transport?: Transport | undefined
  } = {},
) {
  return Accounts.create({
    chain: options.chain ?? 42431,
    clientId: 'https://app.example.com',
    ...(options.dpop ? { dpop: options.dpop } : {}),
    ...(options.store ? { store: options.store } : {}),
    plugins: [
      viem({ transport: options.transport ?? http('http://127.0.0.1:9') }),
      mpp({ fetch: options.fetch, identity: options.identity }),
      renew(),
    ],
    url: 'http://127.0.0.1:9',
  })
}

/**
 * Returns an endpoint that challenges each request for a proof, and records whether each request
 * carries a credential. Nothing listens at its chain's URL, so it refuses each credential, after the
 * access key signed it.
 */
function server(
  options: {
    /** The amount of the charge, in the units of its token. Defaults to `'0'`, a proof. */
    amount?: string | undefined
    hold?: Promise<void> | undefined
    /** Whether the endpoint takes credentials in `Payment-Authorization`, beside an access token. */
    requiresAuth?: boolean | undefined
  } = {},
) {
  const credentials: boolean[] = []
  const requests: Request[] = []
  const payment = Mppx.create({
    methods: [
      tempo.charge({
        chainId: 42431,
        currency: '0x20c0000000000000000000000000000000000000',
        getClient: () =>
          createClient({
            transport: http('http://127.0.0.1:9', { retryCount: 0 }),
          }),
        recipient: Address.fromPublicKey(
          Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
        ),
        store: MppxStore.memory(),
      }),
    ],
    realm: 'mpp.test',
    ...(options.requiresAuth ? { requiresAuth: true } : {}),
    secretKey: crypto.randomUUID(),
  })
  async function handle(request: Request) {
    credentials.push(request.headers.has('authorization'))
    requests.push(request)
    await options.hold
    const result = await payment.tempo.charge({
      amount: options.amount ?? '0',
    })(request)
    if (result.status === 402) return result.challenge
    return result.withReceipt(new Response('paid'))
  }
  return {
    credentials,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handle(new Request(input, init))) as typeof globalThis.fetch,
    requests,
  }
}

/** Returns a plugin whose `commit` commits a session, as the `viem` plugin's limit renewal does. */
function renew() {
  return Plugin.from({
    actions: (context) => ({
      commit: (value: Session.Any) => context.session.change().commit(value),
    }),
    id: 'renew',
  })
}

/** The store entry of the instance's session. */
const name =
  'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]'

/** Returns a session whose access key expires `expiry` seconds from now, with a signed key authorization. */
function session(options: {
  expiry: number
  /** The token limits of the access key. Absent, the access key spends any token. */
  limits?: KeyAuthorization.KeyAuthorization['limits']
  owner?: Hex.Hex | undefined
  /** The calls that the access key may make. Absent, the access key makes any call. */
  scopes?: KeyAuthorization.KeyAuthorization['scopes']
}) {
  const owner = options.owner ?? Secp256k1.randomPrivateKey()
  const privateKey = Secp256k1.randomPrivateKey()
  const authorization = KeyAuthorization.from({
    address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    chainId: 42431n,
    expiry: Math.floor(Date.now() / 1000) + options.expiry,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.scopes ? { scopes: options.scopes } : {}),
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(authorization),
    privateKey: owner,
  })
  return Session.from({
    accessKey: {
      account: Address.fromPublicKey(
        Secp256k1.getPublicKey({ privateKey: owner }),
      ),
      chainId: 42431,
      keyAuthorization: KeyAuthorization.toRpc(
        KeyAuthorization.from(authorization, { signature }),
      ),
      privateKey,
    },
    accessToken: 'access-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { email: 'user@example.com', id: 'user_1' },
  })
}
