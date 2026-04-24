/** Proxies Tempo OIDC discovery and JWKS requests through the playground worker. */
export async function handleOidcProxy(request: Request) {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')
  if (!target) return Response.json({ error: 'Missing `url` query parameter.' }, { status: 400 })

  const next = new URL(target)
  const allowedHost = next.hostname.endsWith('.tempo.local') || next.hostname.endsWith('.tempo.xyz')
  if (!['http:', 'https:'].includes(next.protocol) || !allowedHost)
    return Response.json({ error: 'Only Tempo OIDC URLs are allowed.' }, { status: 400 })

  const response = await fetch(next)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}
