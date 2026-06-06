import { Instance, Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { http } from 'viem'

import { fetchOptions, getClient } from './config.js'

type NodeSource = { type: 'binary'; binary: string } | { type: 'image'; image: string }

function isBinaryPath(value: string | undefined) {
  if (!value) return false
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../')
}

async function resolveNodeSource(): Promise<NodeSource> {
  const value = import.meta.env.VITE_NODE_TAG

  if (isBinaryPath(value)) return { type: 'binary', binary: value }

  if (!value?.startsWith('http'))
    return { type: 'image', image: `ghcr.io/tempoxyz/tempo:${value || 'latest'}` }

  const client = getClient({
    transport: http(value, {
      fetchOptions,
    }),
  })
  const result = await client.request({
    method: 'web3_clientVersion',
  })
  const sha = result.match(/tempo\/v[\d.]+-([a-f0-9]+)\//)?.[1]
  if (!sha) throw new Error(`Unable to resolve Tempo Docker tag from ${result}.`)
  return { type: 'image', image: `ghcr.io/tempoxyz/tempo:sha-${sha}` }
}

/** Starts a prool-backed Tempo localnet for tests. */
export async function setupServer({ port }: { port: number }) {
  const source = await resolveNodeSource()
  const args = {
    blockTime: '2ms',
    log: import.meta.env.VITE_NODE_LOG,
    port,
  } satisfies Instance.tempo.Parameters

  const server = Server.create({
    instance:
      source.type === 'binary'
        ? Instance.tempo({ ...args, binary: source.binary })
        : TestContainers.Instance.tempo({ ...args, image: source.image }),
    port,
  })
  await server.start()
  return async () => await server.stop()
}
