const host = 'us.i.posthog.com'

/** Proxies browser analytics requests to PostHog through the worker. */
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice('/pho'.length) || '/'

  const headers = new Headers(request.headers)
  headers.delete('cookie')
  headers.set('host', host)

  const ip = request.headers.get('cf-connecting-ip')
  if (ip) headers.set('x-forwarded-for', ip)

  const upstream = await fetch(`https://${host}${path}${url.search}`, {
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    headers,
    method: request.method,
    redirect: 'manual',
  })

  return new Response(upstream.body, {
    headers: upstream.headers,
    status: upstream.status,
    statusText: upstream.statusText,
  })
}
