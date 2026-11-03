/**
 * Runs `Plugins.viem` against `apps/id`: the default client, whose account follows the instance's
 * session, and the clients of a call's overrides. Outside a node, the access key signs messages
 * only. With a local Tempo node and the Tempo API's relay, the access key sends transfers whose
 * fees the relay's fee payer pays.
 * @module
 */
import { createConfig } from '@wagmi/core'
import { Id, Store } from 'accounts'
import * as Plugins from 'accounts/plugins'
import * as Wagmi from 'accounts/wagmi'
import { SignatureEnvelope } from 'ox/tempo'
import { Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { createClient, http, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { signMessage } from 'viem/actions'
import { Actions, Expiry, Scopes, withRelay } from 'viem/tempo'
import { tempo, tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
import { ousd } from 'viem/tokens'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vite-plus/test'
import * as Admin from '../../test/Admin.js'
import * as Client from '../../test/Client.js'
import {
  Chain,
  Database,
  Env,
  Harness,
  Realm,
  TempoApi,
} from '../../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()

/** The port of the Tempo API over this file's node, apart from the other suites' APIs. */
const apiPort = 9786

/** The port of this file's node, apart from the other suites' nodes. */
const nodePort = 9785

/** OUSD, which has its mainnet address on every Tempo chain. */
const ousdAddress = ousd(tempo.id).address

/** pathUSD, which the node's faucet drips and the local chain's accounts pay fees in. */
const pathUsd = '0x20c0000000000000000000000000000000000000'

/** The RPC URL of this file's node. */
const rpcUrl = `http://127.0.0.1:${nodePort}/1`

/** The local chain, whose transactions pay fees in pathUSD. */
const localnet = tempoLocalnet.extend({ feeToken: pathUsd })

/** The recipient of each transfer. */
const to = '0x0000000000000000000000000000000000000001'

beforeAll(async () => {
  await admin.listen()
})

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') admin.debug()
  await admin.reset()
})

afterAll(async () => {
  await Promise.all([admin.close(), database.end()])
})

describe('with the default configuration', () => {
  const server = Harness.create()

  beforeAll(async () => {
    await server.listen()
  })

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail') server.debug()
    await server.reset()
  })

  afterAll(async () => {
    await server.close()
  })

  describe('viem', () => {
    test("follows the instance's session: signed out before a sign-in, then the access key's account", async () => {
      const tempoId = await instance(server)

      const before = (() => {
        try {
          return tempoId.viem.account.address
        } catch (error) {
          return error
        }
      })()
      const session = await signIn(server, { tempoId })

      expect(before).toBeInstanceOf(Id.SignedOutError)
      expect(tempoId.viem.account.address).toBe(session.key!.account)
      expect(tempoId.viem.chain.id).toBe(tempoTestnet.id)
    })

    test('signs a message with the access key outside a browser, also through Viem’s standalone action', async () => {
      const tempoId = await instance(server)
      await signIn(server, { tempoId })

      const signature = await tempoId.viem.signMessage({ message: 'hi' })
      const standalone = await signMessage(tempoId.viem, { message: 'hi' })

      expect(SignatureEnvelope.deserialize(signature).type).toBe('keychain')
      expect(standalone).toBe(signature)
      expect(typeof tempoId.viem).toBe('function')
    })

    test("returns one client for each chain, and throws for a chain that is not Tempo's and whose options name no `chain`", async () => {
      const tempoId = await instance(server)

      const testnet = tempoId.viem({ chainId: tempoTestnet.id })
      const mainnet = tempoId.viem({ chainId: tempo.id })

      expect(tempoId.viem({ chainId: tempoTestnet.id })).toBe(testnet)
      expect(tempoId.viem()).toBe(testnet)
      expect(mainnet).not.toBe(testnet)
      expect(mainnet.chain.id).toBe(tempo.id)
      expect(() =>
        tempoId.viem({ chainId: 1 }),
      ).toThrowErrorMatchingInlineSnapshot(
        `[Error: Invalid chain: 1 is not a Tempo chain, and its options name no \`chain\`. Return its definition as \`chain\`.]`,
      )
    })

    test("signs with a fixed session's access key, with a new client at each call, and throws KeyRequiredError for a session without a key", async () => {
      const tempoId = await instance(server)
      const session = await signIn(server, { tempoId })
      await tempoId.signOut()
      const keyless = await signIn(server, { accessKey: false, tempoId })

      const client = tempoId.viem({ session })

      expect(client.account.address).toBe(session.key!.account)
      expect(tempoId.viem({ session })).not.toBe(client)
      expect(() => tempoId.viem({ session: keyless })).toThrow(
        Id.KeyRequiredError,
      )
    })

    test("uses the session's key only on its chain, and throws KeyRequiredError for a transaction on another chain", async () => {
      const tempoId = await instance(server)
      const session = await signIn(server, { tempoId })

      const mainnet = tempoId.viem({ chainId: tempo.id })
      const transaction = await mainnet.account
        .signTransaction({ chainId: tempo.id, type: 'tempo' } as never)
        .catch((error: unknown) => error)

      expect(mainnet.account.address).toBe(session.key!.account)
      expect(transaction).toBeInstanceOf(Id.KeyRequiredError)
    })

    test("holds the default client's actions on the instance itself, which sign as the session's key, beside the instance's own account", async () => {
      const tempoId = await instance(server)
      await signIn(server, { tempoId })

      const lifted = await tempoId.signMessage({ message: 'hi' })
      const client = await tempoId.viem.signMessage({ message: 'hi' })

      expect(lifted).toBe(client)
      expect(typeof tempoId.token.transferSync).toBe('function')
      expect(typeof tempoId.account.get).toBe('function')
      expect('chain' in tempoId).toBe(false)
      expect('transport' in tempoId).toBe(false)
    })

    test("creates an instance whose chain is not Tempo's and whose options name no `chain`, whose actions then name the chain", () => {
      const tempoId = Id.create({
        chainId: 1,
        clientId: 'client_test',
        plugins: [Plugins.viem()],
      })

      expect(tempoId.viem({ chainId: tempo.id }).chain.id).toBe(tempo.id)
      expect(() => tempoId.token).toThrowErrorMatchingInlineSnapshot(
        `[Error: Invalid chain: 1 is not a Tempo chain, and its options name no \`chain\`. Return its definition as \`chain\`.]`,
      )
    })

    test('creates an instance whose chain has no RPC URL, and reaches it through `transport`', () => {
      const chain = {
        ...tempoTestnet,
        rpcUrls: { default: { http: [] } },
      } as unknown as typeof tempoTestnet
      const tempoId = Id.create({
        chainId: chain.id,
        clientId: 'client_test',
        plugins: [
          Plugins.viem({ chain, transport: http('https://rpc.example') }),
        ],
      })

      expect(tempoId.viem.chain.id).toBe(chain.id)
      expect(tempoId.viem.transport.url).toBe('https://rpc.example')
      expect(typeof tempoId.token.transferSync).toBe('function')
    })

    test("applies the transport of object options to the instance's chain alone, and `http()` to every other chain", () => {
      const tempoId = Id.create({
        chainId: tempoTestnet.id,
        clientId: 'client_test',
        plugins: [Plugins.viem({ transport: http('https://rpc.example') })],
      })

      expect(tempoId.viem.transport.url).toBe('https://rpc.example')
      expect(tempoId.viem({ chainId: tempo.id }).transport.url).toBe(
        tempo.rpcUrls.default.http[0],
      )
    })

    test("sends through the `relay` route on the instance's chain alone, in the object form, and over `http()` on every other chain", () => {
      const tempoId = Id.create({
        chainId: tempoTestnet.id,
        clientId: 'client_test',
        plugins: [Plugins.viem({ relay: 'https://app.example.com/api/relay' })],
      })

      expect(tempoId.viem.transport.name).toBe('Relay Proxy')
      expect(tempoId.viem({ chainId: tempo.id }).transport.name).toBe(
        'HTTP JSON-RPC',
      )
    })

    test("takes a function that returns each chain's options, which the chain's clients use", () => {
      const tempoId = Id.create({
        chainId: tempoTestnet.id,
        clientId: 'client_test',
        plugins: [
          Plugins.viem((chainId) => ({
            transport: http(`https://rpc.example/${chainId}`),
          })),
        ],
      })

      expect(tempoId.viem.transport.url).toBe(
        `https://rpc.example/${tempoTestnet.id}`,
      )
      expect(tempoId.viem({ chainId: tempo.id }).transport.url).toBe(
        `https://rpc.example/${tempo.id}`,
      )
    })

    test("defaults to Tempo's chains, so a client without options reaches each of them", () => {
      const tempoId = Id.create({
        chainId: tempoTestnet.id,
        clientId: 'client_test',
        plugins: [Plugins.viem()],
      })

      expect(tempoId.viem.chain.id).toBe(tempoTestnet.id)
      expect(tempoId.viem({ chainId: tempo.id }).chain.id).toBe(tempo.id)
    })

    test('extends the default client with Viem’s `extend`, whose account still follows the session', async () => {
      const tempoId = await instance(server)
      const extended = tempoId.viem.extend(() => ({ label: 'app' }))

      const session = await signIn(server, { tempoId })

      expect(extended.label).toBe('app')
      expect(extended.account.address).toBe(session.key!.account)
    })
  })
})

