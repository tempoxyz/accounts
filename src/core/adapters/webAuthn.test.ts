import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Authenticator from '../../../test/authenticator.js'
import { chain } from '../../../test/config.js'
import { webAuthn as handler_webAuthn } from '../../server/internal/handlers/webAuthn.js'
import * as Kv from '../../server/Kv.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import { webAuthn } from './webAuthn.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webAuthn', () => {
  test('behavior: does not hydrate account without credential', async () => {
    const storage = Storage.memory({ key: 'webauthn-invalid-account' })
    storage.setItem('store', {
      state: {
        accounts: [
          {
            address: '0x0000000000000000000000000000000000000001',
            keyType: 'webAuthn',
          },
        ],
        activeAccount: 0,
        chainId: chain.id,
      },
      version: 0,
    })
    const provider = Provider.create({ adapter: webAuthn(), chains: [chain], storage })

    await Store.waitForHydration(provider.store)

    await expect(provider.request({ method: 'eth_accounts' })).resolves.toMatchInlineSnapshot(`[]`)
  })
})

describe('sign-up userId', () => {
  test('behavior: a custom ceremony gets a random userId for each sign-up', async () => {
    const authenticator = Authenticator.create({ origin: 'http://localhost', rpId: 'localhost' })
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        location: { hostname: 'localhost', origin: 'http://localhost' },
        navigator: { credentials: authenticator.credentials },
      }),
    )
    const userIds: (string | undefined)[] = []
    const local = WebAuthnCeremony.local({ rpId: 'localhost', storage: Storage.memory() })
    const ceremony = WebAuthnCeremony.from({
      ...local,
      getRegistrationOptions(parameters) {
        userIds.push(parameters.userId)
        return local.getRegistrationOptions(parameters)
      },
    })
    const provider = Provider.create({
      adapter: webAuthn({ ceremony }),
      chains: [chain],
      storage: Storage.memory(),
    })

    for (let i = 0; i < 2; i++)
      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })

    expect({
      distinct: new Set(userIds).size,
      types: userIds.map((userId) => typeof userId),
    }).toMatchInlineSnapshot(`
      {
        "distinct": 2,
        "types": [
          "string",
          "string",
        ],
      }
    `)
  })
})

describe('prefetched challenges', () => {
  const origin = 'http://localhost'

  /** Provider whose server ceremony runs against an in-process `Handler.webAuthn`. */
  function setup() {
    const authenticator = Authenticator.create({ origin, rpId: 'localhost' })
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        location: { hostname: 'localhost', origin },
        navigator: { credentials: authenticator.credentials },
      }),
    )
    const names: string[] = []
    const handler = handler_webAuthn({
      kv: Kv.memory(),
      onRegister: ({ name }) => void names.push(name),
      origin,
      path: '/webauthn',
      rpId: 'localhost',
      session: false,
    })
    const requests: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const body = request.method === 'POST' ? await request.clone().text() : ''
      const { challenge } = JSON.parse(body || '{}') as { challenge?: string }
      requests.push(`${new URL(request.url).pathname}${challenge ? ' (challenge)' : ''}`)
      return handler.fetch(request)
    })
    const ceremony = WebAuthnCeremony.server({ url: `${origin}/webauthn` })
    const provider = Provider.create({
      adapter: webAuthn({ ceremony }),
      chains: [chain],
      storage: Storage.memory(),
    })
    return { ceremony, names, provider, requests }
  }

  test('behavior: signs up and logs in with challenges issued ahead of time', async () => {
    const { ceremony, names, provider, requests } = setup()
    ceremony.prefetch!()
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve))

    const { accounts } = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'alice' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })
    await new Promise((resolve) => setTimeout(resolve))
    // A known passkey: the login builds its options from the prefetched challenge.
    const login = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect({
      address: login.accounts[0]!.address === accounts[0]!.address,
      names,
      requests,
    }).toMatchInlineSnapshot(`
      {
        "address": true,
        "names": [
          "alice",
        ],
        "requests": [
          "/webauthn/login/options",
          "/webauthn/register/options",
          "/webauthn/register/options",
          "/webauthn/register",
          "/webauthn/logout",
          "/webauthn/login/options",
          "/webauthn/login",
        ],
      }
    `)
  })
})

