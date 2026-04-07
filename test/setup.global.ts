import * as net from 'node:net'

import { nodeEnv } from './config.js'
import { setupServer } from './prool.js'

async function isPortAvailable(port: number) {
  return await new Promise<boolean>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false)
        return
      }
      reject(error)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port)
  })
}

export default async function () {
  if (nodeEnv !== 'localnet') return undefined
  const startPort = Number(process.env.VITE_RPC_PORT ?? '8545')

  for (let i = 0; i < 20; i++) {
    const port = startPort + i
    if (!(await isPortAvailable(port))) continue
    process.env.VITE_RPC_PORT = String(port)
    return await setupServer({ port })
  }

  throw new Error(`Unable to find an available RPC port starting at ${startPort}.`)
}
