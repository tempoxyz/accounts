import { execFileSync } from 'node:child_process'
import { Instance, Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { http } from 'viem'

import { fetchOptions, getClient } from './config.js'

export async function setupServer({ port }: { port: number }) {
  const tag = await (async () => {
    if (!import.meta.env.VITE_NODE_TAG?.startsWith('http'))
      return import.meta.env.VITE_NODE_TAG || 'latest'

    const client = getClient({
      transport: http(import.meta.env.VITE_NODE_TAG, {
        fetchOptions,
      }),
    })
    const result = await client.request({
      method: 'web3_clientVersion',
    })
    const match = result.match(/tempo\/v([\d.]+)-([a-f0-9]+)\//)
    if (!match) throw new Error(`Unable to resolve Tempo version from ${result}`)

    const tag = `sha-${match[2]}`
    try {
      execFileSync('docker', ['manifest', 'inspect', `ghcr.io/tempoxyz/tempo:${tag}`], {
        stdio: 'ignore',
      })
      return tag
    } catch {
      return match[1]!
    }
  })()

  const args = {
    blockTime: '2ms',
    log: import.meta.env.VITE_NODE_LOG,
    port,
  } satisfies Instance.tempo.Parameters

  const server = Server.create({
    instance: TestContainers.Instance.tempo({
      ...args,
      image: `ghcr.io/tempoxyz/tempo:${tag}`,
    }),
    port,
  })
  await server.start()
  return async () => await server.stop()
}
