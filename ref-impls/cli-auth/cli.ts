import { Expiry, Storage } from 'accounts'
import { Provider } from 'accounts/cli'
import { Cli, z } from 'incur'
import { pathToFileURL } from 'node:url'
import { Hex } from 'ox'
import { tempoMainnet, tempoTestnet, tempoDevnet } from 'viem/chains'
import { connect } from 'viem/experimental/erc7846'

const defaultHost = 'https://wallet-next.tempo.xyz/api/auth/cli' as const
const defaultToken = '0x20c0000000000000000000000000000000000000' as const

const options = z.object({
  host: z.string().default(defaultHost).describe('CLI auth host URL'),
  chain: z
    .string()
    .check((ctx) => {
      if (['mainnet', 'testnet', 'devnet'].includes(ctx.value)) return
      ctx.issues.push({ code: 'custom', input: ctx.value })
    })
    .default('mainnet')
    .describe('Tempo Chain: mainnet, testnet, devnet'),
  limit: z
    .number()
    .int()
    .refine((value) => value > 0, '`--limit` must be a positive integer.')
    .default(1_000)
    .describe('Token spend limit'),
  expiry: z
    .number()
    .int()
    .refine((value) => value > 0, '`--expiry` must be a positive number of seconds.')
    .default(3_600)
    .describe('Access-key expiry in seconds'),
  token: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, '`--token` must be a hex string.')
    .default(defaultToken)
    .describe('TIP-20 token address for the spend limit'),
})

/** Tempo accounts/cli auth reference implementation CLI. */
const cli = Cli.create('accounts-cli')
  .command('connect', {
    description: 'Connect to the CLI auth provider',
    options,
    async run({ options }) {
      configureLocalTls(options.host)

      const chain =
        options.chain === 'mainnet'
          ? tempoMainnet
          : options.chain === 'testnet'
            ? tempoTestnet
            : tempoDevnet

      const provider = Provider.create({
        host: options.host,
        storage: Storage.memory(),
        testnet: chain.testnet,
      })
      const authorizeAccessKey = {
        expiry: Expiry.seconds(options.expiry),
        limits: [
          {
            limit: Hex.fromNumber(options.limit),
            token: options.token as Hex.Hex,
          },
        ],
      }

      const client = provider.getClient()
      return connect(client, {
        capabilities: {
          authorizeAccessKey,
        },
      })
    },
  })
  .command('request', {
    description: 'Request a new access key from the CLI auth provider',
    options,
    async run({ options }) {
      configureLocalTls(options.host)
      const chain =
        options.chain === 'mainnet'
          ? tempoMainnet
          : options.chain === 'testnet'
            ? tempoTestnet
            : tempoDevnet

      const provider = Provider.create({
        host: options.host,
        storage: Storage.memory(),
        testnet: chain.testnet,
      })
      const authorizeAccessKey = {
        expiry: Expiry.seconds(options.expiry),
        limits: [
          {
            limit: Hex.fromNumber(options.limit),
            token: options.token as Hex.Hex,
          },
        ],
      }

      return provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [authorizeAccessKey],
      })
    },
  })
export default cli

function configureLocalTls(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:') return
  if (
    url.hostname !== 'localhost' &&
    url.hostname !== '127.0.0.1' &&
    !url.hostname.endsWith('.local')
  )
    return
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

function isMain() {
  const [, entry] = process.argv
  if (!entry) return false
  return import.meta.url === pathToFileURL(entry).href
}

if (isMain()) void cli.serve()
