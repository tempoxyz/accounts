/**
 * Runs `Plugins.relay` on an app's server, with a page's `viem({ relay })` that sends to its route
 * over HTTP. In the Tempo API mode, an unreachable Tempo API responds with `temporarily_unavailable`.
 * In the Viem relay mode, a local Tempo node runs the transfers whose fees the app's own fee payer
 * pays.
 * @module
 */
import { Id, Store } from 'accounts'
import * as Plugins from 'accounts/plugins'
import * as Http from 'node:http'
import { Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { createClient, http, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Actions, Expiry, Scopes } from 'viem/tempo'
import { tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
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
import { Chain, Database, Env, Harness, Realm } from '../../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()

/** The port of this file's node, apart from the other suites' nodes. */
const nodePort = 9787

/** pathUSD, which the node's faucet drips and the local chain's accounts pay fees in. */
const pathUsd = '0x20c0000000000000000000000000000000000000'

/** The RPC URL of this file's node. */
const rpcUrl = `http://127.0.0.1:${nodePort}/1`

/** The local chain, whose transactions pay fees in pathUSD. */
const localnet = tempoLocalnet.extend({ feeToken: pathUsd })

/** An origin where nothing listens, which refuses every connection. */
const unreachable = 'http://127.0.0.1:1'

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

describe('relay', () => {
  test("forwards a fill of the page's `viem({ relay })` to the Tempo API, which responds with temporarily_unavailable when unreachable", async () => {
    const backend = Id.create({
      chainId: tempoTestnet.id,
      clientId: 'client_test',
      plugins: [
        Plugins.relay({ apiKey: 'tempo:sk:test', apiUrl: unreachable }),
      ],
    })
    const methods: string[] = []
    const route = await serve(async (request) => {
      methods.push(
        ((await request.clone().json()) as { method: string }).method,
      )
      return backend.relay.fetch(request)
    })
    const page = Id.create({
      chainId: tempoTestnet.id,
      clientId: 'client_test',
      plugins: [Plugins.viem({ relay: `${route.url}/api/relay` })],
    })

    const error = await page.viem
      .request({
        method: 'eth_fillTransaction' as never,
        params: [
          { calls: [], from: '0x0000000000000000000000000000000000000001' },
        ] as never,
      })
      .catch((error: Error) => error)
    await route.close()

    // The client retries a 503, and each attempt is the fill.
    expect(new Set(methods)).toEqual(new Set(['eth_fillTransaction']))
    expect(error.name).toBe('ResourceUnavailableRpcError')
    expect(error.message).toContain('Sponsor unavailable')
  })

  test('adds the Viem client without a viem plugin, and responds to a method other than POST with 405', async () => {
    const backend = Id.create({
      chainId: tempoTestnet.id,
      clientId: 'client_test',
      plugins: [
        Plugins.relay({ apiKey: 'tempo:sk:test', apiUrl: unreachable }),
      ],
    })

    const response = await backend.relay.fetch(
      new Request('https://app.example.com/api/relay'),
    )

    expect(backend.viem.chain.id).toBe(tempoTestnet.id)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})

describe('with a local Tempo node', () => {
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
    await server.listen()
  }, 600_000)

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail') server.debug()
    await server.reset()
  })

  afterAll(async () => {
    await server.close()
    await node.stop()
  })

  describe('relay', () => {
    test("sends a transfer through the page's `viem({ relay })`, whose fees the server's `relay({ account })` pays through Viem's relay", async () => {
      const feePayer = privateKeyToAccount(generatePrivateKey())
      await Actions.faucet.fundSync(nodeClient(), { account: feePayer.address })
      const backend = Id.create({
        chainId: localnet.id,
        clientId: 'client_test',
        plugins: [
          Plugins.viem({ chain: localnet, transport: http(rpcUrl) }),
          Plugins.relay({ account: feePayer }),
        ],
      })
      const route = await serve((request) => backend.relay.fetch(request))
      const page = await instance(server, {
        relay: `${route.url}/api/relay`,
      })
      const session = await signIn(server, page)
      const account = session.key!.account
      await Actions.faucet.fundSync(nodeClient(), { account })

      const { receipt } = await page.viem.token.transferSync({
        amount: 1n,
        to: '0x0000000000000000000000000000000000000001',
        token: pathUsd,
      })
      await route.close()

      expect(receipt.status).toBe('success')
      expect(isAddressEqual(receipt.from, account)).toBe(true)
      expect(isAddressEqual(receipt.feePayer!, feePayer.address)).toBe(true)
    })
  })

  /** Returns a client of the node. */
  function nodeClient() {
    return createClient({ chain: localnet, transport: http(rpcUrl) })
  }
})

/**
 * Returns an instance of a new app of a realm that creates accounts, on the local chain, with the
 * email plugin and a Viem plugin of `options` over the node. Its access keys may transfer pathUSD.
 */
async function instance(server: Harness.Instance, options: { relay: string }) {
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
  return Id.create({
    accessKey: () => ({
      expiry: Expiry.days(364),
      limits: [{ limit: 1_000_000_000n, token: pathUsd }],
      scopes: [Scopes.tip20(pathUsd).transfer()],
    }),
    chainId: localnet.id,
    clientId,
    fetch: Client.create(server, { clientId, origin }).fetch,
    plugins: [
      Plugins.email(),
      Plugins.viem({
        chain: localnet,
        relay: options.relay,
        transport: http(rpcUrl),
      }),
    ],
    redirectUri: `${origin}/callback`,
    store: Store.memory(),
    url: Env.origin,
  })
}

/**
 * Serves `fetch` over HTTP on a free local port, as an app's server serves its route, and returns
 * its origin and a function that stops it.
 */
async function serve(fetch: (request: Request) => Promise<Response>) {
  const server = Http.createServer((incoming, outgoing) => {
    // Node ignores the listener's promise, so a failure responds with 500 itself.
    void respond(incoming, outgoing).catch(() => {
      outgoing.writeHead(500)
      outgoing.end()
    })
  })

  /** Serves one request through `fetch`. */
  async function respond(
    incoming: Http.IncomingMessage,
    outgoing: Http.ServerResponse,
  ) {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers))
      if (typeof value === 'string') headers.set(name, value)
    const response = await fetch(
      new Request(`http://127.0.0.1${incoming.url}`, {
        ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
        headers,
        method: incoming.method!,
      }),
    )
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
    url: `http://127.0.0.1:${port}`,
  }
}

/** Signs a new address in to `tempoId` with an emailed code from `server`, and returns the session. */
async function signIn(
  server: Harness.Instance,
  tempoId: Awaited<ReturnType<typeof instance>>,
) {
  const email = `tempo-id-test+${crypto.randomUUID()}@example.org`
  await tempoId.email.sendCode({ email })
  return tempoId.email.signIn({
    code: await Harness.code(server, { email }),
    email,
  })
}
