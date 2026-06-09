import { spawn } from 'node:child_process'

import { getConsumerOrigin, listen } from './consumer-server.mjs'

const command = process.argv[2] ?? 'start'
const args = process.argv.slice(3)
const server = await listen()
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
  server.close()
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close(signal))

child.on('exit', (code, signal) => {
  server.close(() => {
    if (code !== null) process.exit(code)
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
  })
})
