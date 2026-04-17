const host = 's2367733.us-east-9.betterstackdata.com'

/** Resolves the expected project ID from the worker's SENTRY_DSN. */
function expectedProjectId(): string | undefined {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return undefined
  try {
    return new URL(dsn).pathname.replace('/', '') || undefined
  } catch {
    return undefined
  }
}

/** Tunnels browser Sentry envelopes to Better Stack's Sentry-compatible ingest endpoint. */
export async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const contentLength = request.headers.get('content-length')
  if (contentLength && Number.parseInt(contentLength, 10) > 10_000_000)
    return new Response('Payload too large', { status: 413 })

  const body = await request.text()
  const firstLine = body.split('\n')[0]

  let envelope: { dsn?: string | undefined }
  try {
    const parsed: unknown = JSON.parse(firstLine)
    if (!parsed || typeof parsed !== 'object') return new Response('Invalid envelope', { status: 400 })
    envelope = parsed as { dsn?: string | undefined }
  } catch {
    return new Response('Invalid envelope', { status: 400 })
  }

  if (!envelope.dsn) return new Response('Missing DSN', { status: 400 })

  const dsn = new URL(envelope.dsn)
  const projectId = dsn.pathname.replace('/', '')
  if (dsn.hostname !== host || !projectId) return new Response('Invalid DSN', { status: 403 })

  const allowed = expectedProjectId()
  if (allowed && projectId !== allowed) return new Response('Invalid DSN', { status: 403 })

  const ip = request.headers.get('cf-connecting-ip')

  const upstream = await fetch(`https://${host}/api/${projectId}/envelope/`, {
    body,
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_key=${dsn.username}, sentry_version=7`,
      ...(ip ? { 'X-Forwarded-For': ip } : undefined),
    },
    method: 'POST',
  })

  return new Response(upstream.body, {
    headers: upstream.headers,
    status: upstream.status,
    statusText: upstream.statusText,
  })
}