describe('with a local Tempo node and the Tempo API', () => {
  const node = Server.create({
    host: '127.0.0.1',
    instance: TestContainers.Instance.tempo({
      blockTime: '50ms',
      faucet: Chain.faucet,
      genesis: Chain.genesis,
      image: Chain.image,
      port: nodePort,
    }),
    port: nodePort,
  })
  const server = Harness.create({
    secrets: {
      RPC_URLS: `local:${tempoLocalnet.id}=${rpcUrl}`,
      TEMPO_API_URLS: 'none',
    },
  })

  /** The Tempo API over the node, whose relay sponsors transactions with the development API key. */
  let api: Awaited<ReturnType<typeof TempoApi.start>> | undefined

  beforeAll(async () => {
    await node.start()
    // The server starts the node's container on its first request, which can take seconds.
    const deadline = Date.now() + 120_000
    while (
      !(await nodeClient()
        .request({ method: 'eth_chainId' })
        .then(
          () => true,
          () => false,
        ))
    ) {
      if (Date.now() > deadline) throw new Error('The node did not respond.')
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    api = await TempoApi.start({
      database: 'tempo_api_viem',
      databaseUrl: database.url,
      port: apiPort,
      rpcUrl,
    })
    await server.listen()
  }, 600_000)

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail') server.debug()
    await server.reset()
  })

  afterAll(async () => {
    await server.close()
    await api?.stop()
    await node.stop()
  })

  describe('transport', () => {
    test("sends a transfer through a plain HTTP transport to the Tempo API's relay, whose fee payer pays its fees", async () => {
      const tempoId = await instance(server, {
        chain: localnet,
        transport: relay(),
      })
      const session = await signIn(server, { tempoId })
      const account = session.key!.account
      await Actions.faucet.fundSync(nodeClient(), { account })
      const before = await balance(account)

      const { receipt } = await tempoId.viem.token.transferSync({
        amount: 1n,
        to,
        token: pathUsd,
      })

      expect(receipt.status).toBe('success')
      expect(isAddressEqual(receipt.from, account)).toBe(true)
      expect(isAddressEqual(receipt.feePayer!, feePayer())).toBe(true)
      expect(before - (await balance(account))).toBe(1n)
    })

    test('pays its own fees through the relay with `feePayer: false`', async () => {
      const tempoId = await instance(server, {
        chain: localnet,
        transport: relay(),
      })
      const session = await signIn(server, { tempoId })
      const account = session.key!.account
      await Actions.faucet.fundSync(nodeClient(), { account })

      const { receipt } = await tempoId.viem.token.transferSync({
        amount: 1n,
        feePayer: false,
        to,
        token: pathUsd,
      })

      expect(receipt.status).toBe('success')
      expect(isAddressEqual(receipt.feePayer!, account)).toBe(true)
    })

    test('sends a transfer of one call through the relay of the `transport` override, while the default client pays its own fees on the node', async () => {
      const tempoId = await instance(server, {
        chain: localnet,
        transport: http(rpcUrl),
      })
      const session = await signIn(server, { tempoId })
      const account = session.key!.account
      await Actions.faucet.fundSync(nodeClient(), { account })

      const own = await tempoId.viem.token.transferSync({
        amount: 1n,
        to,
        token: pathUsd,
      })
      const sponsored = await tempoId
        .viem({ session, transport: relay() })
        .token.transferSync({ amount: 1n, to, token: pathUsd })

      expect(isAddressEqual(own.receipt.feePayer!, account)).toBe(true)
      expect(isAddressEqual(sponsored.receipt.feePayer!, feePayer())).toBe(true)
    })

    test("sends a transfer through the relay route of the server's `relay({ apiKey })`, whose Tempo API key pays its fees", async () => {
      const tempoId = await instance(server, {
        chain: localnet,
        transport: http(rpcUrl),
      })
      const session = await signIn(server, { tempoId })
      const account = session.key!.account
      await Actions.faucet.fundSync(nodeClient(), { account })
      const backend = Id.create({
        chainId: localnet.id,
        clientId: tempoId.config.clientId,
        plugins: [
          Plugins.viem({ chain: localnet, transport: http(rpcUrl) }),
          Plugins.relay({ apiKey: TempoApi.apiKey, apiUrl: api!.url }),
        ],
      })

      const { receipt } = await tempoId
        .viem({
          // Sponsorship requests go to the server's relay route, as the app's page sends them, and
          // every other request goes to the node.
          transport: withRelay(
            http(rpcUrl),
            http('https://app.example.com/api/relay', {
              fetchFn: (input, init) =>
                backend.relay.fetch(new Request(input, init)),
            }),
          ),
        })
        .token.transferSync({ amount: 1n, to, token: pathUsd })

      expect(receipt.status).toBe('success')
      expect(isAddressEqual(receipt.from, account)).toBe(true)
      expect(isAddressEqual(receipt.feePayer!, feePayer())).toBe(true)
    })

    test("sends a transfer through the wagmi config's relay transport, which the connector's clients use", async () => {
      const tempoId = await instance(server, {
        chain: localnet,
        transport: http(rpcUrl),
      })
      const session = await signIn(server, { tempoId })
      await Actions.faucet.fundSync(nodeClient(), {
        account: session.key!.account,
      })
      const config = createConfig({
        chains: [localnet],
        connectors: [Wagmi.tempoId({ clientId: tempoId.config.clientId })],
        transports: { [localnet.id]: relay() },
      })

      const connector = await config.connectors[0]!.getInstance()
      const { receipt } = await connector
        .viem({ session })
        .token.transferSync({ amount: 1n, to, token: pathUsd })

      expect(isAddressEqual(receipt.feePayer!, feePayer())).toBe(true)
    })
  })

  /** Returns the pathUSD balance of `account` on the node. */
  async function balance(account: `0x${string}`) {
    const { amount } = await Actions.token.getBalance(nodeClient(), {
      account,
      token: pathUsd,
    })
    return amount
  }

  /** Returns the address of the Tempo API's fee payer. */
  function feePayer() {
    return privateKeyToAccount(TempoApi.feePayer).address
  }

  /** Returns a client of the node. */
  function nodeClient() {
    return createClient({ chain: localnet, transport: http(rpcUrl) })
  }

  /** Returns a plain HTTP transport to the Tempo API's relay of the local chain, with the development API key. */
  function relay() {
    return http(`${api!.url}/rpc/relay/${localnet.id}`, {
      fetchOptions: { headers: { 'tempo-api-key': TempoApi.apiKey } },
    })
  }
})

