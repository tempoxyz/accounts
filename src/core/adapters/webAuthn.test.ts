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
      unavailable_logout: false,
      /** When set, `/register` requests wait for it. */
      register: undefined as Promise<void> | undefined,
      /** When set, `/register` requests are refused with it. */
      refuse_register: undefined as string | undefined,
      /** When set, `/logout` requests wait until they're aborted or `release_logout` is called. */
      hold_logout: false,
      release_logout: () => {},
      /** When set, `/logout` requests are answered with this status. */
      logout_status: undefined as number | undefined,
      /** When set, `/register` requests are stored, but answered with it. */
      lose_register: undefined as string | undefined,
    }
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      if (path === '/webauthn/logout') {
        events.push('logout')
        if (gate.unavailable_logout) return Response.json({}, { status: 503 })
        if (gate.logout_status) return Response.json({}, { status: gate.logout_status })
        if (gate.hold_logout)
          await new Promise<void>((resolve, reject) => {
            gate.release_logout = resolve
            const signal = init?.signal
            signal?.addEventListener('abort', () => {
              events.push('logout aborted')
              reject(signal.reason)
            })
          })
      }
      if (path === '/webauthn/register') {
        events.push('register sent')
        if (gate.register) {
          await gate.register
          events.push('register answered')
        }
        if (gate.refuse_register)
          return Response.json({ error: gate.refuse_register }, { status: 400 })
        if (gate.lose_register) {
          await handler.fetch(request)
          return Response.json({ error: gate.lose_register }, { status: 400 })
        }
      }
      if (path === '/webauthn/login') {
        events.push('login sent')
        if (gate.unavailable) return Response.json({}, { status: 503 })
        await new Promise<void>((resolve) => (gate.release = resolve))
        events.push('login answered')
        if (gate.refuse) return Response.json({ error: gate.refuse }, { status: 400 })
      }
      return handler.fetch(request)
    })
    const storage = Storage.memory()
    const provider = Provider.create({
      adapter: webAuthn({ ceremony: WebAuthnCeremony.deferred({ url: `${origin}/webauthn` }) }),
      chains: [chain],
      storage,
    })
    return { authenticator, events, gate, provider, storage }
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
  test('behavior: cancels the logout of a refused login for a later login', async () => {
    const { events, gate, provider } = setup()
    await signUp(provider)

    events.length = 0
    gate.hold_logout = true
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    gate.refuse = 'Unknown credential'
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await vi.waitFor(() => expect(events).toContain('logout'))

    // The next login waits for the refused one, then cancels its logout, so that logout can't
    // land after the next login and end its session.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const next = provider
      .request({ method: 'wallet_connect', params: [{ capabilities: { method: 'login' } }] })
      .catch(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(events).toContain('logout aborted'))
    await next

    expect(events.slice(0, 4)).toMatchInlineSnapshot(`
      [
        "login sent",
        "login answered",
        "logout",
        "logout aborted",
      ]
    `)
  })

  test('behavior: settles a login whose logout is cancelled mid-request at once', async () => {
    const { events, gate, provider } = setup()
    await signUp(provider)

    gate.unavailable = true
    gate.hold_logout = true
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(events).toContain('logout'), { timeout: 5_000 })

    // A disconnect waits up to 10 s for that login, then cancels its logout mid-request.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    gate.hold_logout = false
    await Promise.all([
      provider.request({ method: 'wallet_disconnect' }),
      vi.advanceTimersByTimeAsync(10_000),
    ])
    // The cancelled login no longer holds a later disconnect.
    let done = false
    const disconnected = provider
      .request({ method: 'wallet_disconnect' })
      .then(() => void (done = true))
    await vi.advanceTimersByTimeAsync(100)
    vi.useRealTimers()
    await disconnected

    expect({ aborted: events.includes('logout aborted'), done }).toMatchInlineSnapshot(`
      {
        "aborted": true,
        "done": true,
      }
    `)
  })

  test('behavior: settles a login whose logout keeps answering with an error', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    // A logout route that requires a session answers 401 once the login failed.
    gate.unavailable = true
    gate.logout_status = 401
    events.length = 0
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(events).toContain('logout'), { timeout: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect({
      accounts: (await provider.request({ method: 'eth_accounts' })).includes(address),
      logouts: events.filter((event) => event === 'logout').length,
    }).toMatchInlineSnapshot(`
      {
        "accounts": true,
        "logouts": 1,
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

  test('behavior: retries the logout after a failed login until it ends the session', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    gate.unavailable = true
    gate.unavailable_logout = true
    events.length = 0
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    // The logout fails twice, then goes through.
    await vi.waitFor(() => expect(events.filter((event) => event === 'logout').length).toBe(2), {
      timeout: 5_000,
    })
    gate.unavailable_logout = false
    await vi.waitFor(() => expect(events.filter((event) => event === 'logout').length).toBe(3), {
      timeout: 5_000,
    })
    // Lets `track` settle.
    await new Promise((resolve) => setTimeout(resolve, 10))

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
          "logout",
          "logout",
        ],
      }
    `)
  })

  test('behavior: keeps the account when the login fails for a reason other than the credential', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    events.length = 0
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    gate.refuse = 'Missing or expired challenge'
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await vi.waitFor(() => expect(events).toContain('logout'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect({
      accounts: (await provider.request({ method: 'eth_accounts' })).includes(address),
      events,
    }).toMatchInlineSnapshot(`
      {
        "accounts": true,
        "events": [
          "login sent",
          "login answered",
          "logout",
        ],
      }
    `)
  })

  test('behavior: answers a login before an earlier sign-up lands, and sends it after', async () => {
    const { events, gate, provider } = setup()
    let land = () => {}
    gate.register = new Promise<void>((resolve) => (land = resolve))
    await signUp(provider)

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    events.push('connected')
    await new Promise((resolve) => setTimeout(resolve, 20))
    land()
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()

    expect(events).toMatchInlineSnapshot(`
      [
        "register sent",
        "connected",
        "register answered",
        "login sent",
      ]
    `)
  })

  test('behavior: answers a sign-up before an earlier one lands, and sends it after', async () => {
    const { events, provider } = setup()
    let land = () => {}
    const gate_first = new Promise<void>((resolve) => (land = resolve))
    // Only the first `/register` is held.
    let held = false
    const fetch_ = globalThis.fetch
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const path = new URL(new Request(input, init).url).pathname
      if (path === '/webauthn/register' && !held) {
        held = true
        events.push('first sent')
        await gate_first
        events.push('first answered')
      }
      return fetch_(input, init)
    })

    await signUp(provider)
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'bob' } }],
    })
    events.push('second connected')
    await new Promise((resolve) => setTimeout(resolve, 20))
    land()
    await vi.waitFor(() => expect(events.filter((e) => e === 'register sent').length).toBe(2))

    expect(events).toMatchInlineSnapshot(`
      [
        "first sent",
        "second connected",
        "first answered",
        "register sent",
        "register sent",
      ]
    `)
  })

  test('behavior: keeps an account whose sign-up looked refused once its login lands', async () => {
    const { authenticator, events, gate, provider } = setup()
    let land = () => {}
    gate.register = new Promise<void>((resolve) => (land = resolve))
    gate.lose_register = 'Missing or expired challenge'
    const address = await signUp(provider)

    // The sign-up looks refused while the login's passkey prompt is open, though the server
    // stored it.
    const get = authenticator.credentials.get.bind(authenticator.credentials)
    authenticator.credentials.get = async (options) => {
      land()
      await vi.waitFor(() => expect(events).toContain('register answered'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      return get(options)
    }
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const connected = (await provider.request({ method: 'eth_accounts' })).includes(address)
    // The server stored the passkey after all, so the login lands with a session.
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await vi.waitFor(() => expect(events).toContain('login answered'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect({
      connected,
      landed: (await provider.request({ method: 'eth_accounts' })).includes(address),
    }).toMatchInlineSnapshot(`
      {
        "connected": true,
        "landed": true,
      }
    `)
  })

  test("behavior: a stale login's unknown outcome doesn't drop a later login's account", async () => {
    const { authenticator, events, gate, provider } = setup()
    let land = () => {}
    gate.register = new Promise<void>((resolve) => (land = resolve))
    gate.refuse_register = 'Missing or expired challenge'
    const address = await signUp(provider)

    // The sign-up is refused while the first login's passkey prompt is open.
    const get = authenticator.credentials.get.bind(authenticator.credentials)
    authenticator.credentials.get = async (options) => {
      authenticator.credentials.get = get
      land()
      await vi.waitFor(() => expect(events).toContain('register answered'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      return get(options)
    }
    // Its outcome stays unknown while its logout is held.
    gate.unavailable = true
    gate.hold_logout = true
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(events).toContain('logout'), { timeout: 5_000 })

    // A second login with the passkey, which the server knows after all.
    gate.unavailable = false
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    // The first login settles without a session.
    gate.release_logout()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const settled = (await provider.request({ method: 'eth_accounts' })).includes(address)

    expect({ settled }).toMatchInlineSnapshot(`
      {
        "settled": true,
      }
    `)
  })

  test('behavior: restores an account a late registration refusal dropped once its login lands', async () => {
    const { events, gate, provider, storage } = setup()
    let land = () => {}
    gate.register = new Promise<void>((resolve) => (land = resolve))
    // The server stores the passkey, but its answer is lost.
    gate.lose_register = 'Missing or expired challenge'
    const address = await signUp(provider)

    // The login is answered before the registration's refusal arrives, and sent after it.
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    const dropped = new Promise<readonly string[]>((resolve) =>
      provider.on('accountsChanged', resolve),
    )
    land()
    const during = (await dropped).includes(address)
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await vi.waitFor(() => expect(events).toContain('login answered'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    // It's restored as the active account and the last used credential, as its connect left them.
    const [account] = provider.store.getState().accounts
    expect({
      active: (await provider.request({ method: 'eth_accounts' }))[0] === address,
      during,
      last:
        account && 'credential' in account
          ? (await storage.getItem('lastCredentialId')) === account.credential?.id
          : false,
    }).toMatchInlineSnapshot(`
      {
        "active": true,
        "during": false,
        "last": true,
      }
    `)
  })

  test("behavior: a login after a disconnect doesn't restore what a refusal dropped", async () => {
    const { events, gate, provider } = setup()
    let land = () => {}
    gate.register = new Promise<void>((resolve) => (land = resolve))
    gate.lose_register = 'Missing or expired challenge'
    const address = await signUp(provider)
    // e.g. the sign-up's access key.
    provider.store.setState({
      accessKeys: [
        {
          access: address,
          address: '0x0000000000000000000000000000000000000002',
          chainId: chain.id,
          keyType: 'p256',
        },
      ],
    })
    const dropped = new Promise<void>((resolve) => provider.on('accountsChanged', () => resolve()))
    land()
    await dropped
    await provider.request({ method: 'wallet_disconnect' })

    // The server knows the passkey, so the login succeeds.
    events.length = 0
    const connected = provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await connected
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: drops a refused login whose logout is cancelled', async () => {
    const { events, gate, provider } = setup()
    const address = await signUp(provider)

    gate.hold_logout = true
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    gate.refuse = 'Unknown credential'
    await vi.waitFor(() => expect(events).toContain('login sent'))
    gate.release()
    await vi.waitFor(() => expect(events).toContain('logout'))
    const [stored] = provider.store.getState().accounts

    // A sign-up waits up to 10 s for the refused login, then cancels its logout.
    gate.hold_logout = false
    gate.refuse = undefined
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'bob' } }],
    })
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(events).toContain('logout aborted'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The refusal still stands: the refused account is dropped whenever it shows up again.
    provider.store.setState({ accounts: [stored!, ...provider.store.getState().accounts] })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(
      (await provider.request({ method: 'eth_accounts' })).includes(address),
    ).toMatchInlineSnapshot(`false`)
  })

  test('behavior: keeps a refused sign-up dropped when its login has an unknown outcome', async () => {
    const { authenticator, events, gate, provider, storage } = setup()
    let land = () => {}
    gate.register = new Promise<void>((resolve) => (land = resolve))
    gate.refuse_register = 'Missing or expired challenge'
    const address = await signUp(provider)

    // The sign-up is refused while the login's passkey prompt is open, and the login's own
    // outcome stays unknown.
    const get = authenticator.credentials.get.bind(authenticator.credentials)
    authenticator.credentials.get = async (options) => {
      land()
      await vi.waitFor(() => expect(events).toContain('register answered'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      return get(options)
    }
    gate.unavailable = true
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await vi.waitFor(() => expect(events).toContain('logout'), { timeout: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Nor does a later login target the dropped passkey by default.
    expect({
      accounts: (await provider.request({ method: 'eth_accounts' })).includes(address),
      last: await storage.getItem('lastCredentialId'),
    }).toMatchInlineSnapshot(`
      {
        "accounts": false,
        "last": null,
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
        // Like a server ceremony: the registration is sent once `ready` resolves.
        const verified = options.reject
          ? Promise.reject(options.reject)
          : (async () => {
              await parameters?.ready
              return new Promise<{ session: boolean }>((resolve, reject) => {
                parameters?.signal?.addEventListener('abort', () => {
                  cancelled.push(credential.id)
                  reject(parameters.signal!.reason)
                })
                verifications.push({ reject, resolve: () => resolve({ session: true }) })
              })
            })()
        return { ...result, verified }
      },
      // Like a server ceremony: the login is sent once `ready` resolves.
      async verifyAuthentication(response, parameters) {
        await parameters?.ready
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

  test('behavior: a sign-up answers at once, but its registration waits for one still verifying', async () => {
    const { logins, provider, verifications } = setup()
    await register(provider, 'alice')
    await register(provider, 'bob')
    // Bob's registration isn't sent while alice's may still set the session.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(verifications.length).toMatchInlineSnapshot(`1`)
    verifications[0]!.resolve()
    await vi.waitFor(() => expect(verifications.length).toBe(2))
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

  test('behavior: fails a digest signed while its registration was refused', async () => {
    const { authenticator, provider, verifications } = setup()
    await register(provider)
    const id = credentialOf(provider)?.id
    // The registration is refused while the signature prompt is open.
    const get = authenticator.credentials.get.bind(authenticator.credentials)
    authenticator.credentials.get = async (options) => {
      verifications[0]!.reject(new Error('Missing or expired challenge'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      return get(options)
    }

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: { method: 'login', credentialId: id, digest: `0x${'1'.repeat(64)}` },
          } as never,
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InternalError: The server refused to store the passkey.]`,
    )
  })

  test('behavior: waits for a stale registration before its login', async () => {
    const { logins, provider, verifications } = setup()
    await register(provider)
    const id = credentialOf(provider)?.id
    // Past the registration shortcut's 5 min, so the digest takes a server login.
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000)

    const login = provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: { method: 'login', credentialId: id, digest: `0x${'1'.repeat(64)}` },
        } as never,
      ],
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const waited = logins.mock.calls.length === 0
    verifications[0]!.resolve()
    await login
    clock.mockRestore()

    expect({ logins: logins.mock.calls.length, waited }).toMatchInlineSnapshot(`
      {
        "logins": 1,
        "waited": true,
      }
    `)
  })

  test("behavior: a sign-up whose passkey prompt fails doesn't cancel earlier verifications", async () => {
    const { authenticator, cancelled, provider } = setup()
    await register(provider, 'alice')
    authenticator.credentials.create = async () => {
      throw new Error('The operation either timed out or was not allowed.')
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await expect(register(provider, 'bob')).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(11_000)
    vi.useRealTimers()

    expect(cancelled.length).toMatchInlineSnapshot(`0`)
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
