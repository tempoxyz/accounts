import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Base64, Hex, P256 } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'
import * as z from 'zod/mini'

import { Provider } from '../../src/cli/index.js'
import * as CliAuth from '../../src/server/CliAuth.js'

const args = new Set(process.argv.slice(2))
const pollIntervalMs = Number(process.env.CLI_AUTH_POLL_INTERVAL_MS || 2000)
const serviceUrl = getServiceUrl()
const timeoutMs = Number(process.env.CLI_AUTH_TIMEOUT_MS || 300000)
const requestOnly = args.has('--request')
type AccessKey = ReturnType<typeof createAccessKey>

const { account, file } = await loadAccessKey()

console.log(`accounts CLI auth smoke test`)
console.log(`serviceUrl: ${serviceUrl}`)
console.log(`access key file: ${file}`)
console.log(`access key address: ${account.address}`)
console.log(`access key public key: ${account.publicKey}`)
console.log(`approval UI: playground`)

if (requestOnly) {
  console.log(`mode: request`)
  await requestApproval()
  process.exit(0)
}

console.log(`waiting for browser approval...`)

const provider = Provider.create({
  open(url) {
    console.log(`browser URL: ${url}`)
    open(url)
  },
  pollIntervalMs,
  host: serviceUrl,
  testnet: true,
  timeoutMs,
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

  console.log(``)
  console.log(`wallet_connect result`)
  console.log(
    JSON.stringify(
      {
        account: connected?.address,
        keyAuthorization: connected?.capabilities.keyAuthorization,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(``)
  console.error(error)
  process.exitCode = 1
}

async function requestApproval() {
  const codeVerifier = createCodeVerifier()
  const codeChallenge = await createCodeChallenge(codeVerifier)
  const created = await post({
    body: {
      codeChallenge: codeChallenge,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      keyType: account.keyType,
      limits: [
        {
          limit: 1_000n,
          token: '0x20c0000000000000000000000000000000000001',
        },
      ],
      pubKey: account.publicKey,
    } satisfies z.output<typeof CliAuth.createRequest>,
    request: CliAuth.createRequest,
    response: CliAuth.createResponse,
    url: getApiUrl(serviceUrl, 'code'),
  })
  const url = getBrowserUrl(serviceUrl, created.code)

  console.log(`request created`)
  console.log(`device code: ${created.code}`)
  console.log(`browser URL: ${url}`)
}

function createAccessKey(privateKey: `0x${string}`) {
  return TempoAccount.fromP256(privateKey)
}

function getAccessKeyFile() {
  return 'tmp/cli-auth-demo/access-key.json'
}

async function loadAccessKey(): Promise<loadAccessKey.ReturnType> {
  const file = getAccessKeyFile()
  await mkdir(dirname(file), { recursive: true })

  let privateKey: `0x${string}`
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as { privateKey?: `0x${string}` }
    if (!value.privateKey) throw new Error('Missing private key.')
    privateKey = value.privateKey
  } catch {
    privateKey = P256.randomPrivateKey()
    await writeFile(file, JSON.stringify({ privateKey }, null, 2) + '\n', 'utf8')
  }

  return {
    account: createAccessKey(privateKey),
    file,
  }
}

declare namespace loadAccessKey {
  type ReturnType = {
    account: AccessKey
    file: string
  }
}

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

async function createCodeChallenge(codeVerifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true })
}

function createCodeVerifier() {
  return Base64.fromBytes(crypto.getRandomValues(new Uint8Array(32)), {
    pad: false,
    url: true,
  })
}

function getServiceUrl() {
  const value = process.env.CLI_AUTH_URL
  if (value) {
    const url = new URL(value)
    if (!url.pathname || url.pathname === '/') url.pathname = normalizePath(path())
    url.hash = ''
    return trimSlash(url.toString())
  }

  const protocol = process.env.CLI_AUTH_PROTOCOL ?? process.env.HTTP_PROTOCOL ?? 'https'
  const host = process.env.CLI_AUTH_HOST ?? process.env.HTTP_HOST ?? 'localhost'
  const port = process.env.CLI_AUTH_PORT ?? process.env.HTTP_PORT ?? '5173'
  const url = new URL(`${protocol}://${host}`)

  if (!isDefaultPort(protocol, port)) url.port = port

  url.pathname = normalizePath(path())
  return trimSlash(url.toString())
}

function isDefaultPort(protocol: string, port: string) {
  return (protocol === 'http' && port === '80') || (protocol === 'https' && port === '443')
}

function path() {
  return process.env.CLI_AUTH_PATH || '/cli-auth'
}

function trimSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function getApiUrl(serviceUrl: string, path: string) {
  const url = new URL(serviceUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  url.search = ''
  return url.toString()
}

function getBrowserUrl(serviceUrl: string, code: string) {
  const url = new URL(serviceUrl)
  url.searchParams.set('code', code)
  return url.toString()
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

function open(url: string) {
  const command =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] }

  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}
