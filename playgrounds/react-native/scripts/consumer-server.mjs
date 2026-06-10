import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const callback = 'xyz.tempo.accounts.playground:/auth'
const port = Number(process.env.CONSUMER_PORT ?? 21261)
let origin = process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL
  ? new URL(process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL).origin
  : `http://localhost:${port}`

export function getConsumerOrigin() {
  return origin
}

export function getConsumerPort() {
  return port
}

/** Sets the origin advertised in the served discovery document. */
export function setConsumerOrigin(value) {
  origin = new URL(value).origin
}

/**
 * Opens a Cloudflare quick tunnel to the local consumer server so a remote
 * wallet (e.g. production) can fetch its discovery document. Resolves with the
 * public `https://*.trycloudflare.com` origin and the tunnel child process.
 */
export function startTunnel(localPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cloudflared',
      ['tunnel', '--no-autoupdate', '--url', `http://localhost:${localPort}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const pattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
    let settled = false
    const onData = (chunk) => {
      const match = chunk.toString().match(pattern)
      if (!match || settled) return
      settled = true
      resolve({ child, url: match[0] })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      reject(new Error(`cloudflared exited (${code}) before reporting a tunnel URL`))
    })
    setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('cloudflared tunnel timed out'))
    }, 30_000)
  })
}

export function createConsumerServer() {
  return createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.url !== '/.well-known/urpc/consumer.json') {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        callback_urls: [callback, 'xyz.tempo.accounts.playground://auth'],
        id: 'xyz.tempo.accounts.playground',
        name: 'Accounts RN Playground',
        origin,
        version: '1.0',
      }),
    )
  })
}

export function listen() {
  const server = createConsumerServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      const address = server.address()
      if (!process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL && typeof address === 'object' && address)
        origin = `http://localhost:${address.port}`
      console.log(`Consumer document: ${origin}/.well-known/urpc/consumer.json`)
      resolve(server)
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) await listen()