describe('deferred login', () => {
  const origin = 'http://localhost'

  /**
   * Provider whose deferred ceremony runs against an in-process
   * `Handler.webAuthn`. `/login` requests wait for `release`, and answer
   * `refuse`'s error instead when it's set. With `unavailable` set, they fail
   * at once with a 503.
   */
  function setup() {
    const authenticator = Authenticator.create({ origin, rpId: 'localhost' })
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        location: { hostname: 'localhost', origin },
        navigator: { credentials: authenticator.credentials },
      }),
    )
    const handler = handler_webAuthn({
      kv: Kv.memory(),
      origin,
      path: '/webauthn',
      rpId: 'localhost',
      session: false,
    })
    const events: string[] = []
    const gate = {
      refuse: undefined as string | undefined,
      release: () => {},
      unavailable: false,
    }
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      if (path === '/webauthn/logout') events.push('logout')
      if (path === '/webauthn/register') events.push('register sent')
      if (path === '/webauthn/login') {
        events.push('login sent')
        if (gate.unavailable) return Response.json({}, { status: 503 })
        await new Promise<void>((resolve) => (gate.release = resolve))
        events.push('login answered')
        if (gate.refuse) return Response.json({ error: gate.refuse }, { status: 400 })
      }
      return handler.fetch(request)
    })
    const provider = Provider.create({
      adapter: webAuthn({ ceremony: WebAuthnCeremony.deferred({ url: `${origin}/webauthn` }) }),
      chains: [chain],
      storage: Storage.memory(),
    })
    return { events, gate, provider }
  }

  /** Signs up, so the next connect logs in with a known passkey. */
  async function signUp(provider: ReturnType<typeof setup>['provider']) {
    const { accounts } = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'alice' } }],
    })
    return accounts[0]!.address
  }

  test('behavior: answers a login with a known passkey before the server verifies it', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    const login = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    events.push('connected')
    // A disconnect waits for the login to land, so it ends that login's session.
    const disconnected = provider
      .request({ method: 'wallet_disconnect' })
      .then(() => void events.push('disconnected'))
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await disconnected

    expect({ address: login.accounts[0]!.address === address, events }).toMatchInlineSnapshot(`
      {
        "address": true,
        "events": [
          "register sent",
          "login sent",
          "connected",
          "login answered",
          "logout",
          "disconnected",
        ],
      }
    `)
  })

  test('behavior: drops the account and ends the session when the server refuses the login', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    const changed = new Promise<readonly string[]>((resolve) =>
      provider.on('accountsChanged', resolve),
    )
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    gate.refuse = 'Unknown credential'
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()

    expect({
      accounts: (await changed).includes(address),
      events,
    }).toMatchInlineSnapshot(`
      {
        "accounts": false,
        "events": [
          "register sent",
          "login sent",
          "login answered",
          "logout",
        ],
      }
    `)
  })
  test('behavior: keeps the account and ends the session when the login fails in transit', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    gate.unavailable = true
    events.length = 0
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(events).toContain('logout'), { timeout: 5_000 })

    expect({
      accounts: (await provider.request({ method: 'eth_accounts' })).includes(address),
      events,
    }).toMatchInlineSnapshot(`
      {
        "accounts": true,
        "events": [
          "login sent",
          "login sent",
          "login sent",
          "logout",
        ],
      }
    `)
  })

  test('behavior: a sign-up waits for a login still verifying', async () => {
    const { events, gate, provider } = setup()
    await signUp(provider)

    events.length = 0
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    const registered = provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'bob' } }],
    })
    await vi.waitFor(() => expect(events).toContain('login sent'))
    // Gives the sign-up time to send `/register`, if it didn't wait.
    await new Promise((resolve) => setTimeout(resolve, 50))
    events.push('released')
    gate.release()
    await registered
    await vi.waitFor(() => expect(events).toContain('register sent'))

    expect(events).toMatchInlineSnapshot(`
      [
        "login sent",
        "released",
        "login answered",
        "register sent",
      ]
    `)
  })

  test("behavior: doesn't report the passkey's name as the login's username", async () => {
    const { gate, provider } = setup()
    await signUp(provider)

    const login = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    gate.release()

    expect(login.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
  })
})

