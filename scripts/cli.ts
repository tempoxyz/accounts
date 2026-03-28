import { parse } from '@bomb.sh/args'
import Tab from '@bomb.sh/tab'
import * as Clack from '@clack/prompts'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Base64, Hex, P256 } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'
import * as z from 'zod/mini'

import { Provider } from '../src/cli/index.js'
import * as CliAuth from '../src/server/CliAuth.js'

type AccessKey = ReturnType<typeof TempoAccount.fromP256>

const connectCmd = Tab.command('connect', 'Sign in / sign up via browser approval')
connectCmd.option('url', 'Auth service URL', (complete) => {
  complete('http://localhost:5173/cli-auth', 'Local dev server')
})
connectCmd.option('key-file', 'Access key file path')

const requestCmd = Tab.command('request', 'Create device code only')
requestCmd.option('url', 'Auth service URL', (complete) => {
  complete('http://localhost:5173/cli-auth', 'Local dev server')
})
requestCmd.option('key-file', 'Access key file path')

if (process.argv[2] === 'complete') {
  const shell = process.argv[3]
  if (shell === '--') Tab.parse(process.argv.slice(4))
  else if (shell) Tab.setup('tempo-cli', 'node playground/scripts/cli.ts', shell)
  else console.log('Usage: tempo-cli complete <shell|-->')
  process.exit(0)
}

const args = parse(process.argv.slice(2), {
  string: ['url', 'key-file'],
  boolean: ['help'],
  alias: { h: 'help', u: 'url', k: 'key-file' },
})

if (args.help) {
  console.log(`
  tempo · cli auth

  Usage
    node playground/scripts/cli.ts [command] [options]

  Commands
    connect              Sign in / sign up (interactive default)
    request              Create device code only

  Options
    -u, --url <url>        Auth service URL
    -k, --key-file <path>  Access key file path
    -h, --help             Show this help

  Shell Completions
    source <(node playground/scripts/cli.ts complete zsh)
`)
  process.exit(0)
}

const command = args._[0] as string | undefined

if (command && command !== 'connect' && command !== 'request') {
  console.error(`Unknown command: ${command}`)
  console.error('Available commands: connect, request')
  process.exit(1)
}

async function main() {
  console.info('')
  Clack.intro('Tempo Accounts SDK - CLI Auth', { withGuide: true })

  const defaultUrl = resolveDefaultUrl()

  let serviceUrl: string

  if (args.url) {
    serviceUrl = trimSlash(args.url)
  } else {
    const target = await Clack.select({
      message: 'Auth service URL',
      options: [
        { value: 'local', label: defaultUrl, hint: 'localhost' },
        { value: 'tailscale', label: 'https://o-1.tail388b2e.ts.net/cli-auth', hint: 'tailscale' },
        { value: 'custom', label: 'Enter a URL' },
      ],
    })

    if (Clack.isCancel(target)) {
      Clack.cancel('Cancelled.')
      return
    }

    if (target === 'custom') {
      const input = await Clack.text({
        message: 'Auth service URL',
        placeholder: 'https://example.com/cli-auth',
        validate(value) {
          if (!value) return 'URL is required'
          try {
            new URL(value)
          } catch {
            return 'enter a valid URL'
          }
        },
      })

      if (Clack.isCancel(input)) {
        Clack.cancel('Cancelled.')
        return
      }

      serviceUrl = trimSlash(input)
    } else if (target === 'tailscale') {
      serviceUrl = 'https://o-1.tail388b2e.ts.net/cli-auth'
    } else {
      serviceUrl = trimSlash(defaultUrl)
    }
  }

  const mode =
    command ??
    (await Clack.select({
      message: 'What would you like to do?',
      options: [
        {
          value: 'connect',
          label: 'Sign in / Sign up',
          hint: 'full device-code flow with browser',
        },
        { value: 'request', label: 'Send request', hint: 'authorize w/ access key' },
      ],
    }))

  if (Clack.isCancel(mode)) {
    Clack.cancel('Cancelled.')
    return
  }

  const keyFile = args['key-file'] ?? 'tmp/cli-auth-demo/access-key.json'
  const { account, file } = await loadAccessKey(keyFile)

  Clack.note(
    [
      `address      ${account.address}`,
      `public key   ${truncate(account.publicKey)}`,
      `key file     ${file}`,
      `service      ${serviceUrl}`,
    ].join('\n'),
    'access key',
  )

  if (mode === 'request') await submitRequest(serviceUrl, account)
  else await connectFlow(serviceUrl, account)

  Clack.outro('done')
}

