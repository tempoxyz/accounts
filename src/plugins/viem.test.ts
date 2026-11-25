/**
 * Runs the `viem` plugin without a server: the account of the default client before and after the
 * instance reads its saved session, an action held across `switchChain`, the access token that
 * the relay route receives, the access token of the owner's account read during a refresh, the
 * machine of a retry's screen, and the machine of the hold of a registration.
 * @module
 */
import { Address, Secp256k1 } from 'ox'
import { KeyAuthorization, TxEnvelopeTempo } from 'ox/tempo'
import { type BaseError, custom, http } from 'viem'
import { type Account, Actions } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import {
  createActor,
  fromPromise,
  getNextSnapshot,
  initialTransition,
  waitFor,
} from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Accounts from '../Accounts.js'
import * as AccessKey from '../internal/AccessKey.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { backend } from './backend.js'
import { machines, viem } from './viem.js'

describe('viem', () => {
  test('throws SignedOutError that names `session.get` while the saved session is unread, and the sign-in once the read finds none', async () => {
    const accounts = Accounts.create({
      clientId: 'cli:acme-example',
      plugins: [viem()],
      store: Store.memory(),
    })
    const read = () => {
      try {
        return accounts.viem.account.address
      } catch (error) {
        return error
      }
    }

    // A new run of a CLI sends before it reads the saved session.
    const unread = read()
    await accounts.session.get()
    const signedOut = read()

    expect(unread).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account holds no session while the instance reads the saved session or a sign-in runs. Await \`session.get()\` or the sign-in before sending.]`,
    )
    expect(signedOut).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('runs an action that the app holds across switchChain on the selected chain', async () => {
    const store = Store.memory()
    const owners = [Secp256k1.randomPrivateKey(), Secp256k1.randomPrivateKey()]
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey: createAccessKey({ chainId: 4217, owner: owners[0]! }),
            accessKeys: [
              createAccessKey({ chainId: 42431, owner: owners[1]! }),
            ],
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const getAddresses = accounts.getAddresses

    await accounts.switchChain({ chainId: 42431 })
    const [address] = await getAddresses()

    expect(
      Address.isEqual(
        address!,
        Address.fromPublicKey(
          Secp256k1.getPublicKey({ privateKey: owners[1]! }),
        ),
      ),
    ).toMatchInlineSnapshot(`true`)
  })

  test("sends the session's access token to the `relay` route, and none while signed out", async () => {
    const route = relayRoute()
    const signedOut = relayInstance({
      fetch: route.fetch,
      store: Store.memory(),
    })
    const signedIn = relayInstance({
      fetch: route.fetch,
      store: await sessionStore(),
    })
    await Promise.all([signedOut.session.get(), signedIn.session.get()])

    await fill(signedOut)
    await fill(signedIn)

    expect(route.authorizations).toMatchInlineSnapshot(`
      [
        null,
        "Bearer access-token",
      ]
    `)
  })

  test("sends no access token to a relay at another origin, from a fixed session, or over the URL's own credentials", async () => {
    const route = relayRoute()
    const store = await sessionStore()
    const other = relayInstance({
      fetch: route.fetch,
      relay: 'https://relay.example/relay',
      store,
    })
    const own = relayInstance({ fetch: route.fetch, store })
    const credentials = relayInstance({
      fetch: route.fetch,
      relay: 'https://user:secret@app.example.com/relay',
      store,
    })
    await Promise.all([
      other.session.get(),
      own.session.get(),
      credentials.session.get(),
    ])
    const fixed = own.viem({
      session: {
        accessKey: createAccessKey({
          chainId: 42431,
          owner: Secp256k1.randomPrivateKey(),
        }),
      },
    })

    await fill(other)
    await fixed.request({
      method: 'eth_fillTransaction',
      params: [{}],
    } as never)
    await fill(credentials)

    expect(route.authorizations).toMatchInlineSnapshot(`
      [
        null,
        null,
        "Basic dXNlcjpzZWNyZXQ=",
      ]
    `)
  })

  test("sends the session's access token to a relay at another origin with `credentials: 'include'`", async () => {
    const route = relayRoute()
    const accounts = relayInstance({
      fetch: route.fetch,
      relay: { credentials: 'include', url: 'https://api.example/relay' },
      store: await sessionStore(),
    })
    await accounts.session.get()

    await fill(accounts)

    expect(route.authorizations).toMatchInlineSnapshot(`
      [
        "Bearer access-token",
      ]
    `)
  })

  test('sends the token of a session without a refresh token until it expires', async () => {
    const route = relayRoute()
    const accounts = relayInstance({
      fetch: route.fetch,
      store: await sessionStore({ expiresAt: Date.now() + 10_000 }),
    })
    await accounts.session.get()

    await fill(accounts)

    expect(route.authorizations).toMatchInlineSnapshot(`
      [
        "Bearer access-token",
      ]
    `)
  })

  test('refuses a transaction of an account read before its expired session emptied, with SignedOutError', async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    // At least a second before the access key expires, so the client reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    // A caller holds the signer of the live session, as Viem's actions do across awaits.
    const { signTransaction } = accounts.viem.account

    await expect
      .poll(() => AccessKey.expired(accessKey), { timeout: 5_000 })
      .toBe(true)
    const emptied = await accounts.session.get()
    const error = await signTransaction({
      calls: [{ data: '0x', to: '0x0000000000000000000000000000000000000001' }],
      chainId: 4217,
      gas: 100_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      nonce: 0,
      type: 'tempo',
    } as never).catch((error: unknown) => error)

    expect({ emptied, error }).toMatchInlineSnapshot(`
      {
        "emptied": undefined,
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
      }
    `)
  })

  test("drops the material of the session's own access key that revoke revoked, and keeps the access key as data", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const accessKey = createAccessKey({ chainId: 4217, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      // Tempo ID revokes the access key, and returns the receipt of its transaction.
      fetch(input, init) {
        const request = new Request(input, init)
        requests.push(`${request.method} ${new URL(request.url).pathname}`)
        return Promise.resolve(
          Response.json({
            receipt: {
              blockHash: `0x${'11'.repeat(32)}`,
              blockNumber: '0x1',
              contractAddress: null,
              cumulativeGasUsed: '0x1',
              effectiveGasPrice: '0x1',
              from: accessKey.account,
              gasUsed: '0x1',
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              status: '0x1',
              to: '0xaaaaaaa000000000000000000000000000000000',
              transactionHash: `0x${'22'.repeat(32)}`,
              transactionIndex: '0x0',
              type: '0x76',
            },
          }),
        )
      },
      plugins: [
        viem({
          transport: http('http://127.0.0.1:9', { retryCount: 0 }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    await accounts.accessKey.revoke({
      accessKey: accessKey.keyAuthorization.keyId,
    })
    const session = await accounts.session.get()

    expect({
      material: Boolean(session?.accessKey?.privateKey),
      requests,
      session: {
        account: session?.accessKey?.account === accessKey.account,
        user: session?.user,
      },
    }).toMatchInlineSnapshot(`
      {
        "material": false,
        "requests": [
          "POST /v1/access-keys/revoke",
        ],
        "session": {
          "account": true,
          "user": {
            "email": "user@example.com",
            "id": "user_1",
          },
        },
      }
    `)
  })

  test('refuses a transfer of a session whose access key expired after the read, with SignedOutError before the node receives it', async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    // At least a second before the access key expires, so the instance reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    await expect
      .poll(() => AccessKey.expired(accessKey), { timeout: 5_000 })
      .toBe(true)

    // The status shows the sign-out once the access key expired, so a change of an access key reads
    // the client's account as signed out, and sends no request.
    const revoked = await accounts.accessKey
      .revoke({ accessKey: '0x0000000000000000000000000000000000000002' })
      .catch((error: unknown) => (error as Error).name)
    // The app sends without a read of the session in between, such as at a tap after a day.
    const error = await accounts.token
      .transferSync({
        amount: 1n,
        feeToken: '0x20c0000000000000000000000000000000000000',
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: unknown) => error)

    expect({ error, sent }).toMatchInlineSnapshot(`
      {
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
        "sent": [],
      }
    `)
    expect(revoked).toMatchInlineSnapshot(`"Accounts.SignedOutError"`)
  })

  test('rejects a transfer of a session without an access key on the chain with AccessKeyRequiredError before the node receives a fill, also through a standalone action', async () => {
    const store = Store.memory()
    // The session's only access key is on another chain, so the owner signs here, and no
    // transaction signs.
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey: createAccessKey({
              chainId: 42431,
              owner: Secp256k1.randomPrivateKey(),
            }),
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const parameters = {
      amount: 1n,
      to: '0x0000000000000000000000000000000000000001',
      token: '0x20c0000000000000000000000000000000000000',
    } as const

    const own = await accounts.token
      .transferSync(parameters)
      .catch((error: unknown) => error)
    // A standalone action, such as the one of wagmi/tempo, wraps the error in Viem's own.
    const standalone = await Actions.token
      .transferSync(accounts.viem, parameters)
      .catch((error: BaseError) => error.walk())
    const transfers = [...sent]
    // An estimate signs nothing, so it still fills.
    await accounts.token.transfer
      .estimateGas({
        ...parameters,
        account: accounts.viem.account,
        chain: accounts.viem.chain,
      })
      .catch(() => undefined)

    expect({ estimate: sent[0], own, standalone, transfers })
      .toMatchInlineSnapshot(`
      {
        "estimate": "eth_fillTransaction",
        "own": [Accounts.AccessKeyRequiredError: The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.],
        "standalone": [Accounts.AccessKeyRequiredError: The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.],
        "transfers": [],
      }
    `)
  })

  test("rejects Viem's standalone transfer with SignedOutError once the access key expired, and reads no account", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    // At least a second before the access key expires, so the instance reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    await expect
      .poll(() => accounts.session.status.get().status, { timeout: 5_000 })
      .toBe('signedOut')

    const account = (() => {
      try {
        return accounts.viem.account.address
      } catch (error) {
        return error
      }
    })()
    const error = await Actions.token
      .transferSync(accounts.viem, {
        amount: 1n,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: unknown) => error)

    expect({ account, error, sent }).toMatchInlineSnapshot(`
      {
        "account": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
        "error": [Accounts.SignedOutError: The client's account is signed out. Sign in before sending.],
        "sent": [],
      }
    `)
  })

  test('empties the session at the refusal of a transfer of an access key that expired, so the status shows the sign-out', async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    // At least a second before the access key expires, so the instance reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      // Nothing listens at the URL, so no request reaches a node.
      plugins: [
        viem({ transport: http('http://127.0.0.1:9', { retryCount: 0 }) }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const statuses: string[] = []
    accounts.session.status.subscribe((status) => statuses.push(status.status))
    await expect
      .poll(() => AccessKey.expired(accessKey), { timeout: 5_000 })
      .toBe(true)

    // A native app sends at a tap after a day, and renders the status, which changed once at the
    // expiry, before or after the refusal.
    const error = await accounts.token
      .transferSync({
        amount: 1n,
        feeToken: '0x20c0000000000000000000000000000000000000',
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: unknown) => (error as Error).name)

    await expect
      .poll(() => accounts.session.status.get().status, { timeout: 2_000 })
      .toBe('signedOut')
    expect({ error, statuses }).toMatchInlineSnapshot(`
      {
        "error": "Accounts.SignedOutError",
        "statuses": [
          "signedOut",
        ],
      }
    `)
  })

  test('empties the session at the refusal of a filled transfer of an access key that expired, so the status shows the sign-out', async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    // At least a second before the access key expires, so the instance reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    await expect
      .poll(() => AccessKey.expired(accessKey), { timeout: 5_000 })
      .toBe(true)

    // The status changes at the expiry, and the store keeps the session, so only the refusal below
    // can empty it.
    await expect
      .poll(() => accounts.session.status.get().status, { timeout: 2_000 })
      .toBe('signedOut')
    expect(
      await store.getItem(
        'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      ),
    ).toMatchObject({ state: { session: { accessToken: 'access-token' } } })

    // The transfer names no gas, so it ends at the refusal of its fill and its estimate, before
    // any signature.
    const error = await accounts.token
      .transferSync({
        amount: 1n,
        feeToken: '0x20c0000000000000000000000000000000000000',
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: unknown) => (error as Error).name)

    expect(error).toMatchInlineSnapshot(`"Accounts.SignedOutError"`)
    await expect
      .poll(() => accounts.session.status.get().status, { timeout: 2_000 })
      .toBe('signedOut')
    expect(
      await store.getItem(
        'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      ),
    ).toMatchInlineSnapshot(`
      {
        "state": {
          "session": undefined,
        },
        "version": 0,
      }
    `)
  })

  test('refuses the estimate of a filled transfer of an access key that expired, also after a newer session reaches the store', async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    // At least a second before the access key expires, so the instance reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(key, {
      state: {
        session: Session.from({
          accessKey,
          accessToken: 'access-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    await expect
      .poll(() => AccessKey.expired(accessKey), { timeout: 5_000 })
      .toBe(true)
    // Another context signs in a newer session, which the instance has not read.
    await store.setItem(key, {
      state: {
        session: Session.from({
          accessKey: createAccessKey({
            chainId: 4217,
            expiry: 3600,
            owner: Secp256k1.randomPrivateKey(),
          }),
          accessToken: 'access-token-2',
          expiresAt: Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    })

    const error = await accounts.token
      .transferSync({
        amount: 1n,
        feeToken: '0x20c0000000000000000000000000000000000000',
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: unknown) => (error as Error).name)

    expect({
      error,
      sent: sent.filter((method) =>
        ['eth_estimateGas', 'eth_sendRawTransactionSync'].includes(method),
      ),
    }).toMatchInlineSnapshot(`
      {
        "error": "Accounts.SignedOutError",
        "sent": [],
      }
    `)
  })

  test("refuses an expired access key's estimate only for its own account", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    // At least a second before the access key expires, so the client reads it while it lives.
    const accessKey = createAccessKey({ chainId: 4217, expiry: 2, owner })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          transport: custom({
            request(args) {
              sent.push(args.method)
              return Promise.resolve('0x1')
            },
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const { keyId } = accessKey.keyAuthorization
    const estimate = (from: string) =>
      accounts.viem
        .request({
          method: 'eth_estimateGas',
          params: [{ from, keyId }],
        } as never)
        .then(
          () => 'sent',
          (error: unknown) => (error as Error).name,
        )

    await expect
      .poll(() => AccessKey.expired(accessKey), { timeout: 5_000 })
      .toBe(true)
    const own = await estimate(accessKey.account)
    const other = await estimate('0x0000000000000000000000000000000000000002')

    expect({ other, own, sent }).toMatchInlineSnapshot(`
      {
        "other": "sent",
        "own": "Accounts.SignedOutError",
        "sent": [
          "eth_estimateGas",
        ],
      }
    `)
  })

  test('refuses a transaction of a fixed session whose access key expired, before the node receives it', async () => {
    const owner = Secp256k1.randomPrivateKey()
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // No node listens at the address, so each request that leaves the client fails after its record.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    // A backend holds the session that `backend.get` returned while its access key lived.
    const session = Session.from({
      accessKey: createAccessKey({ chainId: 4217, expiry: -60, owner }),
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: { email: 'user@example.com', id: 'user_1' },
    })
    const client = accounts.viem({ session })

    await client.token
      .transferSync({
        amount: 1n,
        to: '0x000000000000000000000000000000000000dEaD',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch(() => undefined)
    // A transaction whose fields are all given fills nothing, so only its signature can refuse it.
    const signed = await client.account
      .signTransaction({
        calls: [
          { data: '0x', to: '0x0000000000000000000000000000000000000001' },
        ],
        chainId: 4217,
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        type: 'tempo',
      } as never)
      .then(
        () => 'signed',
        (error: unknown) => (error as Error).name,
      )

    expect({ sent, signed }).toMatchInlineSnapshot(`
      {
        "sent": [],
        "signed": "Accounts.SignedOutError",
      }
    `)
  })

  test('refuses a transaction of a fixed session whose access key expired while an access key on another chain lives, with AccessKeyRequiredError', async () => {
    const owner = Secp256k1.randomPrivateKey()
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const session = Session.from({
      accessKey: createAccessKey({ chainId: 4217, expiry: -60, owner }),
      accessKeys: [createAccessKey({ chainId: 42431, owner })],
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

    const error = await accounts
      .viem({ session })
      .account.signTransaction({
        calls: [
          { data: '0x', to: '0x0000000000000000000000000000000000000001' },
        ],
        chainId: 4217,
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        type: 'tempo',
      } as never)
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.AccessKeyRequiredError: The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.]`,
    )
  })

  test("refuses a transaction of a connection whose `accessKey` expired with SignedOutError, since its `accessKeys` are no session's access keys of other chains", async () => {
    const owner = Secp256k1.randomPrivateKey()
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://api.example.com',
      plugins: [viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    // An API holds the connection that `connections.connect` returned while its access key lived.
    const accessKey = createAccessKey({ chainId: 4217, expiry: -60, owner })
    const connection = {
      accessKey,
      accessKeys: [accessKey, createAccessKey({ chainId: 42431, owner })],
      clientId: 'https://app.example.com',
      resource: 'https://api.example.com',
      userId: 'user_1',
    }

    const error = await accounts
      .viem({ session: connection })
      .account.signTransaction({
        calls: [
          { data: '0x', to: '0x0000000000000000000000000000000000000001' },
        ],
        chainId: 4217,
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        type: 'tempo',
      } as never)
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.SignedOutError: The client's account is signed out. Sign in before sending.]`,
    )
  })

  test('refuses a transaction of an access key that expired while an access key on another chain lives, with AccessKeyRequiredError', async () => {
    const store = Store.memory()
    const owners = [Secp256k1.randomPrivateKey(), Secp256k1.randomPrivateKey()]
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            // At least a second before the access key expires, so the client reads it while it lives.
            accessKey: createAccessKey({
              chainId: 4217,
              expiry: 2,
              owner: owners[0]!,
            }),
            accessKeys: [
              createAccessKey({ chainId: 42431, owner: owners[1]! }),
            ],
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const { account } = accounts.viem
    // The client reads its account while the access key lives, then the access key expires.
    void account.address
    const sign = () =>
      account
        .signTransaction({
          calls: [
            { data: '0x', to: '0x0000000000000000000000000000000000000001' },
          ],
          chainId: 4217,
          gas: 100_000n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          nonce: 0,
          type: 'tempo',
        } as never)
        .catch((error: unknown) => error)

    await expect
      .poll(async () => (await sign()) instanceof Error, { timeout: 5_000 })
      .toBe(true)

    expect(await sign()).toMatchInlineSnapshot(
      `[Accounts.AccessKeyRequiredError: The call needs an access key, but the client's account holds no live access key on the chain. Sign in with an access key on the chain.]`,
    )
  })
  test("drops the registration mark of the access key that a sign-out ends, which a store that keeps expired entries, such as `expo`'s, would keep for good", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const accessKey = createAccessKey({ chainId: 4217, owner })
    const address = KeyAuthorization.fromRpc(accessKey.keyAuthorization).address
    const name = `tempo-id:registered:${JSON.stringify([4217, accessKey.account.toLowerCase(), address.toLowerCase()])}`
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    // Viem removes the key authorization once the chain registered the access key, which marks it.
    const { keyAuthorizationManager } = accounts.viem
      .account as Account.AccessKeyAccount
    await keyAuthorizationManager!.remove({
      accessKey: address,
      address: accessKey.account,
      chainId: 4217,
    })
    await expect.poll(() => store.getItem(name)).toBeDefined()

    await accounts.signOut()

    await expect.poll(() => store.getItem(name)).toBeUndefined()
  })

  test("reads and writes the registration mark of a fixed session's access key in the store of `backend({ store })`, so a new backend instance attaches no key authorization", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const session = Session.from({
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      accessKey: createAccessKey({ chainId: 4217, owner }),
      user: { email: 'user@example.com', id: 'user_1' },
    })
    const address = KeyAuthorization.fromRpc(
      session.accessKey!.keyAuthorization,
    ).address
    const registration = {
      accessKey: address,
      address: session.accessKey!.account,
      chainId: 4217,
    }
    const name = `tempo-id:registered:${JSON.stringify([4217, session.accessKey!.account.toLowerCase(), address.toLowerCase()])}`
    // Each request of a Worker, or each replica, creates its own instance on the shared store.
    const create = () =>
      Accounts.create({
        chain: 4217,
        clientId: 'https://app.example.com',
        plugins: [backend({ store }), viem()],
        url: 'http://127.0.0.1:9',
      })
    const manager = (accounts: ReturnType<typeof create>) =>
      (accounts.viem({ session }).account as Account.AccessKeyAccount)
        .keyAuthorizationManager!

    // Viem removes the key authorization once the chain registered the access key, which marks it.
    await manager(create()).remove(registration)
    await expect.poll(() => store.getItem(name)).toBeDefined()
    const pending = await manager(create()).get(registration)

    expect(pending).toMatchInlineSnapshot(`undefined`)
  })

  test('deletes the registration mark at a sign-out after a write of it that the store holds in flight', async () => {
    const memory = Store.memory()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const written: Promise<void>[] = []
    // A remote store, such as Redis, can answer a write after a later deletion of the same entry.
    const store = Store.from({
      getItem: (key) => memory.getItem(key),
      removeItem: (key) => memory.removeItem(key),
      setItem(key, value, options) {
        const write = key.startsWith('tempo-id:registered:')
          ? gate.then(() => memory.setItem(key, value, options))
          : memory.setItem(key, value, options)
        written.push(write)
        return write
      },
    })
    const owner = Secp256k1.randomPrivateKey()
    const accessKey = createAccessKey({ chainId: 4217, owner })
    const address = KeyAuthorization.fromRpc(accessKey.keyAuthorization).address
    const name = `tempo-id:registered:${JSON.stringify([4217, accessKey.account.toLowerCase(), address.toLowerCase()])}`
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const { keyAuthorizationManager } = accounts.viem
      .account as Account.AccessKeyAccount
    await keyAuthorizationManager!.remove({
      accessKey: address,
      address: accessKey.account,
      chainId: 4217,
    })
    await accounts.signOut()

    release()
    await Promise.all(written)

    await expect.poll(() => memory.getItem(name)).toBeUndefined()
  })

  test("drops the registration mark of a saved session's access key that expired before the instance started", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const accessKey = createAccessKey({ chainId: 4217, expiry: -60, owner })
    const address = KeyAuthorization.fromRpc(accessKey.keyAuthorization).address
    const name = `tempo-id:registered:${JSON.stringify([4217, accessKey.account.toLowerCase(), address.toLowerCase()])}`
    await store.setItem(name, { expiresAt: Date.now() - 60_000 })
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })

    await accounts.session.get()

    await expect.poll(() => store.getItem(name)).toBeUndefined()
  })

  test("types `calls` on `sendTransaction`, and signs them as one transaction of the session's access key", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey: createAccessKey({ chainId: 4217, owner }),
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    // `tsc` checks the batch against `sendTransaction`, whose send reads the access key from a node.
    const batch = {
      calls: [
        { data: '0x01', to: '0x0000000000000000000000000000000000000001' },
        { data: '0x02', to: '0x0000000000000000000000000000000000000002' },
      ],
      gas: 100_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      nonce: 0,
    } satisfies Parameters<typeof accounts.sendTransaction>[0]
    // A transaction whose fields are all given fills nothing, so the signature sends no request.
    const signed = await accounts.viem.account.signTransaction({
      ...batch,
      chainId: 4217,
      type: 'tempo',
    } as never)

    expect(
      TxEnvelopeTempo.deserialize(signed as TxEnvelopeTempo.Serialized).calls,
    ).toMatchInlineSnapshot(`
        [
          {
            "data": "0x01",
            "to": "0x0000000000000000000000000000000000000001",
          },
          {
            "data": "0x02",
            "to": "0x0000000000000000000000000000000000000002",
          },
        ]
      `)
  })

  test("sends a payment of `pay` with the session's access key to the node, and opens no payment page", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            accessKey: createAccessKey({ chainId: 4217, owner }),
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    const error = await accounts
      .pay({
        amount: '5',
        memo: 'order-123',
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    // Outside a page, the payment page rejects with `PageRequiredError`, so the node's failure
    // shows that the access key sent the payment.
    expect({ name: error?.name, sent }).toMatchInlineSnapshot(`
      {
        "name": "ContractFunctionExecutionError",
        "sent": [
          "eth_fillTransaction",
          "eth_call",
        ],
      }
    `)
  })

  test("sends a payment of `pay` with a fixed session's access key on an instance without a session", async () => {
    const owner = Secp256k1.randomPrivateKey()
    const sent: string[] = []
    // A backend's instance, which holds no session of its own.
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const session = Session.from({
      accessKey: createAccessKey({ chainId: 4217, owner }),
      accessToken: 'access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: { email: 'user@example.com', id: 'user_1' },
    })

    const error = await accounts
      .pay({
        amount: '5',
        session,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    // The node's failure shows that the fixed session's access key sent the payment.
    expect({ name: error?.name, sent }).toMatchInlineSnapshot(`
      {
        "name": "ContractFunctionExecutionError",
        "sent": [
          "eth_fillTransaction",
          "eth_call",
        ],
      }
    `)
  })

  test("opens the payment page for a payment above the access key's limit, and sends nothing to the node", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            accessKey: createAccessKey({
              chainId: 4217,
              limits: [
                {
                  limit: 1_000_000n,
                  token: '0x20c0000000000000000000000000000000000000',
                },
              ],
              owner,
            }),
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const sent: string[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [
        viem({
          // Nothing listens at the URL, so the transport records each request that would reach a node.
          transport: http('http://127.0.0.1:9', {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as { method: string }
              sent.push(body.method)
            },
            retryCount: 0,
          }),
        }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    const error = await accounts
      .pay({
        amount: '5',
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .then(
        () => undefined,
        (error: Error) => error,
      )

    // The test runs outside a page, where the payment page rejects.
    expect({ name: error?.name, sent }).toMatchInlineSnapshot(`
      {
        "name": "Actions.account.PageRequiredError",
        "sent": [],
      }
    `)
  })

  test('writes no registration mark for a transaction that lands after its access key left the session', async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    const accessKey = createAccessKey({ chainId: 4217, owner })
    const address = KeyAuthorization.fromRpc(accessKey.keyAuthorization).address
    const name = `tempo-id:registered:${JSON.stringify([4217, accessKey.account.toLowerCase(), address.toLowerCase()])}`
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessKey,
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()
    const { keyAuthorizationManager } = accounts.viem
      .account as Account.AccessKeyAccount
    await accounts.signOut()

    // A transaction in flight at the sign-out lands, and Viem removes the authorization.
    await keyAuthorizationManager!.remove({
      accessKey: address,
      address: accessKey.account,
      chainId: 4217,
    })

    expect(await store.getItem(name)).toMatchInlineSnapshot(`undefined`)
  })

  test("reads the owner's account with the held access token while a refresh runs beside it, when the token holds for over 5 seconds", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: Session.from({
            accessKey: createAccessKey({ chainId: 4217, owner }),
            accessToken: 'access-token',
            expiresAt: Date.now() + 20_000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const requests: string[] = []
    let release = () => {}
    const answer = new Promise<void>((resolve) => {
      release = resolve
    })
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const { pathname } = new URL(request.url)
        requests.push(
          `${request.method} ${pathname} ${request.headers.get('authorization')}`,
        )
        if (pathname !== '/oauth2/token')
          return Response.json(
            { error: 'temporarily_unavailable' },
            { status: 503 },
          )
        // The token endpoint answers only after the poll, so a read that waits for the refresh
        // sends no request before then.
        await answer
        return Response.json({
          access_token: 'new-access-token',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
        })
      }) as typeof globalThis.fetch,
      plugins: [
        viem({ transport: http('http://127.0.0.1:9', { retryCount: 0 }) }),
      ],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    // The session's access key is on another chain, so the owner signs, and the signature reads
    // the account first.
    const signature = accounts.viem.account
      .signMessage({ message: 'hello' })
      .catch((error: unknown) => error)
    const sent = await expect
      .poll(() => requests.length)
      .toBe(2)
      .then(
        () => [...requests].sort(),
        () => [...requests].sort(),
      )
      .finally(release)
    await signature

    expect(sent).toMatchInlineSnapshot(`
      [
        "GET /v1/account Bearer access-token",
        "POST /oauth2/token null",
      ]
    `)
  })
})

describe('members', () => {
  test("keeps each action's helpers, such as `token.transfer.estimateGas`", () => {
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'https://app.example.com',
      plugins: [viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const helpers = Object.keys(accounts.token.transfer)

    expect(helpers).toEqual(Object.keys(accounts.viem.token.transfer))
    expect(helpers.length > 0).toMatchInlineSnapshot(`true`)
  })
})

describe('machines.hold', () => {
  test('holds the registration from a fill through its signature until a registration, a failure, or an expiry', () => {
    const [initial] = initialTransition(machines.hold)

    const filling = step(initial, { type: 'fill.start' })
    const filled = step(filling, { hold: 1, type: 'fill.done' })
    const sending = step(filled, { hold: 1, type: 'transaction.signed' })

    expect(
      [initial, filling, filled, sending].map((snapshot) => snapshot.value),
    ).toMatchInlineSnapshot(`
      [
        "free",
        "filling",
        "filled",
        "sending",
      ]
    `)
    expect(
      [
        step(filling, { hold: 1, type: 'fill.refused' }),
        step(filling, expiries.filling),
        step(filled, expiries.filled),
        step(sending, { type: 'registered' }),
        step(sending, { hold: 1, type: 'transaction.failed' }),
        step(sending, expiries.sending),
      ].map((snapshot) => snapshot.value),
    ).toMatchInlineSnapshot(`
      [
        "free",
        "free",
        "free",
        "free",
        "free",
        "free",
      ]
    `)
  })

  test('keeps the hold of a later fill at a result or a failed send of a fill whose hold expired', () => {
    const [initial] = initialTransition(machines.hold)

    const later = step(
      initial,
      { type: 'fill.start' },
      expiries.filling,
      { type: 'fill.start' },
      { hold: 1, type: 'fill.refused' },
      { hold: 1, type: 'fill.done' },
    )
    const refused = step(later, { hold: 2, type: 'fill.refused' })
    // A send of the first hold that fails after a second hold reached its send ends no hold.
    const sending = step(
      initial,
      { type: 'fill.start' },
      { hold: 1, type: 'fill.done' },
      { hold: 1, type: 'transaction.signed' },
      expiries.sending,
      { type: 'fill.start' },
      { hold: 2, type: 'fill.done' },
      { hold: 2, type: 'transaction.signed' },
      { hold: 1, type: 'transaction.failed' },
    )

    expect({
      later: [later.value, later.context.holds],
      refused: refused.value,
      sending: [sending.value, sending.context.holds],
    }).toMatchInlineSnapshot(`
      {
        "later": [
          "filling",
          2,
        ],
        "refused": "free",
        "sending": [
          "sending",
          2,
        ],
      }
    `)
  })

  test('starts one waiting fill at a time when the hold ends', async () => {
    const actor = createActor(machines.hold).start()
    actor.send({ type: 'fill.start' })
    const started: string[] = []
    const fill = async (name: string) => {
      while (!machines.free(actor.getSnapshot()))
        await waitFor(actor, machines.free)
      actor.send({ type: 'fill.start' })
      started.push(name)
    }

    const fills = [fill('a'), fill('b')]
    actor.send({ type: 'registered' })
    await expect.poll(() => started.length).toBe(1)
    const first = actor.getSnapshot().value
    actor.send({ hold: 2, type: 'fill.refused' })
    await Promise.all(fills)

    expect({ first, started }).toMatchInlineSnapshot(`
      {
        "first": "filling",
        "started": [
          "a",
          "b",
        ],
      }
    `)
    actor.stop()
  })

  test('reaches every state along its shortest paths, and handles every event type', () => {
    const snapshots = getShortestPaths(machines.hold, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map((snapshot) => snapshot.value))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "filled",
        "filling",
        "free",
        "sending",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
  })

  /** The events of the hold's expiries, which `after` sends in each state. */
  const expiries = {
    filled: { type: 'xstate.after.signLimit.hold.filled' },
    filling: { type: 'xstate.after.turnLimit.hold.filling' },
    sending: { type: 'xstate.after.turnLimit.hold.sending' },
  } as const

  /** A machine event, or the event of an expiry. */
  type Step = machines.hold.Event | (typeof expiries)[keyof typeof expiries]

  /** Returns the snapshot after `steps`, in order, from `snapshot`. */
  function step(snapshot: machines.hold.Snapshot, ...steps: readonly Step[]) {
    return steps.reduce(
      (current, event) =>
        // The expiries' events are not in `Event`, which the machine's types name, but the
        // machine handles them.
        getNextSnapshot(machines.hold, current, event as machines.hold.Event),
      snapshot,
    )
  }

  /** The events of each type that the runner sends from a snapshot. */
  const events: {
    [type in Step['type']]: (
      snapshot: machines.hold.Snapshot,
    ) => readonly Step[]
  } = {
    // The runner sends the result of the current hold, and of an earlier, expired one.
    'fill.done': (snapshot) =>
      snapshot.matches('filling')
        ? [
            { hold: snapshot.context.holds, type: 'fill.done' },
            { hold: snapshot.context.holds - 1, type: 'fill.done' },
          ]
        : [],
    'fill.refused': (snapshot) =>
      snapshot.matches('filling')
        ? [
            { hold: snapshot.context.holds, type: 'fill.refused' },
            { hold: snapshot.context.holds - 1, type: 'fill.refused' },
          ]
        : [],
    'fill.start': (snapshot) =>
      snapshot.matches('free') ? [{ type: 'fill.start' }] : [],
    registered: (snapshot) =>
      snapshot.matches('free') ? [] : [{ type: 'registered' }],
    'transaction.failed': (snapshot) =>
      snapshot.matches('sending')
        ? [
            { hold: snapshot.context.holds, type: 'transaction.failed' },
            { hold: snapshot.context.holds - 1, type: 'transaction.failed' },
          ]
        : [],
    'transaction.signed': (snapshot) =>
      snapshot.matches('filled')
        ? [{ hold: snapshot.context.holds, type: 'transaction.signed' }]
        : [],
    'xstate.after.signLimit.hold.filled': (snapshot) =>
      snapshot.matches('filled') ? [expiries.filled] : [],
    'xstate.after.turnLimit.hold.filling': (snapshot) =>
      snapshot.matches('filling') ? [expiries.filling] : [],
    'xstate.after.turnLimit.hold.sending': (snapshot) =>
      snapshot.matches('sending') ? [expiries.sending] : [],
  }

  /** The traversal of the machine's graph, keyed by the state. */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: machines.hold.Snapshot) =>
      Object.values(events).flatMap((fn) =>
        fn(snapshot),
      ) as readonly machines.hold.Event[],
    serializeState: (snapshot: machines.hold.Snapshot) =>
      JSON.stringify(snapshot.value),
  }
})

describe('machines.screen', () => {
  test('stays open while one of two calls waits, and closes at the last leave', () => {
    const [initial] = initialTransition(machines.screen)

    const two = step(initial, { type: 'call.join' }, { type: 'call.join' })
    const one = step(two, { type: 'call.leave' })
    const none = step(one, { type: 'call.leave' })

    expect(initial.value).toMatchInlineSnapshot(`"open"`)
    expect(two.context.waits).toMatchInlineSnapshot(`2`)
    expect(one.value).toMatchInlineSnapshot(`"open"`)
    expect(one.context.waits).toMatchInlineSnapshot(`1`)
    expect(machines.settled(one)).toMatchInlineSnapshot(`false`)
    expect(none.value).toMatchInlineSnapshot(`"abandoned"`)
    expect(machines.settled(none)).toMatchInlineSnapshot(`true`)
    expect(machines.resolved(none)).toMatchInlineSnapshot(`false`)
  })

  test('aborts the signal of the screen only once the last call leaves', () => {
    const { actor, signals } = start()
    actor.send({ type: 'call.join' })
    actor.send({ type: 'call.join' })

    actor.send({ type: 'call.leave' })
    const first = signals[0]?.aborted
    actor.send({ type: 'call.leave' })
    const last = signals[0]?.aborted

    expect(signals.length).toMatchInlineSnapshot(`1`)
    expect(first).toMatchInlineSnapshot(`false`)
    expect(last).toMatchInlineSnapshot(`true`)
    expect(actor.getSnapshot().value).toMatchInlineSnapshot(`"abandoned"`)
  })

  test('resolves for a call that stays after another call left', async () => {
    const { actor, gate } = start()
    actor.send({ type: 'call.join' })
    actor.send({ type: 'call.join' })
    actor.send({ type: 'call.leave' })

    gate.resolve()
    const snapshot = await waitFor(actor, machines.settled)

    expect(snapshot.value).toMatchInlineSnapshot(`"resolved"`)
    expect(machines.resolved(snapshot)).toMatchInlineSnapshot(`true`)
  })

  test('rejects with the error of the screen', async () => {
    const { actor, gate } = start()
    actor.send({ type: 'call.join' })

    gate.reject(new Error('The user closed the screen.'))
    const snapshot = await waitFor(actor, machines.settled)

    expect(snapshot.value).toMatchInlineSnapshot(`"rejected"`)
    expect(machines.resolved(snapshot)).toMatchInlineSnapshot(`false`)
    expect(snapshot.context.error).toMatchInlineSnapshot(
      `[Error: The user closed the screen.]`,
    )
  })

  test('reaches every state along its shortest paths, handles every event type, and counts no call in a screen that each call left', () => {
    const snapshots = getShortestPaths(machines.screen, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map((snapshot) => snapshot.value))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "abandoned",
        "open",
        "rejected",
        "resolved",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
    expect(
      snapshots
        .filter((snapshot) => snapshot.matches('abandoned'))
        .every((snapshot) => snapshot.context.waits === 0),
    ).toBe(true)
  })

  /** The event that the invoked screen sends when it resolves. */
  const done = { output: undefined, type: 'xstate.done.actor.show' } as const

  /** The event that the invoked screen sends when it rejects. */
  const failure = {
    error: new Error('The user closed the screen.'),
    type: 'xstate.error.actor.show',
  } as const

  /** A machine event, or an event that the machine's invoked screen sends. */
  type Step = machines.screen.Event | typeof done | typeof failure

  /** Returns the snapshot after `steps`, in order, from `snapshot`. */
  function step(snapshot: machines.screen.Snapshot, ...steps: readonly Step[]) {
    return steps.reduce(
      (current, event) =>
        // The invoked screen's events are not in `Event`, which the machine's types name, but the
        // machine handles them.
        getNextSnapshot(
          machines.screen,
          current,
          event as machines.screen.Event,
        ),
      snapshot,
    )
  }

  /**
   * The events of each type that the machine receives from a snapshot: its own, and those of its
   * invoked screen. A call leaves only while it waits, and the traversal joins at most two calls.
   */
  const events: {
    [type in Step['type']]: (
      snapshot: machines.screen.Snapshot,
    ) => readonly Step[]
  } = {
    'call.join': (snapshot) =>
      snapshot.context.waits < 2 ? [{ type: 'call.join' }] : [],
    'call.leave': (snapshot) =>
      snapshot.context.waits > 0 ? [{ type: 'call.leave' }] : [],
    'xstate.done.actor.show': () => [done],
    'xstate.error.actor.show': () => [failure],
  }

  /** The traversal of the machine's graph, keyed by the state and the count of calls that wait. */
  const traversal = {
    // The traversal's type names only `Event`, though the machine handles every `Step`.
    events: (snapshot: machines.screen.Snapshot) =>
      [
        ...events['call.join'](snapshot),
        ...events['call.leave'](snapshot),
        ...events['xstate.done.actor.show'](snapshot),
        ...events['xstate.error.actor.show'](snapshot),
      ] as readonly machines.screen.Event[],
    serializeState: (snapshot: machines.screen.Snapshot) =>
      JSON.stringify([snapshot.value, snapshot.context.waits]),
  }

  /**
   * Starts the machine with a screen that settles with `gate`, and records the signal of each
   * screen that it shows.
   */
  function start() {
    const gate = Promise.withResolvers<void>()
    const signals: AbortSignal[] = []
    const actor = createActor(
      machines.screen.provide({
        actors: {
          show: fromPromise<void>((args) => {
            signals.push(args.signal)
            return gate.promise
          }),
        },
      }),
    ).start()
    return { actor, gate, signals }
  }
})

/**
 * Returns an access key of the account of `options.owner` on `options.chainId`, with its private key,
 * that expires after `options.expiry` seconds.
 */
function createAccessKey(options: {
  chainId: number
  /** Seconds until the access key expires. Defaults to an hour. */
  expiry?: number | undefined
  /** The access key's token limits. Absent, the access key spends any amount. */
  limits?: readonly { limit: bigint; token: `0x${string}` }[] | undefined
  owner: `0x${string}`
}) {
  const privateKey = Secp256k1.randomPrivateKey()
  const authorization = KeyAuthorization.from({
    address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    chainId: BigInt(options.chainId),
    expiry: Math.floor(Date.now() / 1000) + (options.expiry ?? 3600),
    ...(options.limits ? { limits: options.limits } : {}),
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(authorization),
    privateKey: options.owner,
  })
  return {
    account: Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: options.owner }),
    ),
    chainId: options.chainId,
    keyAuthorization: KeyAuthorization.toRpc(
      KeyAuthorization.from(authorization, { signature }),
    ),
    privateKey,
  }
}

/** Sends a fill, which the relay transport sends to the relay route. */
function fill(accounts: ReturnType<typeof relayInstance>) {
  return accounts.viem.request({
    method: 'eth_fillTransaction',
    params: [{}],
  } as never)
}

/** Returns an instance whose `viem` plugin sends its fills to a relay route through `fetch`. */
function relayInstance(options: {
  fetch: typeof globalThis.fetch
  relay?: viem.Options['relay']
  store: Store.Store
}) {
  const { fetch, relay = 'https://app.example.com/relay', store } = options
  return Accounts.create({
    chain: 42431,
    clientId: 'https://app.example.com',
    fetch,
    plugins: [
      viem({
        relay,
        transport: http('http://127.0.0.1:9', { retryCount: 0 }),
      }),
    ],
    store,
    url: 'http://127.0.0.1:9',
  })
}

/** Returns a store that holds a session of `user_1` without a refresh token, which expires at `expiresAt`. */
async function sessionStore(options: { expiresAt?: number | undefined } = {}) {
  const store = Store.memory()
  await store.setItem(
    'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
    {
      state: {
        session: Session.from({
          accessToken: 'access-token',
          expiresAt: options.expiresAt ?? Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    },
  )
  return store
}

/** Returns a relay route that records the `Authorization` header of each request. */
function relayRoute() {
  const authorizations: (string | null)[] = []
  return {
    authorizations,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      authorizations.push(request.headers.get('authorization'))
      const body = (await request.json()) as { id: number }
      return Response.json({ id: body.id, jsonrpc: '2.0', result: {} })
    }) as typeof globalThis.fetch,
  }
}
