import { parse } from '@bomb.sh/args'
import Tab from '@bomb.sh/tab'
import * as Clack from '@clack/prompts'
import { Provider } from 'accounts/cli'
import * as CliAuth from 'accounts/server'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Base64, Hex, P256 } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'
import * as z from 'zod/mini'

type AccessKey = ReturnType<typeof TempoAccount.fromP256>

// shell completions

const connectCmd = Tab.command('connect', 'Sign in / sign up via browser approval')
connectCmd.option('url', 'Auth service URL', (c) => c('http://localhost:6969/cli-auth', 'Local'))
connectCmd.option('key-file', 'Access key file path')

const requestCmd = Tab.command('request', 'Authorize an access key')
requestCmd.option('url', 'Auth service URL', (c) => c('http://localhost:6969/cli-auth', 'Local'))
requestCmd.option('key-file', 'Access key file path')

if (process.argv[2] === 'complete') {
  const [, , , shell] = process.argv
  if (shell === '--') Tab.parse(process.argv.slice(4))
  else if (shell) Tab.setup('tempo-cli', 'pnpm tsx scripts/cli.ts', shell)
  else console.log('Usage: tempo-cli complete <shell|-->')
  process.exit(0)
}

// args

const args = parse(process.argv.slice(2), {
  string: ['url', 'key-file'],
  boolean: ['help'],
  alias: { h: 'help', u: 'url', k: 'key-file' },
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
    -u, --url <url>        Auth service URL
    -k, --key-file <path>  Access key file path
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
      accessKey: async () => {
        const keyFile = args['key-file'] ?? 'tmp/cli-auth-demo/access-key.json'
        return loadAccessKey(keyFile)
      },
    },
    { onCancel: () => cancel() },
  )

  const { serviceUrl } = setup
  const { account, file } = setup.accessKey

  Clack.box(
    [
      `address     ${dim(account.address)}`,
      `public key  ${dim(truncate(account.publicKey, 24))}`,
      `key file    ${dim(file)}`,
      `service     ${dim(serviceUrl)}`,
    ].join('\n'),
    'Access Key',
  )

  // Single command mode
  if (command) {
    if (command === 'connect') await connectFlow(serviceUrl, account)
    else await authorizeFlow(serviceUrl, account)
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
      await connectFlow(serviceUrl, account)
      browserOpened = true
    } else {
      await authorizeFlow(serviceUrl, account)
    }
  }
}

// flows

