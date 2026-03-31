import { parse } from '@bomb.sh/args'
import Tab from '@bomb.sh/tab'
import * as Clack from '@clack/prompts'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Hex, Json } from 'ox'

import * as CliProvider from '../../src/cli/Provider.js'
import * as core_Storage from '../../src/core/Storage.js'

// shell completions

const defaultUrl = resolveDefaultUrl()

const connectCmd = Tab.command('connect', 'Sign in / sign up via browser approval')
connectCmd.option('url', 'Wallet URL', (c) => c(defaultUrl, 'Default'))
connectCmd.option('limit', 'Spend limit (raw token units)', (c) => c('1000', 'Default'))
connectCmd.option('expiry', 'Authorization lifetime in seconds', (c) => c('3600', 'Default'))

const requestCmd = Tab.command('request', 'Authorize an access key')
requestCmd.option('url', 'Wallet URL', (c) => c(defaultUrl, 'Default'))
requestCmd.option('limit', 'Spend limit (raw token units)', (c) => c('1000', 'Default'))
requestCmd.option('expiry', 'Authorization lifetime in seconds', (c) => c('3600', 'Default'))

if (process.argv[2] === 'complete') {
  const [, , , shell] = process.argv
  if (shell === '--') Tab.parse(process.argv.slice(4))
  else if (shell) Tab.setup('tempo-cli', 'pnpm tsx scripts/cli.ts', shell)
  else console.log('Usage: tempo-cli complete <shell|-->')
  process.exit(0)
}

// args

const args = parse(process.argv.slice(2), {
  string: ['url', 'limit', 'expiry'],
  boolean: ['help'],
  alias: { h: 'help', u: 'url' },
})

if (args.help) {
  console.log(`
  tempo · cli auth

  Usage
    pnpm cli [command] [options]

  Commands
    connect       Sign in / sign up via browser (default)
    request       Authorize an access key

  Options
    -u, --url <url>        Wallet URL
    --limit <raw>          Spend limit in raw token units
    --expiry <seconds>     Authorization lifetime in seconds
    -h, --help             Show this help

  Shell Completions
    source <(pnpm tsx scripts/cli.ts complete zsh)
`)
  process.exit(0)
}

const command = args._[0] as string | undefined

if (command && command !== 'connect' && command !== 'request') {
  console.error(`Unknown command: ${command}. Try: connect, request`)
  process.exit(1)
}

// main

async function main() {
  Clack.intro('tempo')

  const setup = await Clack.group(
    {
      serviceUrl: () => resolveServiceUrl(),
    },
    { onCancel: () => cancel() },
  )

  const { serviceUrl } = setup
  const storage = fileStorage('tmp/cli-auth-demo/provider-state.json')

  Clack.box(`wallet  ${dim(serviceUrl)}`, 'Wallet')

  // Single command mode
  if (command) {
    if (command === 'connect') await connectFlow(serviceUrl, storage)
    else await authorizeFlow(serviceUrl, storage)
    Clack.outro('Done')
    return
  }

  // Interactive menu loop
  let browserOpened = false

  while (true) {
    const action = await Clack.select({
      message: 'What would you like to do?',
      options: [
        ...(!browserOpened
          ? [{ value: 'connect' as const, label: 'Sign in / Sign up', hint: 'opens browser' }]
          : []),
        {
          value: 'authorize',
          label: 'Authorize access key',
          hint: browserOpened ? 'uses open browser tab' : 'creates code + waits for browser',
        },
        { value: 'quit', label: 'Quit' },
      ],
    })

    if (Clack.isCancel(action) || action === 'quit') {
      Clack.outro('bye 👋')
      return
    }

    if (action === 'connect') {
      await connectFlow(serviceUrl, storage)
      browserOpened = true
    } else {
      await authorizeFlow(serviceUrl, storage)
    }
  }
}

// flows

async function connectFlow(serviceUrl: string, storage: core_Storage.Storage) {
  const task = Clack.taskLog({ title: 'Sign in' })
  configureLocalTls(serviceUrl)

  const provider = createProvider(serviceUrl, task, storage)

  try {
    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: authorizationParams(),
          },
        },
      ],
    })

    const connected = result.accounts[0]
    task.success(connected?.address ? `Signed in as ${connected.address}` : 'Signed in')

    if (connected?.capabilities.keyAuthorization)
      await logKeyAuthorization(connected.capabilities.keyAuthorization)
  } catch (error) {
    task.error(error instanceof Error ? error.message : String(error))
  }
}

async function authorizeFlow(serviceUrl: string, storage: core_Storage.Storage) {
  const task = Clack.taskLog({ title: 'Authorize access key' })
  configureLocalTls(serviceUrl)

  const provider = createProvider(serviceUrl, task, storage)

  try {
    const result = await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [authorizationParams()],
    })

    task.success(`Authorized by ${result.rootAddress}`)
    await logKeyAuthorization(result.keyAuthorization)
  } catch (error) {
    task.error(error instanceof Error ? error.message : String(error))
  }
}