describe('background registration', () => {
  const origin = 'http://localhost'

  /**
   * Provider with a local ceremony that verifies registrations in the
   * background, settled by the test through `verifications`.
   */
  function setup(
    options: {
      authenticator?: ReturnType<typeof Authenticator.create> | undefined
      logout?: (() => Promise<void>) | undefined
      reject?: Error | undefined
      storage?: Storage.Storage | undefined
    } = {},
  ) {
    const authenticator =
      options.authenticator ?? Authenticator.create({ origin, rpId: 'localhost' })
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        location: { hostname: 'localhost', origin },
        navigator: { credentials: authenticator.credentials },
      }),
    )
    const storage = options.storage ?? Storage.memory()
    const local = WebAuthnCeremony.local({ rpId: 'localhost', storage })
    const logins = vi.fn()
    const verifications: { reject: (error: Error) => void; resolve: () => void }[] = []
    const cancelled: string[] = []
    const ceremony = WebAuthnCeremony.from({
      ...local,
      async verifyRegistration(credential, parameters) {
        const result = await local.verifyRegistration(credential, parameters)
        const verified = options.reject
          ? Promise.reject(options.reject)
          : new Promise<{ session: boolean }>((resolve, reject) => {
              parameters?.signal?.addEventListener('abort', () => {
                cancelled.push(credential.id)
                reject(parameters.signal!.reason)
              })
              verifications.push({ reject, resolve: () => resolve({ session: true }) })
            })
        return { ...result, verified }
      },
      async verifyAuthentication(response) {
        logins()
        return local.verifyAuthentication(response)
      },
      ...(options.logout ? { logout: options.logout } : {}),
    })
    const provider = Provider.create({
      adapter: webAuthn({ ceremony }),
      chains: [chain],
      storage,
    })
    return { authenticator, cancelled, logins, provider, storage, verifications }
  }

  async function register(provider: ReturnType<typeof setup>['provider'], name = 'alice') {
    const { accounts } = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name } }],
    })
    return { address: accounts[0]!.address }
  }

  function credentialOf(provider: ReturnType<typeof setup>['provider']) {
    const [account] = provider.store.getState().accounts
    return account && 'credential' in account ? account.credential : undefined
  }

  test('behavior: connects before the server stores the credential', async () => {
    const { provider, verifications } = setup()

    const account = await register(provider)

    // Connected while the server verification is still pending.
    expect(verifications).toHaveLength(1)
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])

    verifications[0]!.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])
  })

  test('behavior: a login waits for a pending registration', async () => {
    const { provider, verifications } = setup()
    const account = await register(provider)
    const events: string[] = []

    const login = provider
      .request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login', selectAccount: true } }],
      })
      .then(() => events.push('login'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    events.push('verified')
    verifications[0]!.resolve()
    await login

    expect(events).toMatchInlineSnapshot(`
      [
        "verified",
        "login",
      ]
    `)
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])
  })

  test('behavior: removes the account when the server rejects the registration', async () => {
    const { provider, storage, verifications } = setup()
    await storage.setItem('lastCredentialId', 'previous')

    await register(provider)
    const [stored] = provider.store.getState().accounts
    const id = stored && 'credential' in stored ? stored.credential?.id : undefined
    verifications[0]!.reject(new Error('Missing or expired challenge'))

    await vi.waitFor(async () =>
      expect(await provider.request({ method: 'eth_accounts' })).toEqual([]),
    )
    // Its public key stays on the device, and the next sign-in targets the
    // credential used before.
    expect(Object.keys((await storage.getItem<object>(`registration:${id}`)) ?? {}).sort())
      .toMatchInlineSnapshot(`
        [
          "name",
          "publicKey",
        ]
      `)
    expect(await storage.getItem('lastCredentialId')).toMatchInlineSnapshot(`"previous"`)
  })

  test('error: fails a sign-up rejected before it answers', async () => {
    const { provider } = setup({ reject: new Error('Authenticator not allowed') })

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: { method: 'register', name: 'alice', digest: `0x${'1'.repeat(64)}` },
          } as never,
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InternalError: Authenticator not allowed]`,
    )
    expect(provider.store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: a late rejection emits accountsChanged', async () => {
    const { provider, verifications } = setup()
    await register(provider)
    // A SIWE session started by the same connect.
    provider.store.setState({ auth: { logout: 'https://app.example/auth/logout' } })
    const events: unknown[] = []
    provider.on('accountsChanged', (accounts) => events.push(accounts))

    verifications[0]!.reject(new Error('Missing or expired challenge'))

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events).toMatchInlineSnapshot(`
      [
        [],
      ]
    `)
    // Kept, so `wallet_disconnect` still ends that session.
    expect(provider.store.getState().auth).toMatchInlineSnapshot(`
      {
        "logout": "https://app.example/auth/logout",
      }
    `)
  })

  test('behavior: a login with a rejected credential restores its account', async () => {
    const { provider, verifications } = setup()
    const account = await register(provider)
    const id = credentialOf(provider)?.id
    // Every response was lost although the server stored the credential.
    verifications[0]!.reject(new TypeError('Failed to fetch'))
    await vi.waitFor(async () =>
      expect(await provider.request({ method: 'eth_accounts' })).toEqual([]),
    )

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', credentialId: id } as never }],
    })

    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])
  })

  test('behavior: drops access keys stored after the rejection', async () => {
    const { provider, verifications } = setup()
    const account = await register(provider)
    verifications[0]!.reject(new Error('Missing or expired challenge'))
    await vi.waitFor(async () =>
      expect(await provider.request({ method: 'eth_accounts' })).toEqual([]),
    )

    // e.g. a sign-up's access key saved after its account was already dropped.
    provider.store.setState({
      accessKeys: [
        {
          access: account.address,
          address: '0x0000000000000000000000000000000000000002',
          chainId: chain.id,
          keyType: 'p256',
        },
      ],
    })

    await vi.waitFor(() => expect(provider.store.getState().accessKeys).toHaveLength(0))
    const { accessKeys, accounts } = provider.store.getState()
    expect({ accessKeys, accounts }).toMatchInlineSnapshot(`
      {
        "accessKeys": [],
        "accounts": [],
      }
    `)
  })

  test('behavior: a sign-up waits for a registration still verifying, so it owns the session', async () => {
    const { logins, provider, verifications } = setup()
    await register(provider, 'alice')
    const bob = register(provider, 'bob')
    // Bob's registration isn't sent while alice's may still set the session.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(verifications.length).toMatchInlineSnapshot(`1`)
    verifications[0]!.resolve()
    await bob
    verifications[1]!.resolve()
    const id = credentialOf(provider)?.id

    await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: { method: 'login', credentialId: id, digest: `0x${'1'.repeat(64)}` },
        } as never,
      ],
    })

    // Bob's registration set the session last, so the login takes its shortcut.
    expect(logins).toHaveBeenCalledTimes(0)
  })

  test('behavior: signs a digest with the latest registration without waiting for it', async () => {
    const { cancelled, logins, provider, verifications } = setup()
    await register(provider)
    const id = credentialOf(provider)?.id

    // Its verification never answers, so a wait would hang the connect.
    const { accounts } = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: { method: 'login', credentialId: id, digest: `0x${'1'.repeat(64)}` },
        } as never,
      ],
    })

    expect({
      cancelled: cancelled.length,
      logins: logins.mock.calls.length,
      signed: !!accounts[0]!.capabilities.signature,
      verifications: verifications.length,
    }).toMatchInlineSnapshot(`
      {
        "cancelled": 0,
        "logins": 0,
        "signed": true,
        "verifications": 1,
      }
    `)
  })

  test('behavior: keeps an account whose page closed before the server answered', async () => {
    // A popup closes as soon as it answers, so its verification never settles here.
    const storage = Storage.memory()
    const first = setup({ storage })
    const account = await register(first.provider)

    const { provider } = setup({ authenticator: first.authenticator, storage })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])
  })

  test('behavior: keeps the active account when another one is dropped', async () => {
    const { provider, verifications } = setup()
    await register(provider, 'alice')
    verifications[0]!.resolve()
    await register(provider, 'bob')
    verifications[1]!.resolve()
    const carol = await register(provider, 'carol')
    // The host selected a surviving account other than the first one while
    // carol's registration was verifying.
    const { accounts } = provider.store.getState()
    const survivors = accounts.filter((account) => account.address !== carol.address)
    const selected = survivors[1]!.address
    provider.store.setState({
      activeAccount: accounts.findIndex((account) => account.address === selected),
    })

    verifications[2]!.reject(new Error('Missing or expired challenge'))

    await vi.waitFor(() => expect(provider.store.getState().accounts).toHaveLength(2))
    const { activeAccount, accounts: kept } = provider.store.getState()
    expect(kept[activeAccount]?.address).toBe(selected)
  })

  test('behavior: does not restore a rejected credential as the last used', async () => {
    const { provider, storage, verifications } = setup()
    await register(provider, 'alice')
    const bob = register(provider, 'bob')

    // Bob's registration recorded alice's credential as the one used before.
    verifications[0]!.reject(new Error('Missing or expired challenge'))
    await bob
    verifications[1]!.reject(new Error('Missing or expired challenge'))

    await vi.waitFor(async () =>
      expect(await provider.request({ method: 'eth_accounts' })).toEqual([]),
    )
    expect(await storage.getItem('lastCredentialId')).toMatchInlineSnapshot(`null`)
  })

  test('behavior: a login waits at most 10 s for a slow registration, then cancels it', async () => {
    const { cancelled, logins, provider } = setup()
    const account = await register(provider)
    const id = credentialOf(provider)?.id
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    // The registration never answers; the login goes through the server.
    const login = provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', credentialId: id } as never }],
    })
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
    const { accounts } = await login

    expect(accounts[0]!.address).toBe(account.address)
    expect(logins).toHaveBeenCalledTimes(1)
    // Cancelled, so it can't replace the login's session later.
    expect(cancelled).toEqual([id])
  })

  test('behavior: a disconnect cancels a slow registration and keeps later sessions', async () => {
    const logout = vi.fn(async () => {})
    const { cancelled, provider } = setup({ logout })
    await register(provider)
    const id = credentialOf(provider)?.id
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const disconnect = provider.request({ method: 'wallet_disconnect' })
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
    await disconnect
    expect(cancelled).toEqual([id])

    // A sign-up after the disconnect keeps its session: nothing logs out late.
    await register(provider, 'bob')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(await provider.request({ method: 'eth_accounts' })).toHaveLength(1)
  })

  test('behavior: disconnect ends the ceremony session', async () => {
    const logout = vi.fn(async () => {})
    const { provider, verifications } = setup({ logout })
    await register(provider)
    verifications[0]!.resolve()

    await provider.request({ method: 'wallet_disconnect' })

    expect(logout).toHaveBeenCalledTimes(1)
  })
})