/**
 * Returns an instance of a new app on `chain`, Tempo testnet by default, with the email and Viem
 * plugins, against `server`. Its access keys may transfer OUSD and pathUSD.
 */
async function instance(
  server: Harness.Instance,
  options: {
    chain?: typeof localnet | typeof tempoTestnet | undefined
    transport?: Plugins.viem.Options['transport'] | undefined
  } = {},
) {
  const { chain = tempoTestnet, transport } = options
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
  return Id.create({
    chainId: chain.id,
    clientId,
    fetch: harness.fetch,
    accessKey: () => ({
      expiry: Expiry.days(364),
      limits: [
        { limit: 1_000_000_000n, token: ousdAddress },
        { limit: 1_000_000_000n, token: pathUsd },
      ],
      scopes: [
        Scopes.tip20(ousdAddress).transfer(),
        Scopes.tip20(pathUsd).transfer(),
      ],
    }),
    plugins: [
      Plugins.email(),
      Plugins.viem({
        chain,
        ...(transport ? { transport } : {}),
      }),
    ],
    redirectUri: `${origin}/callback`,
    store: Store.memory(),
    url: Env.origin,
  })
}

/** Signs a new address in to `tempoId` with an emailed code from `server`, and returns the session. */
async function signIn(
  server: Harness.Instance,
  options: {
    accessKey?: false | undefined
    tempoId: Awaited<ReturnType<typeof instance>>
  },
) {
  const { tempoId } = options
  const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
  await tempoId.email.sendCode({ email })
  return tempoId.email.signIn({
    code: await Harness.code(server, { email }),
    email,
    accessKey: options.accessKey,
  })
}
