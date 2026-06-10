import { createServer } from 'node:http'

const callback = 'xyz.tempo.accounts.playground:/auth'
const port = Number(process.env.CONSUMER_PORT ?? 21261)
let origin = process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL
  ? new URL(process.env.EXPO_PUBLIC_WALLET_CONSUMER_URL).origin
  : `http://localhost:${port}`

export function getConsumerOrigin() {
  return origin
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