async function submitRequest(serviceUrl: string, account: AccessKey) {
  const s = Clack.spinner()
  s.start('Creating device code')

  const codeVerifier = createCodeVerifier()
  const codeChallenge = await createCodeChallenge(codeVerifier)

  const created = await post({
    body: {
      code_challenge: codeChallenge,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      key_type: account.keyType,
      limits: [{ limit: 1_000n, token: '0x20c0000000000000000000000000000000000001' }],
      pub_key: account.publicKey,
    } satisfies z.output<typeof CliAuth.createRequest>,
    request: CliAuth.createRequest,
    response: CliAuth.createResponse,
    url: apiUrl(serviceUrl, 'device-code'),
  })

  s.stop('Device code created')

  Clack.note(
    [`code   ${created.code}`, `url    ${browserUrl(serviceUrl, created.code)}`].join('\n'),
    'request',
  )
}

async function connectFlow(serviceUrl: string, account: AccessKey) {
  const s = Clack.spinner()
  s.start('Creating device code')

  const provider = Provider.create({
    open(url) {
      s.stop('Device code created')
      Clack.log.info(url)
      openBrowser(url)
      s.start('Waiting for approval in browser')
    },
    pollIntervalMs: 2_000,
    serviceUrl,
    testnet: true,
    timeoutMs: 300_000,
  })

  try {
    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: {
              expiry: Math.floor(Date.now() / 1000) + 3600,
              keyType: account.keyType,
              limits: [
                {
                  limit: Hex.fromNumber(1_000),
                  token: '0x20c0000000000000000000000000000000000001',
                },
              ],
              publicKey: account.publicKey,
            },
          },
        },
      ],
    })

    const connected = result.accounts[0]
    s.stop(`Signed in as ${connected?.address}`)

    if (connected?.capabilities.keyAuthorization)
      Clack.note(
        JSON.stringify(connected.capabilities.keyAuthorization, null, 2),
        'key authorization',
      )
  } catch (error) {
    s.stop('Failed')
    Clack.log.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function createAccessKey(privateKey: `0x${string}`) {
  return TempoAccount.fromP256(privateKey)
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

  return { account: createAccessKey(privateKey), file }
}

function resolveDefaultUrl() {
  const value = process.env.CLI_AUTH_URL
  if (value) {
    const url = new URL(value)
    if (!url.pathname || url.pathname === '/') url.pathname = normalizePath(basePath())
    url.hash = ''
    return trimSlash(url.toString())
  }

  const protocol = process.env.CLI_AUTH_PROTOCOL ?? process.env.HTTP_PROTOCOL ?? 'http'
  const host = process.env.CLI_AUTH_HOST ?? process.env.HTTP_HOST ?? 'localhost'
  const port = process.env.CLI_AUTH_PORT ?? process.env.HTTP_PORT ?? '6969'
  const url = new URL(`${protocol}://${host}`)
  if (!isDefaultPort(protocol, port)) url.port = port
  url.pathname = normalizePath(basePath())
  return trimSlash(url.toString())
}

function isDefaultPort(protocol: string, port: string) {
  return (protocol === 'http' && port === '80') || (protocol === 'https' && port === '443')
}

function basePath() {
  return process.env.CLI_AUTH_PATH || '/cli-auth'
}

function normalizePath(p: string) {
  return p.startsWith('/') ? p : `/${p}`
}

function trimSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
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

function truncate(value: string, length = 20) {
  if (value.length <= length) return value
  return `${value.slice(0, length)}…${value.slice(-6)}`
}

main().catch((error) => {
  Clack.log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
