import { Base64, Bytes, Hash } from 'ox'
import { describe, expect, test } from 'vp/test'

import { compose } from '../../Handler.js'
import { deviceCode } from './deviceCode.js'
import { oauth } from './oauth.js'

const origin = 'https://wallet.example.com'
const secret = 'test-oauth-secret-0123456789abcdef'
const verifier = 'test-oauth-code-verifier-0123456789abcdefghij'
const redirect_uri = 'https://client.example.com/callback'
const address = '0x1111111111111111111111111111111111111111'

const cimd = 'https://client.example.com/oauth/client.json'

function createApp() {
  const app = compose([
    deviceCode({ html: { render: () => new Response('verify') }, validate: () => undefined }),
    oauth({
      chainId: 4217,
      deviceCode: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
          await app.fetch(new Request(input, init)),
        url: `${origin}/auth/device`,
      },
      html: {
        render: (options) =>
          Response.json(
            options.status === 'pending'
              ? {
                  refreshUrl: options.refreshUrl,
                  status: options.status,
                  userCode: options.userCode,
                }
              : { status: options.status },
          ),
      },
      fetch: async (input) =>
        String(input) === cimd
          ? Response.json({
              client_id: cimd,
              client_name: 'CIMD Client',
              redirect_uris: [redirect_uri],
            })
          : Response.json({
              client_id: 'https://other.example.com',
              redirect_uris: [redirect_uri],
            }),
      secret,
    }),
  ])
  return app
}

