import { Instance, Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { createClient, http } from 'viem'

import { fetchOptions } from './config.js'

export async function setupServer({ port }: { port: number }) {
  const tag = await (async () => {
    if (!import.meta.env.VITE_NODE_TAG?.startsWith('http')) return import.meta.env.VITE_NODE_TAG ?? 'latest'

    const client = createClient({
      transport: http(import.meta.env.VITE_NODE_TAG, {
        fetchOptions,
      }),
    })
    const result = await client.request({
      method: 'web3_clientVersion',
    })
    const sha = result.match(/tempo\/v[\d.]+-([a-f0-9]+)\//)?.[1]
    return `sha-${sha}`
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
