/**
 * Runs the `tempoId` wagmi connector against `apps/id`: a connection with a sign-in of the app's own,
 * a held session, per-connection access keys, signatures through wagmi and the provider, the
 * sign-out, and the refused chain switch. The suite runs outside a browser and no Tempo node, so the
 * access key signs messages, and no test sends a transaction.
 * @module
 */
import {
  connect,
  createConfig,
  createStorage,
  disconnect,
  getConnection,
  injected,
  reconnect,
  signMessage,
  switchChain,
} from '@wagmi/core'
import { Id, Plugin, Session, Store } from 'accounts'
import * as Plugins from 'accounts/plugins'
import * as Wagmi from 'accounts/wagmi'
import { SignatureEnvelope } from 'ox/tempo'
import { http, toHex } from 'viem'
import { Expiry, Scopes } from 'viem/tempo'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
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
import * as Admin from '../../test/Admin.js'
import * as Client from '../../test/Client.js'
import { Database, Env, Harness, Realm } from '../../test/TempoId.js'

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

describe('tempoId', () => {
  test("connects with the app's own sign-in, and returns the key's account on the config's first chain", async () => {
    const { config, connector } = await setup()

    const result = await connect(config, { connector, signIn })
    const session = await (await connector.getInstance()).session.get()

    expect(result.accounts).toEqual([session!.key!.account])
    expect(result.chainId).toBe(tempoTestnet.id)
    expect(getConnection(config).status).toBe('connected')
    expect(getConnection(config).address).toBe(session!.key!.account)
  })

  test("keeps the options of a viem plugin in `plugins`, over the config's chains", async () => {
    const { config, connector } = await setup({
      plugins: [Plugins.viem({ feeToken: ousdAddress })],
    })

    await connect(config, { connector, signIn })
    const client = (await connector.getInstance()).viem

    // Tempo's chain formatters read `feeToken`, which Viem's `Chain` type does not name.
    expect((client.chain as { feeToken?: unknown }).feeToken).toBe(ousdAddress)
    expect(client.chain.id).toBe(tempoTestnet.id)
  })

  test("applies the transport of a viem plugin's object options to the config's first chain alone, and `http()` to a chain outside the config", async () => {
    const { connector } = await setup({
      plugins: [Plugins.viem({ transport: http('https://rpc.example') })],
    })

    const instance = await connector.getInstance()

    expect(instance.viem({ chainId: tempoDevnet.id }).transport.url).toBe(
      tempoDevnet.rpcUrls.default.http[0],
    )
  })

  test("signs a message through wagmi's action and the provider with the access key outside a browser", async () => {
    const { config, connector } = await setup()
    const { accounts } = await connect(config, { connector, signIn })

    const signature = await signMessage(config, { message: 'hi' })
    const provider = await connector.getProvider()
    const signed = await provider.request({
      method: 'personal_sign',
      params: [toHex('hi'), accounts[0]],
    })
    const foreign = await provider
      .request({
        method: 'personal_sign',
        params: [toHex('hi'), '0x0000000000000000000000000000000000000001'],
      })
      .catch((error: unknown) => error)

    expect(SignatureEnvelope.deserialize(signature).type).toBe('keychain')
    expect(signed).toBe(signature)
    expect(await provider.request({ method: 'eth_accounts' })).toEqual(accounts)
    expect(await provider.request({ method: 'eth_chainId' })).toBe(
      toHex(tempoTestnet.id),
    )
    expect(foreign).toMatchInlineSnapshot(
      `[Provider.UnauthorizedError: Invalid account: 0x0000000000000000000000000000000000000001 is not the session's account. Sign with the connected account.]`,
    )
  })

  test("connects wagmi at the instance's own sign-in, and signs in again with the access key of a connection", async () => {
    const { config, connector } = await setup()
    const instance = await connector.getInstance()
    const held = await signIn(instance, { accessKey: undefined })

    // The instance's own sign-in connects wagmi with the held session.
    await expect
      .poll(() => getConnection(config).address)
      .toBe(held.key!.account)
    await disconnect(config)
    const keyless = await connect(config, {
      connector,
      accessKey: false,
      signIn,
    })
    const session = await instance.session.get()

    expect(session!.key).toBeUndefined()
    expect(keyless.accounts).toEqual([session!.account!.address])
  })

  test('throws SignInRequiredError without `signIn` when every sign-in plugin takes input', async () => {
    const { config, connector } = await setup()

    await expect(
      connect(config, { connector }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[wagmi.SignInRequiredError: The connector's sign-in plugins each take input, such as an emailed code. Pass \`signIn\` to \`connect\`, or add the \`dialog\`, \`passkey\`, \`redirect\`, or \`device\` plugin.]`,
    )
    expect(getConnection(config).status).toBe('disconnected')
  })

  test("signs out at disconnect, and disconnects wagmi at the instance's own sign-out", async () => {
    const { config, connector } = await setup()
    const instance = await connector.getInstance()
    await connect(config, { connector, signIn })

    await disconnect(config)
    const afterDisconnect = await instance.session.get()
    await connect(config, { connector, signIn })
    await instance.signOut()

    expect(afterDisconnect).toBeUndefined()
    expect(await connector.getAccounts()).toEqual([])
    expect(await connector.isAuthorized()).toBe(false)
    expect(getConnection(config).status).toBe('disconnected')
  })

  test("refuses a switch to another chain, and a connection on it, and returns the connector's own chain", async () => {
    const { config, connector } = await setup()
    await connect(config, { connector, signIn })

    const own = await switchChain(config, { chainId: tempoTestnet.id })

    expect(own.id).toBe(tempoTestnet.id)
    await expect(
      switchChain(config, { chainId: tempo.id }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[wagmi.ChainSwitchError: Invalid chain: 4217 is not the connector's chain, 42431. A session and its key belong to one chain, so put the chain first in the config's \`chains\`.]`,
    )
    await disconnect(config)
    await expect(
      connect(config, { chainId: tempo.id, connector, signIn }),
    ).rejects.toThrow(Wagmi.ChainSwitchError)
  })
})

describe('wagmi', () => {
  test("serves a config over the instance and the viem plugin's chains, with the instance's chain first", async () => {
    const { tempoId } = await setupPlugin()

    const config = tempoId.wagmi
    const connector = config.connectors[0]
    const result = await connect(config, {
      connector,
      signIn: (_, parameters) => signIn(tempoId, parameters),
    })
    const session = await tempoId.session.get()

    expect(config.chains.map((chain) => chain.id)).toEqual([
      tempoTestnet.id,
      tempo.id,
      tempoDevnet.id,
      tempoLocalnet.id,
    ])
    expect(config.connectors.map((entry) => entry.id)).toEqual(['tempoId'])
    expect(tempoId.wagmi.state).toBe(config.state)
    expect(result.accounts).toEqual([session!.key!.account])
    expect(getConnection(config).address).toBe(session!.key!.account)
  })

  test("reconnects to the instance's own session, and disconnects at its sign-out", async () => {
    const { tempoId } = await setupPlugin()
    const config = tempoId.wagmi
    const session = await signIn(tempoId, { accessKey: undefined })

    const [connection] = await reconnect(config, {
      connectors: config.connectors,
    })
    const connected = getConnection(config).address
    await tempoId.signOut()

    expect(connection?.accounts).toEqual([session.key!.account])
    expect(connected).toBe(session.key!.account)
    expect(getConnection(config).status).toBe('disconnected')
  })

  test('stays reconnecting while an authorization renews a saved session whose access key expired, then connects its new access key', async () => {
    const registered = await register()
    const store = expiring(Store.memory())
    const signedIn = instance(registered, { store })
    const first = await signIn(signedIn, { accessKey: undefined })
    const tempoId = instance(registered, { store })
    const config = tempoId.wagmi
    const statuses: string[] = []
    config.subscribe(
      (state) => state.status,
      (status) => statuses.push(status),
    )

    store.expire()
    const renewing = tempoId.session.get({ reauthorize: true })
    const [connection] = await reconnect(config, {
      connectors: config.connectors,
    })
    const session = await renewing

    expect(session?.key?.account).not.toBe(undefined)
    expect(session?.key?.keyAuthorization).not.toEqual(
      first.key?.keyAuthorization,
    )
    expect(connection?.accounts).toEqual([session!.key!.account])
    expect(getConnection(config).status).toBe('connected')
    expect(statuses).not.toContain('disconnected')
  })

  test('disconnects wagmi when a sign-out ends the renewal of a connected session whose access key expired', async () => {
    const holder: { context?: Plugin.Context } = {}
    const { tempoId } = await setupPlugin({ plugins: [capture(holder)] })
    const config = tempoId.wagmi()
    const signedIn = await signIn(tempoId, { accessKey: undefined })
    const [connection] = await reconnect(config, {
      connectors: config.connectors,
    })
    // The same session, whose access key expired, as a page that stays open past the expiry holds.
    const key = signedIn.key!
    await holder.context!.session.change({ update: true }).commit(
      Session.from({
        ...signedIn,
        key: {
          ...key,
          keyAuthorization: { ...key.keyAuthorization, expiry: '0x1' },
        },
      }),
    )

    const renewing = tempoId.session
      .get({ reauthorize: true })
      .catch((error: unknown) => error)
    await waitFor(tempoId.session.actor!, (snapshot) =>
      snapshot.matches('reauthorizing'),
    )
    const during = getConnection(config).status
    await tempoId.signOut()
    await renewing

    expect(connection?.accounts).toEqual([key.account])
    expect(during).toBe('connected')
    expect(getConnection(config).status).toBe('disconnected')
  })

  test('disconnects wagmi when the authorization of an expired saved session finds no Tempo ID session', async () => {
    const registered = await register()
    const store = expiring(Store.memory())
    const signedIn = instance(registered, { store })
    await signIn(signedIn, { accessKey: undefined })
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
    const tempoId = instance(registered, { store })
    const config = tempoId.wagmi

    store.expire()
    const renewing = tempoId.session.get({ reauthorize: true })
    const connections = await reconnect(config, {
      connectors: config.connectors,
    })

    expect(await renewing).toBeUndefined()
    expect(connections).toEqual([])
    expect(getConnection(config).status).toBe('disconnected')
  })

  test('connects wagmi at a sign-in through the instance itself', async () => {
    const { tempoId } = await setupPlugin()
    // The config is created at its first read, as a page's provider reads it at its mount.
    const config = tempoId.wagmi()

    const session = await signIn(tempoId, { accessKey: undefined })

    await expect
      .poll(() => getConnection(config).address)
      .toBe(session.key!.account)
    expect(getConnection(config).status).toBe('connected')
  })

  test("returns a new config with a call's overrides, whose connectors follow the instance's", async () => {
    const { tempoId } = await setupPlugin()

    const config = tempoId.wagmi({ connectors: [injected()], ssr: true })

    expect(config).not.toBe(tempoId.wagmi())
    expect(tempoId.wagmi()).toBe(tempoId.wagmi())
    expect(config.connectors.map((entry) => entry.id)).toEqual([
      'tempoId',
      'injected',
    ])
    expect(config._internal.ssr).toBe(true)
  })

  test('connects wagmi at a sign-in without a key or an account, after it reads the account', async () => {
    const holder: { context?: Plugin.Context } = {}
    const { tempoId } = await setupPlugin({ plugins: [capture(holder)] })
    const config = tempoId.wagmi()
    const signedIn = await signIn(tempoId, { accessKey: false })
    const { account: _, ...rest } = signedIn

    // A dialog's or a redirect's sign-in without an access key holds no account, as this session does.
    await holder.context!.session.change().commit(Session.from(rest))

    await expect
      .poll(() => getConnection(config).address)
      .toBe(signedIn.account!.address)
  })

  test('rejects a connection whose account read a sign-out overtook, and keeps wagmi disconnected', async () => {
    const holder: { context?: Plugin.Context } = {}
    const gate = Promise.withResolvers<void>()
    const reads = { count: 0, gated: false }
    const both = Promise.withResolvers<void>()
    // While `gated`, each account read's response waits for `gate`, so the read succeeds first.
    const { tempoId } = await setupPlugin({
      plugins: [capture(holder)],
      wrap: (fetch) => async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        const response = await fetch(input, init)
        if (reads.gated && url.includes('/v1/account')) {
          if (++reads.count === 2) both.resolve()
          await gate.promise
        }
        return response
      },
    })
    const config = tempoId.wagmi()
    const signedIn = await signIn(tempoId, { accessKey: false })
    await expect.poll(() => getConnection(config).status).toBe('connected')
    const { account: _, ...rest } = signedIn

    // The subscriber's read and the connection's read both wait, then a sign-out overtakes them.
    reads.gated = true
    await holder.context!.session.change().commit(Session.from(rest))
    await expect.poll(() => getConnection(config).status).toBe('disconnected')
    const connecting = connect(config, {
      connector: config.connectors[0],
    }).catch((error: unknown) => error)
    await both.promise
    await tempoId.signOut()
    gate.resolve()

    expect(await connecting).toBeInstanceOf(Id.SupersededError)
    expect(getConnection(config).status).toBe('disconnected')
  })

  test("keeps another connector's current connection at the instance's sign-in, and connects after that connector disconnects", async () => {
    const { tempoId } = await setupPlugin()
    const values = new Map<string, string>()
    const reads = { count: 0, done: Promise.withResolvers<void>() }
    const storage = createStorage({
      storage: {
        getItem(key) {
          if (key.endsWith('.store') && ++reads.count === 1)
            reads.done.resolve()
          return values.get(key) ?? null
        },
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, value),
      },
    })
    const config = tempoId.wagmi({ connectors: [injected()], storage })
    // wagmi's persisted state names a connection of the injected wallet as the current one.
    await storage.setItem('store', {
      state: {
        chainId: tempoTestnet.id,
        connections: new Map([
          [
            'injected-uid',
            {
              accounts: ['0x0000000000000000000000000000000000000001'],
              chainId: tempoTestnet.id,
              connector: {
                id: 'injected',
                name: 'Injected',
                type: 'injected',
                uid: 'injected-uid',
              },
            },
          ],
        ]),
        current: 'injected-uid',
      },
      version: 2,
    })

    await signIn(tempoId, { accessKey: undefined })
    await reads.done.promise
    await Promise.resolve()

    expect(getConnection(config).status).toBe('disconnected')

    // With no current connection, as after a disconnect, the instance's sign-in connects.
    await storage.setItem('store', {
      state: {
        chainId: tempoTestnet.id,
        connections: new Map(),
        current: null,
      },
      version: 2,
    })
    await signIn(tempoId, { accessKey: undefined })
    await expect.poll(() => getConnection(config).status).toBe('connected')
  })

  test("connects none after a sign-out that completes while the connector reads wagmi's storage", async () => {
    const { tempoId } = await setupPlugin()
    const values = new Map<string, string>()
    const gate = Promise.withResolvers<void>()
    const reached = Promise.withResolvers<void>()
    // While `gated`, the first read of wagmi's state waits for `gate`, as a slow custom storage
    // does.
    const held = { gated: false }
    const storage = createStorage({
      storage: {
        async getItem(key) {
          if (held.gated && key.endsWith('.store')) {
            held.gated = false
            reached.resolve()
            await gate.promise
          }
          return values.get(key) ?? null
        },
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, value),
      },
    })
    const config = tempoId.wagmi({ storage })

    held.gated = true
    await signIn(tempoId, { accessKey: undefined })
    await reached.promise
    await tempoId.signOut()
    gate.resolve()
    // One macrotask lets the held read and the emit that follows it complete.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getConnection(config).status).toBe('disconnected')
  })

  test("connects none at the instance's sign-in when wagmi has no storage, as it cannot read wagmi's current connection", async () => {
    const { tempoId } = await setupPlugin()
    const config = tempoId.wagmi({ connectors: [injected()], storage: null })

    await signIn(tempoId, { accessKey: undefined })
    // One macrotask lets the connector's notification complete.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getConnection(config).status).toBe('disconnected')
  })

  test("commits the account of a session without one after a refresh in progress, onto the refresh's tokens", async () => {
    const holder: { context?: Plugin.Context } = {}
    const gates = {
      account: Promise.withResolvers<void>(),
      token: Promise.withResolvers<void>(),
    }
    const reached = {
      account: Promise.withResolvers<void>(),
      token: Promise.withResolvers<void>(),
    }
    const held = { gated: false }
    // While `gated`, the account read and the token request wait for their gates.
    const { tempoId } = await setupPlugin({
      plugins: [capture(holder)],
      wrap: (fetch) => async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        const kind = url.includes('/v1/account')
          ? 'account'
          : url.includes('/oauth2/token')
            ? 'token'
            : undefined
        if (held.gated && kind) {
          reached[kind].resolve()
          await gates[kind].promise
        }
        return fetch(input, init)
      },
    })
    tempoId.wagmi()
    const signedIn = await signIn(tempoId, { accessKey: false })
    const { account: _, ...rest } = signedIn

    // The subscriber reads the account of a session without one, then a refresh takes the lock.
    held.gated = true
    await holder.context!.session.change().commit(Session.from(rest))
    await reached.account.promise
    const refreshing = tempoId.session.refresh()
    await reached.token.promise
    // The account's commit waits for the refresh's lock, then applies to the refresh's tokens.
    gates.account.resolve()
    gates.token.resolve()
    const refreshed = await refreshing

    await expect
      .poll(async () => (await tempoId.session.get())?.account?.address)
      .toBe(signedIn.account!.address)
    expect(refreshed?.refreshToken).not.toBe(signedIn.refreshToken)
    expect((await tempoId.session.get())?.refreshToken).toBe(
      refreshed?.refreshToken,
    )
  })

  test('adds the Viem client without a viem plugin, as `viem()` does', () => {
    const tempoId = Id.create({
      chainId: tempoTestnet.id,
      clientId: 'https://app.example.com',
      plugins: [Plugins.email(), Wagmi.wagmi()],
      store: Store.memory(),
    })

    expect(tempoId.viem.chain.id).toBe(tempoTestnet.id)
    expect(typeof tempoId.token.transferSync).toBe('function')
    expect(tempoId.wagmi.chains[0].id).toBe(tempoTestnet.id)
  })
})

