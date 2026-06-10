import { spawn } from 'node:child_process'

import {
  getConsumerOrigin,
  getConsumerPort,
  listen,
  setConsumerOrigin,
  startTunnel,
} from './consumer-server.mjs'

const command = process.argv[2] ?? 'start'
const args = process.argv.slice(3)
const server = await listen()

// A remote wallet (e.g. production at wallet.tempo.xyz) can't reach the
// localhost consumer server, so publish it through a Cloudflare quick tunnel.
// Skipped when an explicit consumer URL is already provided.
let tunnel
if (process.env.TUNNEL === '1' && !process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL) {
  tunnel = await startTunnel(getConsumerPort())
  setConsumerOrigin(tunnel.url)
  console.log(`Consumer tunnel: ${tunnel.url}/.well-known/urpc/consumer.json`)
}

const consumerUrl = getConsumerOrigin()

const child = spawn('pnpm', ['exec', 'expo', command, ...args], {
  env: {
    ...process.env,
    EXPO_PUBLIC_WALLET_CONSUMER_URL: consumerUrl,
  },
  stdio: 'inherit',
})

let closing = false

function close(signal) {
  if (closing) return
  closing = true
  child.kill(signal)
  tunnel?.child.kill()
  server.close()
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close(signal))

child.on('exit', (code, signal) => {
  tunnel?.child.kill()
  server.close(() => {
    if (code !== null) process.exit(code)
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
  })
})
