import { Provider } from 'accounts/cli'
import { spawn } from 'node:child_process'
import { Hex, Json } from 'ox'

type Command = 'connect' | 'request'

const args = process.argv.slice(2)
const command = parseCommand(args[0])
const host = readFlag(args, 'url') ?? 'http://localhost:5173/cli-auth'
const expiry = parseExpiry(readFlag(args, 'expiry') ?? '3600')
const limit = parseLimit(readFlag(args, 'limit') ?? '1000')

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  const provider = Provider.create({
    host,
    keysPath: 'tmp/cli-auth-demo/keys.toml',
    open(url) {
      console.log(`open ${url}`)
      openBrowser(url)
    },
    testnet: true,
  })
  const authorizeAccessKey = {
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
      params: [authorizeAccessKey],
    })
    console.log(Json.stringify(result, null, 2))
    return
  }

  const result = await provider.request({
    method: 'wallet_connect',
    params: [{ capabilities: { authorizeAccessKey } }],
  })
  console.log(Json.stringify(result, null, 2))
}

function parseCommand(value: string | undefined): Command {
  if (!value || value === 'connect') return 'connect'
  if (value === 'request') return 'request'
  throw new Error(
    'Usage: pnpm tsx ./scripts/cli.ts [connect|request] [--url=...] [--limit=...] [--expiry=...]',
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