function authorizationParams() {
  const expiry = Number.parseInt(args.expiry ?? '3600', 10)
  const limit = BigInt(args.limit ?? '1000')

  if (!Number.isFinite(expiry) || expiry <= 0)
    throw new Error('`--expiry` must be a positive number of seconds.')
  if (limit <= 0n) throw new Error('`--limit` must be a positive integer.')

  return {
    expiry: Math.floor(Date.now() / 1000) + expiry,
    limits: [
      {
        limit: Hex.fromNumber(limit),
        token: '0x20c0000000000000000000000000000000000001' as const,
      },
    ],
  }
}

function createProvider(
  serviceUrl: string,
  task: ReturnType<typeof Clack.taskLog>,
  storage: core_Storage.Storage,
) {
  return CliProvider.create({
    // Use local source modules in the example so workspace edits take effect
    // without rebuilding `dist/`.
    open(url) {
      task.message('Device code created')
      task.message(`Opening ${url}`)
      openBrowser(url)
      task.message('Waiting for passkey approval…')
    },
    pollIntervalMs: 2_000,
    host: serviceUrl,
    storage,
    testnet: true,
    timeoutMs: 300_000,
  })
}

// url resolution

async function resolveServiceUrl(): Promise<string> {
  if (args.url) return trimSlash(args.url)

  const target = await Clack.select({
    message: 'Wallet',
    options: [
      { value: 'default', label: defaultUrl, hint: 'default' },
      { value: 'custom', label: 'Custom URL…' },
    ],
  })

  if (Clack.isCancel(target)) return cancel()
  if (target === 'default') return defaultUrl

  const input = await Clack.text({
    message: 'Wallet URL',
    placeholder: 'https://wallet.example.com/embed/cli-auth',
    validate: (v) => {
      if (!v) return 'URL is required'
      try {
        new URL(v)
      } catch {
        return 'Invalid URL'
      }
      return
    },
  })

  if (Clack.isCancel(input)) return cancel()
  return trimSlash(input)
}

function resolveDefaultUrl() {
  const value = process.env.WALLET_URL ?? process.env.AUTH_URL
  if (value) {
    return normalizeWalletUrl(value)
  }

  const protocol = process.env.WALLET_PROTOCOL ?? process.env.AUTH_PROTOCOL ?? 'https'
  const host = process.env.WALLET_HOST ?? process.env.AUTH_HOST ?? 'app.moderato.tempo.local'
  const port = process.env.WALLET_PORT ?? process.env.AUTH_PORT ?? '3001'
  const url = new URL(`${protocol}://${host}`)
  if (!isDefaultPort(protocol, port)) url.port = port
  return normalizeWalletUrl(url.toString())
}

// helpers

function cancel(): never {
  Clack.cancel('Cancelled.')
  process.exit(0)
}

function normalizeWalletUrl(value: string) {
  const url = new URL(value)
  if (!url.pathname || url.pathname === '/') url.pathname = '/embed/cli-auth'
  url.hash = ''
  url.search = ''
  return trimSlash(url.toString())
}

function openBrowser(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] }
  const child = spawn(cmd.command, cmd.args, { detached: true, stdio: 'ignore' })
  child.unref()
}

function isDefaultPort(protocol: string, port: string) {
  return (protocol === 'http' && port === '80') || (protocol === 'https' && port === '443')
}

function trimSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function configureLocalTls(serviceUrl: string) {
  const { hostname, protocol } = new URL(serviceUrl)
  if (protocol !== 'https:') return
  if (!isLocalHostname(hostname)) return
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')
}

function fileStorage(file: string): core_Storage.Storage {
  async function read() {
    try {
      return Json.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  async function write(value: Record<string, unknown>) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, Json.stringify(value, null, 2) + '\n', 'utf8')
  }

  return {
    async getItem(name) {
      const value = (await read())[name]
      return value === undefined ? null : value
    },
    async removeItem(name) {
      const value = await read()
      delete value[name]
      await write(value)
    },
    async setItem(name, value) {
      await write({ ...(await read()), [name]: value })
    },
  }
}

async function logKeyAuthorization(auth: Record<string, unknown>) {
  const keyId = auth.keyId ?? auth.key_id ?? auth.address
  const keyType = auth.keyType ?? '?'
  const chainId = auth.chainId ?? auth.chain_id ?? '?'
  const expiry = auth.expiry
  const sig = (auth.signature as Record<string, unknown> | undefined)?.type ?? '?'

  Clack.box(
    [
      `key      ${dim(String(keyId))}`,
      `type     ${dim(String(keyType))}`,
      `chain    ${dim(String(chainId))}`,
      `expiry   ${dim(String(expiry))}`,
      `sig      ${dim(String(sig))}`,
    ].join('\n'),
    'Key Authorization',
  )

  const show = await Clack.confirm({ message: 'Show full payload?', initialValue: false })
  if (show === true) Clack.log.message(jsonStringify(auth))
}

function jsonStringify(value: unknown) {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}

function dim(value: string) {
  return `\x1b[2m${value}\x1b[22m`
}

// run

main().catch((error) => {
  Clack.log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