async function connectFlow(serviceUrl: string, account: AccessKey) {
  const task = Clack.taskLog({ title: 'Sign in' })

  const provider = Provider.create({
    open(url) {
      task.message(`Device code created`)
      task.message(`Opening ${url}`)
      openBrowser(url)
      task.message('Waiting for passkey approval…')
    },
    pollIntervalMs: 2_000,
    host: serviceUrl,
    testnet: true,
    timeoutMs: 300_000,
  })

  try {
    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: accessKeyParams(account),
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

async function authorizeFlow(serviceUrl: string, account: AccessKey) {
  const task = Clack.taskLog({ title: 'Authorize access key' })

  const codeVerifier = createCodeVerifier()
  const codeChallenge = await createCodeChallenge(codeVerifier)

  task.message('Creating device code…')

  const created = await post({
    body: {
      codeChallenge,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      keyType: account.keyType,
      limits: [{ limit: 1_000n, token: '0x20c0000000000000000000000000000000000001' as const }],
      pubKey: account.publicKey,
    } satisfies z.output<typeof CliAuth.CliAuth.createRequest>,
    request: CliAuth.CliAuth.createRequest,
    response: CliAuth.CliAuth.createResponse,
    url: apiUrl(serviceUrl, 'code'),
  })

  task.message(`Code: ${bold(created.code)}`)
  task.message(`URL: ${browserUrl(serviceUrl, created.code)}`)
  task.message('Waiting for passkey approval…')

  const startedAt = Date.now()
  while (Date.now() - startedAt < 300_000) {
    const result = await post({
      body: { codeVerifier } satisfies z.output<typeof CliAuth.CliAuth.pollRequest>,
      request: CliAuth.CliAuth.pollRequest,
      response: CliAuth.CliAuth.pollResponse,
      url: apiUrl(serviceUrl, `poll/${created.code}`),
    })

    if (result.status === 'pending') {
      await sleep(2_000)
      continue
    }

    if (result.status === 'expired') {
      task.error('Device code expired.')
      return
    }

    task.success(`Authorized by ${result.accountAddress}`)
    if (result.keyAuthorization) await logKeyAuthorization(result.keyAuthorization)
    return
  }

  task.error('Timed out waiting for approval.')
}

// access key

function accessKeyParams(account: AccessKey) {
  return {
    expiry: Math.floor(Date.now() / 1000) + 3600,
    keyType: account.keyType,
    limits: [
      {
        limit: Hex.fromNumber(1_000),
        token: '0x20c0000000000000000000000000000000000001' as const,
      },
    ],
    publicKey: account.publicKey,
  }
}

async function loadAccessKey(file: string) {
  await mkdir(dirname(file), { recursive: true })

  let privateKey: `0x${string}`
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as { privateKey?: `0x${string}` }
    if (!value.privateKey) throw new Error('missing private key')
    privateKey = value.privateKey
  } catch {
    privateKey = P256.randomPrivateKey()
    await writeFile(file, JSON.stringify({ privateKey }, null, 2) + '\n', 'utf8')
  }

  return { account: TempoAccount.fromP256(privateKey), file }
}

// url resolution

async function resolveServiceUrl(): Promise<string> {
  if (args.url) return trimSlash(args.url)

  const defaultUrl = resolveDefaultUrl()
  const target = await Clack.select({
    message: 'Auth service',
    options: [
      { value: 'local', label: defaultUrl, hint: 'local dev' },
      { value: 'tailscale', label: 'https://o-1.tail388b2e.ts.net/cli-auth', hint: 'tailscale' },
      { value: 'custom', label: 'Custom URL…' },
    ],
  })

  if (Clack.isCancel(target)) return cancel()

  if (target === 'tailscale') return 'https://o-1.tail388b2e.ts.net/cli-auth'
  if (target !== 'custom') return trimSlash(defaultUrl)

  const input = await Clack.text({
    message: 'Auth service URL',
    placeholder: 'https://example.com/cli-auth',
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
  const value = process.env.HTTP_URL
  if (value) {
    const url = new URL(value)
    if (!url.pathname || url.pathname === '/') url.pathname = '/cli-auth'
    url.hash = ''
    return trimSlash(url.toString())
  }

  const protocol = process.env.HTTP_PROTOCOL ?? 'http'
  const host = process.env.HTTP_HOST ?? 'localhost'
  const port = process.env.HTTP_PORT ?? '6969'
  const url = new URL(`${protocol}://${host}`)
  if (!isDefaultPort(protocol, port)) url.port = port
  url.pathname = '/cli-auth'
  return trimSlash(url.toString())
}

// helpers

function cancel(): never {
  Clack.cancel('Cancelled.')
  process.exit(0)
}

function apiUrl(serviceUrl: string, path: string) {
  const url = new URL(serviceUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  url.search = ''
  return url.toString()
}

function browserUrl(serviceUrl: string, code: string) {
  const url = new URL(serviceUrl)
  url.searchParams.set('code', code)
  return url.toString()
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

function truncate(value: string, length = 20) {
  return value.length <= length ? value : `${value.slice(0, length)}…${value.slice(-6)}`
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

function bold(value: string) {
  return `\x1b[1m${value}\x1b[22m`
}

function dim(value: string) {
  return `\x1b[2m${value}\x1b[22m`
}

async function createCodeChallenge(codeVerifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true })
}

function createCodeVerifier() {
  return Base64.fromBytes(crypto.getRandomValues(new Uint8Array(32)), { pad: false, url: true })
}

async function post<
  const request extends z.ZodMiniType,
  const response extends z.ZodMiniType,
>(options: {
  body: z.output<request>
  request: request
  response: response
  url: string
}): Promise<z.output<response>> {
  const result = await fetch(options.url, {
    body: JSON.stringify(z.encode(options.request, options.body)),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const json = (await result.json().catch(() => ({}))) as z.input<response>
  if (!result.ok) throw new Error(((json as { error?: string }).error ?? 'Request failed.').trim())
  return z.decode(options.response, json)
}

// run

main().catch((error) => {
  Clack.log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
