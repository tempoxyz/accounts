import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Hex, Json } from 'ox'

import * as CliProvider from '../../src/cli/Provider.js'

type Command = 'connect' | 'request'

const args = process.argv.slice(2)
const command = parseCommand(args[0])
const walletUrl = resolveWalletUrl(readFlag(args, 'url') ?? process.env.WALLET_URL)
const limit = parseLimit(readFlag(args, 'limit') ?? '1000')
const expiry = parseExpiry(readFlag(args, 'expiry') ?? '3600')

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  configureLocalTls(walletUrl)

  const provider = CliProvider.create({
    host: walletUrl,
    open(url) {
      console.log(`open ${url}`)
      openBrowser(url)
    },
    storage: fileStorage('tmp/cli-auth-demo/provider-state.json'),
    testnet: true,
  })

  const params = {
    expiry: Math.floor(Date.now() / 1000) + expiry,
    limits: [
      {
        limit: Hex.fromNumber(limit),
        token: '0x20c0000000000000000000000000000000000001' as const,
      },
    ],
  }

  if (command === 'request') {
    const result = await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [params],
    })
    console.log(Json.stringify(result, null, 2))
    return
  }

  const result = await provider.request({
    method: 'wallet_connect',
    params: [{ capabilities: { authorizeAccessKey: params } }],
  })
  console.log(Json.stringify(result, null, 2))
}

function parseCommand(value: string | undefined): Command {
  if (!value || value === 'connect') return 'connect'
  if (value === 'request') return 'request'
  throw new Error(
    'Usage: pnpm -C playgrounds/cli [connect|request] [--url=...] [--limit=...] [--expiry=...]',
  )
}

function readFlag(args: readonly string[], name: string) {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function parseExpiry(value: string) {
  const result = Number.parseInt(value, 10)
  if (!Number.isFinite(result) || result <= 0)
    throw new Error('`--expiry` must be a positive number of seconds.')
  return result
}

function parseLimit(value: string) {
  const result = BigInt(value)
  if (result <= 0n) throw new Error('`--limit` must be a positive integer.')
  return result
}

function resolveWalletUrl(value: string | undefined) {
  const url = new URL(value ?? 'https://wallet.tempo.xyz')
  if (!url.pathname || url.pathname === '/') url.pathname = '/embed/cli-auth'
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
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

function fileStorage(file: string) {
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
    async getItem<value>(name: string) {
      const data = await read()
      return (data[name] as value | undefined) ?? null
    },
    async removeItem(name: string) {
      const data = await read()
      delete data[name]
      await write(data)
    },
    async setItem(name: string, value: unknown) {
      await write({ ...(await read()), [name]: value })
    },
  }
}