/**
 * Returns a wagmi config on Tempo testnet whose one connector is `tempoId` for a new app, with the
 * email plugin, and the connector.
 */
async function setup(options: { plugins?: readonly Plugin.Option[] } = {}) {
  const { plugins = [] } = options
  const { clientId, fetch, origin } = await register()
  const config = createConfig({
    chains: [tempoTestnet, tempo],
    connectors: [
      Wagmi.tempoId({
        clientId,
        fetch,
        accessKey: permissions,
        plugins: [Plugins.email(), ...plugins],
        redirectUri: `${origin}/callback`,
        store: Store.memory(),
        url: Env.origin,
      }),
    ],
    transports: { [tempo.id]: http(), [tempoTestnet.id]: http() },
  })
  return { config, connector: config.connectors[0]! }
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

/** Returns an instance with the wagmi plugin of the `registered` app, on `store`. */
function instance(
  registered: Awaited<ReturnType<typeof register>>,
  options: { store: Store.Store },
) {
  const { clientId, fetch, origin } = registered
  return Id.create({
    chainId: tempoTestnet.id,
    clientId,
    fetch,
    accessKey: permissions,
    plugins: [Plugins.email(), Plugins.viem(), Wagmi.wagmi()],
    redirectUri: `${origin}/callback`,
    store: options.store,
    url: Env.origin,
  })
}

/** The permissions of each sign-in: an access key that sends OUSD. */
function permissions() {
  return {
    expiry: Expiry.days(364),
    limits: [{ limit: 1_000_000_000n, token: ousdAddress }],
    scopes: [Scopes.tip20(ousdAddress).transfer()],
  }
}

/**
 * Registers a new app of a realm that creates accounts, and returns its client ID, its origin, and a
 * `fetch` that sends its requests to the harness from that origin.
 */
async function register() {
  const realmId = `cash-${crypto.randomUUID().replaceAll('-', '')}`
  await Admin.addRealm(admin, { id: realmId, name: 'Tempo Cash' })
  // The Admin API has no route for a realm's secp256k1 owners.
  await Realm.setSecp256k1(database.db, { enabled: true, realmId })
  const clientId = crypto.randomUUID()
  const origin = 'https://app.example.com'
  await Admin.createApp(admin, {
    clientId,
    name: 'Example',
    redirectUris: [`${origin}/callback`],
  })
  await Admin.setAppRealms(admin, { clientId, realms: [realmId] })
  const harness = Client.create(server, { clientId, origin })
  return { clientId, fetch: harness.fetch, origin }
}

/** Signs a new address in with an emailed code, with the connection's access key. */
async function signIn(
  instance: Pick<
    Wagmi.tempoId.Instance<readonly [ReturnType<typeof Plugins.email>]>,
    'email'
  >,
  parameters: { accessKey: Wagmi.tempoId.ConnectParameters['accessKey'] },
) {
  const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
  await instance.email.sendCode({ email })
  return instance.email.signIn({
    code: await Harness.code(server, { email }),
    email,
    accessKey: parameters.accessKey,
  })
}

/**
 * Returns an instance on Tempo testnet for a new app, with the email, viem, and wagmi plugins, and
 * `plugins`. The viem plugin's chains name mainnet first, so the config moves the instance's chain
 * to the front. `wrap` wraps the instance's `fetch`.
 */
async function setupPlugin(
  options: {
    plugins?: readonly Plugin.Option[] | undefined
    wrap?:
      | ((fetch: typeof globalThis.fetch) => typeof globalThis.fetch)
      | undefined
  } = {},
) {
  const { plugins = [], wrap = (fetch) => fetch } = options
  const { clientId, fetch, origin } = await register()
  const tempoId = Id.create({
    chainId: tempoTestnet.id,
    clientId,
    fetch: wrap(fetch),
    accessKey: permissions,
    plugins: [Plugins.email(), Plugins.viem(), Wagmi.wagmi(), plugins],
    redirectUri: `${origin}/callback`,
    store: Store.memory(),
    url: Env.origin,
  })
  return { tempoId }
}

/** Returns a plugin that sets `holder.context` to its instance's context. */
function capture(holder: { context?: Plugin.Context }) {
  return Plugin.from({
    id: 'capture',
    setup(context) {
      holder.context = context
    },
  })
}