async function registerClient(app: ReturnType<typeof createApp>) {
  const response = await app.fetch(
    new Request(`${origin}/oauth/register`, {
      body: JSON.stringify({ client_name: 'Test MCP', redirect_uris: [redirect_uri] }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
  return (await response.json()) as { client_id: string }
}

async function authorize(app: ReturnType<typeof createApp>, client_id: string) {
  const url = new URL(`${origin}/oauth/authorize`)
  url.search = new URLSearchParams({
    client_id,
    code_challenge: Base64.fromBytes(Hash.sha256(Bytes.fromString(verifier), { as: 'Bytes' }), {
      pad: false,
      url: true,
    }),
    code_challenge_method: 'S256',
    redirect_uri,
    response_type: 'code',
    state: 'xyz',
  }).toString()
  const response = await app.fetch(new Request(url))
  return (await response.json()) as { refreshUrl: string; status: string; userCode: string }
}

async function approve(app: ReturnType<typeof createApp>, user_code: string, result: unknown) {
  await app.fetch(
    new Request(`${origin}/auth/device/verify`, {
      body: JSON.stringify({ action: 'approve', results: [{ id: 1, result }], user_code }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
}

async function exchange(app: ReturnType<typeof createApp>, body: Record<string, string>) {
  const response = await app.fetch(
    new Request(`${origin}/oauth/token`, {
      body: new URLSearchParams(body),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    }),
  )
  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

describe('oauth', () => {
  test('default: connects through the device-code approval page', async () => {
    const app = createApp()
    const { client_id } = await registerClient(app)
    const pending = await authorize(app, client_id)
    expect(pending.status).toMatchInlineSnapshot(`"pending"`)

    const waiting = await app.fetch(new Request(pending.refreshUrl))
    expect(((await waiting.json()) as { status: string }).status).toMatchInlineSnapshot(`"pending"`)

    await approve(app, pending.userCode, { accounts: [{ address, capabilities: {} }] })
    const redirect = await app.fetch(new Request(pending.refreshUrl))
    const location = new URL(redirect.headers.get('location')!)
    expect({
      origin: location.origin + location.pathname,
      iss: location.searchParams.get('iss'),
      state: location.searchParams.get('state'),
      status: redirect.status,
    }).toMatchInlineSnapshot(`
      {
        "iss": "https://wallet.example.com",
        "origin": "https://client.example.com/callback",
        "state": "xyz",
        "status": 302,
      }
    `)

    const tokens = await exchange(app, {
      client_id,
      code: location.searchParams.get('code')!,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri,
    })
    const { access_token, refresh_token, ...rest } = tokens.body
    expect(typeof access_token).toMatchInlineSnapshot(`"string"`)
    expect(rest).toMatchInlineSnapshot(`
      {
        "expires_in": 3600,
        "scope": "wallet",
        "token_type": "Bearer",
      }
    `)

    const refreshed = await exchange(app, {
      client_id,
      grant_type: 'refresh_token',
      refresh_token: refresh_token as string,
    })
    expect(refreshed.status).toMatchInlineSnapshot(`200`)
  })

  test('behavior: accepts HTTPS client ID metadata documents', async () => {
    const app = createApp()
    const pending = await authorize(app, cimd)
    expect(pending.status).toMatchInlineSnapshot(`"pending"`)
    await approve(app, pending.userCode, { accounts: [{ address, capabilities: {} }] })
    const redirect = await app.fetch(new Request(pending.refreshUrl))
    const tokens = await exchange(app, {
      client_id: cimd,
      code: new URL(redirect.headers.get('location')!).searchParams.get('code')!,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri,
    })
    expect(tokens.status).toMatchInlineSnapshot(`200`)
  })

  test('behavior: rejects a metadata document for another client ID', async () => {
    const app = createApp()
    const url = new URL(`${origin}/oauth/authorize`)
    url.search = new URLSearchParams({
      client_id: 'https://evil.example.com/client.json',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
      redirect_uri,
      response_type: 'code',
    }).toString()
    const response = await app.fetch(new Request(url))
    expect({ body: await response.text(), status: response.status }).toMatchInlineSnapshot(`
      {
        "body": "Unknown client or redirect URI.",
        "status": 400,
      }
    `)
  })

  test('behavior: rejects a wrong PKCE verifier', async () => {
    const app = createApp()
    const { client_id } = await registerClient(app)
    const pending = await authorize(app, client_id)
    await approve(app, pending.userCode, { accounts: [{ address, capabilities: {} }] })
    const redirect = await app.fetch(new Request(pending.refreshUrl))
    const code = new URL(redirect.headers.get('location')!).searchParams.get('code')!

    await expect(
      exchange(app, {
        client_id,
        code,
        code_verifier: `${verifier}-wrong`,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "body": {
          "error": "invalid_grant",
          "error_description": "Invalid authorization code.",
        },
        "status": 400,
      }
    `)
  })

  test('behavior: redirects access_denied when the user rejects', async () => {
    const app = createApp()
    const { client_id } = await registerClient(app)
    const pending = await authorize(app, client_id)
    await app.fetch(
      new Request(`${origin}/auth/device/verify`, {
        body: JSON.stringify({ action: 'deny', user_code: pending.userCode }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    const redirect = await app.fetch(new Request(pending.refreshUrl))
    expect(
      new URL(redirect.headers.get('location')!).searchParams.get('error'),
    ).toMatchInlineSnapshot(`"access_denied"`)
  })

  test('behavior: rejects non-HTTPS redirect URIs', async () => {
    const app = createApp()
    const response = await app.fetch(
      new Request(`${origin}/oauth/register`, {
        body: JSON.stringify({ redirect_uris: ['http://evil.example.com/callback'] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect({ body: await response.json(), status: response.status }).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "invalid_redirect_uri",
          "error_description": "Redirect URIs must use HTTPS or loopback HTTP.",
        },
        "status": 400,
      }
    `)
  })

  test('behavior: serves authorization server metadata', async () => {
    const app = createApp()
    const response = await app.fetch(
      new Request(`${origin}/.well-known/oauth-authorization-server`),
    )
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "authorization_endpoint": "https://wallet.example.com/oauth/authorize",
        "client_id_metadata_document_supported": true,
        "code_challenge_methods_supported": [
          "S256",
        ],
        "grant_types_supported": [
          "authorization_code",
          "refresh_token",
        ],
        "issuer": "https://wallet.example.com",
        "registration_endpoint": "https://wallet.example.com/oauth/register",
        "response_types_supported": [
          "code",
        ],
        "scopes_supported": [
          "wallet",
        ],
        "token_endpoint": "https://wallet.example.com/oauth/token",
        "token_endpoint_auth_methods_supported": [
          "none",
        ],
      }
    `)
  })
})
