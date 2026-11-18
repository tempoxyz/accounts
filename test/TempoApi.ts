/**
 * The Tempo API of the end-to-end suite: the `api-dev` image over the suite's node, with its own
 * Postgres database. The image applies its migrations, seeds the local chain, and provisions the
 * development key before it listens. `TEMPO_API_IMAGE` names another image. With `TEMPO_API_URL`, the
 * suite starts no container, and uses the API at that URL with the key of `TEMPO_API_KEY`.
 *
 * The `tempoApi` fixture of `Playwright.ts` starts the API for the tests that take it, each of which
 * carries {@link tag}. A run without such a test starts no API.
 * @module
 */
import { GenericContainer, Network, Wait } from 'testcontainers'
import * as Chain from './Chain.js'
import * as Images from './Images.js'

/** The URL of a running Tempo API that the suite uses in place of its own, from `TEMPO_API_URL`. */
export const external = process.env.TEMPO_API_URL || undefined

/**
 * The API key that the relay route of a test app sends: the development key that the image
 * provisions, with every scope. An API of `TEMPO_API_URL` takes the key of `TEMPO_API_KEY` in its
 * place. The suite's own API never receives that variable's key, which can be a real one.
 */
export const apiKey =
  (external && process.env.TEMPO_API_KEY) || 'tempo:sk:admin'

/**
 * The private key of the dev genesis account that the node's faucet drips from. The API's sponsor
 * pays each relayed transaction's fees with it.
 */
export const feePayer =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

/** The image: `TEMPO_API_IMAGE`, or a commit of `tempoxyz/api`'s main branch. */
export const image =
  process.env.TEMPO_API_IMAGE ||
  'ghcr.io/tempoxyz/api-dev:0dea25edcab7f3a4b55443064bc9d81bc6807383'

/** The port that the container serves on, and publishes on the host. */
export const port = 9546

/** The image of the API's database. */
export const postgres = 'postgres:17-alpine'

/**
 * The tag of each test that takes the `tempoApi` fixture. A run that excludes the tag starts no
 * Tempo API, and pulls no image of it. The shards of `.github/workflows/verify.yml` name the tag.
 */
export const tag = '@tempo-api'

/** The Tempo API's URL: `TEMPO_API_URL`, or the container's. */
export const url = new URL(external ?? `http://127.0.0.1:${port}`).origin

/**
 * The container's command. It applies the migrations, seeds the local chain and the development
 * key, and starts the Worker on every interface, so the published port reaches it. The Worker's
 * entry is `src/index.ts`, since `src/dev.ts` also bundles the API's documentation, which holds
 * about 400 MB more.
 *
 * The image's `migrate` script builds the API's whole CLI, which reads its documentation commands
 * from a public host before it runs a command, so a failed read there fails the start. The command
 * applies the migrations as that script does, without the CLI, so the start reads only the node and
 * the database.
 */
const command = String.raw`set -e
pnpm --dir apps/api exec tsx --eval '
import("tapimo/server").then(async ({ Db }) => {
  const db = Db.postgres({ connectionString: process.env.DATABASE_URL })
  try { await db.migrate() } finally { await db.close() }
}).catch((error) => { console.error(error); process.exit(1) })
'
pnpm --dir apps/api seed:localnet
pnpm --dir apps/api seed:dev-key
exec pnpm --dir apps/api exec wrangler dev src/index.ts --ip 0.0.0.0 --port "$PORT" \
  --inspector-port "$INSPECTOR_PORT" --show-interactive-dev-session=false`

/**
 * Starts the API's database and the API over the suite's node, and waits until the API responds.
 * With `TEMPO_API_URL`, starts nothing, and checks the API at that URL, which must read the suite's
 * node itself. Returns `stop`. Throws if the API does not respond.
 */
export async function start(): Promise<start.ReturnType> {
  if (external) {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
    await response?.body?.cancel()
    if (!response?.ok)
      throw new Error(
        `The Tempo API at ${url} responded with ${response?.status ?? 'no response'} to its health check. Start an API there, or unset \`TEMPO_API_URL\`.`,
      )
    return { stop: () => Promise.resolve() }
  }

  await Promise.all([
    Images.pulled({ image }),
    Images.pulled({ image: postgres }),
  ])

  const network = await new Network().start()
  const database = await new GenericContainer(postgres)
    .withEnvironment({
      POSTGRES_DB: 'tempo_api',
      POSTGRES_PASSWORD: 'postgres',
    })
    .withNetwork(network)
    .withNetworkAliases('postgres')
    // Postgres restarts once after it creates the database, so its first log line is too early.
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections', 2),
    )
    .start()
    .catch(async (error: unknown) => {
      await network.stop()
      throw error
    })
  const stop = async () => {
    await database.stop()
    await network.stop()
  }

  const databaseUrl = 'postgres://postgres:postgres@postgres:5432/tempo_api'
  const rpcUrl = Chain.reachable(Chain.rpcUrl)
  const api = await new GenericContainer(image)
    .withCommand(['sh', '-c', command])
    .withEnvironment({
      CLICKHOUSE_URL: '',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE_CACHED:
        databaseUrl,
      DATABASE_URL: databaseUrl,
      ENVIRONMENT: 'development',
      FEE_PAYER_PRIVATE_KEY: feePayer,
      // Wrangler's esbuild is a Go process that holds a large heap. A more frequent collection holds
      // the container at about 1.1 GB. `GOMEMLIMIT` stalls the build in its place.
      GOGC: '25',
      INSPECTOR_PORT: String(port + 1),
      LOCALNET_RPC_URL: rpcUrl,
      MPP_ACCOUNT_PRIVATE_KEY: feePayer,
      MPP_SECRET_KEY: 'accounts-e2e-mpp-secret-at-least-32-bytes',
      PORT: String(port),
      RPC_URL: JSON.stringify({ [Chain.chain.id]: rpcUrl }),
      SENTRY_DSN: '',
      // The data routes serve a chain only when a TIDX URL names it. The sponsor reads only the node
      // and the database, so a URL where nothing listens takes the indexer's place.
      TIDX_URL: JSON.stringify({ [Chain.chain.id]: 'http://127.0.0.1:1' }),
    })
    .withExposedPorts({ container: port, host: port })
    .withExtraHosts([
      { host: 'host.docker.internal', ipAddress: 'host-gateway' },
    ])
    .withNetwork(network)
    // A fresh machine pulls the image first, and the API seeds the chain before it listens.
    .withStartupTimeout(5 * 60_000)
    .withWaitStrategy(Wait.forHttp('/health', port).forStatusCode(200))
    .start()
    .catch(async (error: unknown) => {
      await stop()
      throw error
    })

  return {
    stop: async () => {
      await api.stop()
      await stop()
    },
  }
}

export declare namespace start {
  type ReturnType = {
    /** Stops the containers that the suite started. */
    stop: () => Promise<void>
  }
}
