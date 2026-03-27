import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Hex, P256 } from 'ox'
import { Account as TempoAccount } from 'viem/tempo'

import { Provider } from '../../src/cli/index.js'

const host = process.env.CLI_AUTH_HOST || 'localhost'
const path = normalizePath(process.env.CLI_AUTH_PATH || '/cli-auth')
const pollIntervalMs = Number(process.env.CLI_AUTH_POLL_INTERVAL_MS || 2000)
const port = Number(process.env.CLI_AUTH_PORT || 5173)
const protocol = process.env.CLI_AUTH_PROTOCOL || 'https'
const serviceUrl = `${protocol}://${host}:${port}${path}`
const timeoutMs = Number(process.env.CLI_AUTH_TIMEOUT_MS || 300000)
type AccessKey = ReturnType<typeof createAccessKey>

const { account, file } = await loadAccessKey()

console.log(`tempodk CLI auth smoke test`)
console.log(`serviceUrl: ${serviceUrl}`)
console.log(`access key file: ${file}`)
console.log(`access key address: ${account.address}`)
console.log(`access key public key: ${account.publicKey}`)
console.log(`approval UI: playground`)
console.log(`waiting for browser approval...`)

const provider = Provider.create({
  open(url) {
    console.log(`browser URL: ${url}`)
    open(url)
  },
  pollIntervalMs,
  serviceUrl,
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
