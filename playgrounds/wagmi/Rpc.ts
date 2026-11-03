/** The playgrounds' JSON-RPC relay, which keeps a node's keyed URL in the Worker. @module */
import * as Chains from 'viem/tempo/chains'

/** The relay's path, with the chain ID. */
export const pattern = /^\/rpc\/(\d+)$/

/**
 * Forwards a `POST /rpc/:chainId` to the chain's first entry in `rpcUrls`, Tempo ID's
 * `name:chainId=url` list, else the Tempo chain's public RPC URL. Returns `undefined` for another path.
 */
export async function relay(request: Request, rpcUrls: string | undefined) {
  const [, chainId] = new URL(request.url).pathname.match(pattern) ?? []
  if (!chainId) return undefined
  if (request.method !== 'POST')
    return new Response(null, { headers: { allow: 'POST' }, status: 405 })

  const url = rpcUrl(rpcUrls, Number(chainId))
  if (!url) return new Response('Unknown chain.', { status: 404 })
  const response = await fetch(url, {
    body: request.body,
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  return new Response(response.body, {
    headers: { 'content-type': 'application/json' },
    status: response.status,
  })
}

/** The first `rpcUrls` entry for `chainId`, else the Tempo chain's public RPC URL. */
function rpcUrl(rpcUrls: string | undefined, chainId: number) {
  for (const entry of (rpcUrls ?? '').split(',')) {
    const [, id, url] = entry.trim().match(/^(?:[^:=]*:)?(\d+)=(.+)$/) ?? []
    if (Number(id) === chainId && url) return url
  }
  return Object.values(Chains).find((chain) => chain.id === chainId)?.rpcUrls
    .default.http[0]
}
