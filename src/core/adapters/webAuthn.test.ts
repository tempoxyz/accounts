import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Authenticator from '../../../test/authenticator.js'
import { chain } from '../../../test/config.js'
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
    const ceremony = WebAuthnCeremony.from({
      ...local,
      async verifyRegistration(credential, parameters) {
        const result = await local.verifyRegistration(credential, parameters)
        const verified = options.reject
          ? Promise.reject(options.reject)
          : new Promise<{ session: boolean }>((resolve, reject) =>
              verifications.push({ reject, resolve: () => resolve({ session: true }) }),
            )
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
    return { authenticator, logins, provider, storage, verifications }
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

  test('behavior: the registration answered last owns the session', async () => {
    const { logins, provider, verifications } = setup()
    await register(provider, 'alice')
    await register(provider, 'bob')
    const id = credentialOf(provider)?.id

    // Bob registered last, but alice's response set the session cookie last.
    verifications[1]!.resolve()
    verifications[0]!.resolve()
    await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: { method: 'login', credentialId: id, digest: `0x${'1'.repeat(64)}` },
        } as never,
      ],
    })

    // Bob signs in with the server instead of the registration's shortcut.
    expect(logins).toHaveBeenCalledTimes(1)
  })

  /** Registers, then leaves the marker behind as a page closed mid-verification would. */
  async function abandon(storage: Storage.Storage, time: number) {
    const first = setup({ storage })
    authenticator = first.authenticator
    await register(first.provider)
    const credential = credentialOf(first.provider)!
    const marker = await storage.getItem<{ time: number }>(`registration:pending:${credential.id}`)
    expect(marker).toBeTruthy()
    await storage.setItem(`registration:pending:${credential.id}`, { ...marker, time })
    return credential
  }
  let authenticator: ReturnType<typeof Authenticator.create> | undefined

  test('behavior: drops an account whose registration outlived its page', async () => {
    const storage = Storage.memory()
    const credential = await abandon(storage, 0)

    const { provider } = setup({ storage })

    await vi.waitFor(async () =>
      expect(await provider.request({ method: 'eth_accounts' })).toEqual([]),
    )
    expect(await storage.getItem(`registration:pending:${credential.id}`)).toMatchInlineSnapshot(
      `null`,
    )
    expect(Object.keys((await storage.getItem<object>(`registration:${credential.id}`)) ?? {}))
      .toMatchInlineSnapshot(`
        [
          "name",
          "publicKey",
        ]
      `)
  })

  test('behavior: a login before the marker expires keeps the account', async () => {
    const storage = Storage.memory()
    // Expires 200 ms from now.
    const credential = await abandon(storage, Date.now() - 60_000 + 200)
    const { provider } = setup({ authenticator, storage })

    const { accounts } = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', credentialId: credential.id } as never }],
    })
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(await provider.request({ method: 'eth_accounts' })).toEqual([accounts[0]!.address])
    expect(await storage.getItem(`registration:pending:${credential.id}`)).toMatchInlineSnapshot(
      `null`,
    )
  })

  test('behavior: clears the marker once the server stores the credential', async () => {
    const { provider, storage, verifications } = setup()
    await register(provider)
    const credential = credentialOf(provider)!

    verifications[0]!.resolve()

    await vi.waitFor(async () =>
      expect(await storage.getItem(`registration:pending:${credential.id}`)).toBeNull(),
    )
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
