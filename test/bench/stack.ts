/**
 * Starts the bench's stack, and holds it until the process ends: one local Tempo node, the `id-dev`
 * image of Tempo ID with the bench's registrations, and the MPP merchant of `test/apps/mpp`. Each
 * trial of the bench runs against it, at the URLs of `Tasks.stack`.
 *
 * ```sh
 * node test/bench/stack.ts
 * ```
 * @module
 */
import * as ChildProcess from 'node:child_process'
import { Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { GenericContainer, Wait } from 'testcontainers'
import { createClient, http } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import * as Tasks from './Tasks.ts'

const nodeImage =
  process.env.TEMPO_NODE_IMAGE || 'ghcr.io/tempoxyz/tempo:latest'
const idImage =
  process.env.TEMPO_ID_IMAGE ||
  'ghcr.io/tempoxyz/id-dev:d130cf0d808bce2e3047044231923597b9510bbd'

const node = Server.create({
  instance: TestContainers.Instance.tempo({
    blockTime: '50ms',
    // prool passes `--engine.legacy-state-root` unless the value is `undefined`. The node no longer
    // accepts the flag.
    engine: { legacyStateRoot: undefined },
    faucet: {
      address: [
        '0x20c0000000000000000000000000000000000000',
        '0x20c0000000000000000000000000000000000001',
        '0x20c0000000000000000000000000000000000002',
        '0x20c0000000000000000000000000000000000003',
        Tasks.ousd,
      ],
    },
    image: nodeImage,
    port: Number(new URL(Tasks.stack.rpcUrl).port),
  }),
  port: Number(new URL(Tasks.stack.rpcUrl).port),
})
await node.start()

const client = createClient({
  chain: tempoLocalnet,
  transport: http(Tasks.stack.rpcUrl),
})
const deadline = Date.now() + 5 * 60_000
while (true) {
  const id = await client
    .request({ method: 'eth_chainId' })
    .catch(() => undefined)
  if (id) break
  if (Date.now() > deadline) throw new Error('The Tempo node did not start.')
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

// A container reaches a service of the host at the host's gateway.
const reachable = (url: string) =>
  url.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal')

const id = await new GenericContainer(idImage)
  .withEnvironment({
    ID_DEV_APPS: JSON.stringify(Tasks.registrations),
    ID_DEV_RESOURCES: '[]',
    RPC_URLS: `local:${tempoLocalnet.id}=${reachable(Tasks.stack.rpcUrl)}`,
  })
  .withExposedPorts({ container: 8787, host: 8787 })
  .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
  .withStartupTimeout(5 * 60_000)
  .withWaitStrategy(Wait.forHttp('/__id-dev/health', 8787).forStatusCode(204))
  .start()

await Promise.all(
  [Tasks.stack.feePayer, Tasks.stack.payee].map((privateKey) =>
    Actions.faucet.fundSync(client, {
      account: privateKeyToAddress(privateKey),
    }),
  ),
)

const merchant = ChildProcess.spawn(
  'pnpm',
  ['--filter', 'test-app-mpp', 'start'],
  {
    env: {
      ...process.env,
      MPP_AMOUNTS: JSON.stringify({
        charge: '0.01',
        chargeLarge: '150',
        chargeMedium: '2',
        session: '0.01',
        sessionDeposit: '0.03',
        subscription: '0.01',
      }),
      MPP_PRIVATE_KEY: Tasks.stack.payee,
      MPP_SECRET_KEY: 'accounts-bench-mpp-secret-key-of-the-stack',
      PORT: new URL(Tasks.stack.merchantUrl).port,
      TEMPO_RPC_URL: Tasks.stack.rpcUrl,
    },
    stdio: 'inherit',
  },
)

process.stdout.write(
  `The stack serves: Tempo ID at ${Tasks.stack.tempoIdUrl}, the node at ${Tasks.stack.rpcUrl}, the merchant at ${Tasks.stack.merchantUrl}.\n`,
)

const stop = async () => {
  merchant.kill()
  await id.stop()
  await node.stop()
  process.exit(0)
}
// `stop` ends the process, so no caller awaits it.
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
