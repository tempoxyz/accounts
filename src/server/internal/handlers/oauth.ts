import { Base64, Bytes, Hash } from 'ox'
import * as z from 'zod/mini'

import { type Handler, from } from '../../Handler.js'
import * as DeviceCodeClient from '../deviceCodeClient.js'
import * as Sealed from '../sealed.js'

/** Scope granted to OAuth clients. */
export const scope = 'wallet'

const registerRequest = z.object({
  client_name: z.optional(z.string().check(z.maxLength(200))),
  redirect_uris: z
    .array(z.string().check(z.maxLength(2_000)))
    .check(z.minLength(1), z.maxLength(10)),
})

const authorizeRequest = z.object({
  client_id: z.string(),
  code_challenge: z.string().check(z.minLength(43), z.maxLength(128)),
  code_challenge_method: z.literal('S256'),
  redirect_uri: z.string(),
  resource: z.optional(z.string()),
  response_type: z.literal('code'),
  scope: z.optional(z.string()),
  state: z.optional(z.string().check(z.maxLength(2_000))),
})

type Client = { name: string; redirect_uris: readonly string[] }
type Authorization = {
  client_id: string
  code_challenge: string
  device: { code: string; url: string; user_code: string; verifier: string }
  redirect_uri: string
  resource?: string | undefined
  state?: string | undefined
}

/** Account and chain bound to an OAuth grant. */
export type Grant = {
  /** Connected account address. */
  address: string
  /** Chain applied to wallet requests made with this grant. */
  chainId?: number | undefined
  /** Client that holds the grant. */
  client_id: string
}

/**
 * Instantiates an OAuth 2.1 authorization server whose consent step is a
 * `wallet_connect` request on the host's standalone device-code approval page.
 *
 * Supports dynamic client registration (RFC 7591), authorization code with
 * S256 PKCE, and refresh tokens, as required by MCP clients. The handler keeps
 * no state of its own: client IDs, codes, and tokens are sealed with `secret`.
 * Tokens only identify the connected account; every wallet action made with
 * them still requires approval on the host's approval page.
 *
 * Routes (relative to `path`, default `/oauth`):
 * - `GET /.well-known/oauth-authorization-server`
 * - `POST {path}/register`
 * - `GET {path}/authorize` — starts consent and renders the pairing page
 * - `POST {path}/token`
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function oauth(options: oauth.Options): Handler {
  const {
    accessTokenTtl = 3_600,
    baseUrl,
    chainId,
    deviceCode,
    html = { render: renderPage },
    path = '/oauth',
    refreshTokenTtl = 30 * 24 * 3_600,
    secret,
    ...rest
  } = options

  const router = from(rest)
  const origin = (request: Request) =>
    typeof baseUrl === 'function' ? baseUrl(request) : (baseUrl ?? new URL(request.url).origin)
  const device = (request: Request) => ({
    ...(deviceCode.fetch ? { fetch: deviceCode.fetch } : {}),
    url: typeof deviceCode.url === 'function' ? deviceCode.url(request) : deviceCode.url,
  })

  router.get('/.well-known/oauth-authorization-server', (c) => {
    const issuer = origin(c.req.raw)
    return c.json({
      authorization_endpoint: `${issuer}${path}/authorize`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      issuer,
      registration_endpoint: `${issuer}${path}/register`,
      response_types_supported: ['code'],
      scopes_supported: [scope],
      token_endpoint: `${issuer}${path}/token`,
      token_endpoint_auth_methods_supported: ['none'],
    })
  })

  router.post(`${path}/register`, async (c) => {
    const parsed = z.safeParse(registerRequest, await c.req.json().catch(() => undefined))
    if (!parsed.success) return oauthError('invalid_client_metadata', 'Malformed client metadata.')
    const { client_name, redirect_uris } = parsed.data
    if (!redirect_uris.every(isAllowedRedirect))
      return oauthError('invalid_redirect_uri', 'Redirect URIs must use HTTPS or loopback HTTP.')
    const client = { name: client_name ?? 'MCP client', redirect_uris } satisfies Client
    const client_id = await Sealed.seal({
      kind: 'oauth-client',
      payload: client,
      secret,
      ttl: 10 * 365 * 24 * 3_600,
    })
    return c.json(
      {
        client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.name,
        grant_types: ['authorization_code', 'refresh_token'],
        redirect_uris,
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    )
  })

  router.get(`${path}/authorize`, async (c) => {
    const request = c.req.raw
    const pending = c.req.query('request')
    if (pending) return await resume(request, pending)

    const parsed = z.safeParse(authorizeRequest, c.req.query())
    if (!parsed.success) return c.text('Invalid authorization request.', 400)
    const { client_id, code_challenge, redirect_uri, resource, state } = parsed.data
    const client = await Sealed.unseal<Client>({ kind: 'oauth-client', secret, value: client_id })
    if (!client || !client.redirect_uris.includes(redirect_uri))
      return c.text('Unknown client or redirect URI.', 400)

    const registered = await DeviceCodeClient.register({
      ...device(request),
      meta: { name: client.name },
      method: 'wallet_connect',
      params: [chainId !== undefined ? { chainId } : {}],
    })
    const authorization = {
      client_id,
      code_challenge,
      device: {
        code: registered.deviceCode,
        url: registered.url,
        user_code: registered.userCode,
        verifier: registered.verifier,
      },
      redirect_uri,
      resource,
      state,
    } satisfies Authorization
    const id = await Sealed.seal({
      kind: 'oauth-authorization',
      payload: authorization,
      secret,
      ttl: registered.expiresAt - Math.floor(Date.now() / 1000),
    })
    return await html.render({
      client: client.name,
      refreshUrl: `${origin(request)}${path}/authorize?request=${encodeURIComponent(id)}`,
      request,
      status: 'pending',
      url: registered.url,
      userCode: registered.userCode,
    })
  })

  async function resume(request: Request, id: string) {
    const authorization = await Sealed.unseal<Authorization>({
      kind: 'oauth-authorization',
      secret,
      value: id,
    })
    if (!authorization) return await html.render({ client: undefined, request, status: 'expired' })
    const client = await Sealed.unseal<Client>({
      kind: 'oauth-client',
      secret,
      value: authorization.client_id,
    })
    const { code, url, user_code, verifier } = authorization.device
    const state = await DeviceCodeClient.poll({ ...device(request), deviceCode: code, verifier })

    if (state.status === 'pending')
      return await html.render({
        client: client?.name,
        refreshUrl: `${origin(request)}${path}/authorize?request=${encodeURIComponent(id)}`,
        request,
        status: 'pending',
        url,
        userCode: user_code,
      })
    if (state.status === 'expired')
      return await html.render({ client: client?.name, request, status: 'expired' })

    const redirect = new URL(authorization.redirect_uri)
    if (authorization.state) redirect.searchParams.set('state', authorization.state)
    redirect.searchParams.set('iss', origin(request))

    const address = state.status === 'approved' ? connectedAddress(state.result) : undefined
    if (!address) {
      redirect.searchParams.set('error', 'access_denied')
      return redirectTo(redirect)
    }
    const code_oauth = await Sealed.seal({
      kind: 'oauth-code',
      payload: {
        client_id: authorization.client_id,
        code_challenge: authorization.code_challenge,
        grant: {
          address,
          client_id: authorization.client_id,
          ...(chainId !== undefined ? { chainId } : {}),
        } satisfies Grant,
        redirect_uri: authorization.redirect_uri,
      },
      secret,
      ttl: 120,
    })
    redirect.searchParams.set('code', code_oauth)
    return redirectTo(redirect)
  }

  router.post(`${path}/token`, async (c) => {
    const body = await readForm(c.req.raw)
    const grant_type = body.get('grant_type')

    if (grant_type === 'authorization_code') {
      const code = await Sealed.unseal<{
        client_id: string
        code_challenge: string
        grant: Grant
        redirect_uri: string
      }>({ kind: 'oauth-code', secret, value: body.get('code') ?? '' })
      const verifier = body.get('code_verifier') ?? ''
      if (
        !code ||
        code.client_id !== body.get('client_id') ||
        code.redirect_uri !== body.get('redirect_uri') ||
        pkceChallenge(verifier) !== code.code_challenge
      )
        return oauthError('invalid_grant', 'Invalid authorization code.')
      return c.json(await issue(code.grant))
    }

    if (grant_type === 'refresh_token') {
      const grant = await Sealed.unseal<Grant>({
        kind: 'oauth-refresh',
        secret,
        value: body.get('refresh_token') ?? '',
      })
      if (!grant || grant.client_id !== body.get('client_id'))
        return oauthError('invalid_grant', 'Invalid refresh token.')
      return c.json(await issue(grant))
    }

    return oauthError('unsupported_grant_type', 'Unsupported grant type.')
  })

  async function issue(grant: Grant) {
    return {
      access_token: await Sealed.seal({
        kind: 'oauth-access',
        payload: grant,
        secret,
        ttl: accessTokenTtl,
      }),
      expires_in: accessTokenTtl,
      refresh_token: await Sealed.seal({
        kind: 'oauth-refresh',
        payload: grant,
        secret,
        ttl: refreshTokenTtl,
      }),
      scope,
      token_type: 'Bearer',
    }
  }

  return router
}

export declare namespace oauth {
  /** Options for {@link oauth}. */
  export type Options = from.Options & {
    /** Access-token lifetime in seconds. @default 3600 */
    accessTokenTtl?: number | undefined
    /** Public issuer origin or a request-based resolver. Defaults to the request origin. */
    baseUrl?: string | ((request: Request) => string) | undefined
    /** Chain requested at connect time and applied to later wallet requests. */
    chainId?: number | undefined
    /** Device-code endpoints that host the standalone approval page. */
    deviceCode: {
      /** Fetch implementation, for example an in-process dispatcher. */
      fetch?: typeof globalThis.fetch | undefined
      /** Base URL of the device-code endpoints (for example `https://wallet.example.com/auth/device`). */
      url: string | ((request: Request) => string)
    }
    /** Pairing page hooks. */
    html?: { render: (options: render.Options) => Promise<Response> | Response } | undefined
    /** OAuth endpoint prefix. @default "/oauth" */
    path?: string | undefined
    /** Refresh-token lifetime in seconds. @default 2592000 */
    refreshTokenTtl?: number | undefined
    /** Secret used to seal client IDs, codes, and tokens (at least 32 characters). */
    secret: string
  }

  export namespace render {
    /** Pairing page state passed to `html.render`. */
    export type Options =
      | {
          /** Requesting client name. */
          client: string | undefined
          /** URL that re-checks approval and redirects back to the client. */
          refreshUrl: string
          /** Incoming request. */
          request: Request
          /** Awaiting approval on the approval page. */
          status: 'pending'
          /** Standalone approval page for the `wallet_connect` request. */
          url: string
          /** Confirmation code shown on the approval page. */
          userCode: string
        }
      | {
          /** Requesting client name, when known. */
          client: string | undefined
          /** Incoming request. */
          request: Request
          /** The authorization request expired. */
          status: 'expired'
        }
  }
}

/**
 * Resolves an `Authorization: Bearer` access token issued by {@link oauth}.
 *
 * @param options - Options.
 * @returns The grant, or `undefined` when the token is missing or invalid.
 */
export async function resolveGrant(options: resolveGrant.Options): Promise<Grant | undefined> {
  const { request, secret } = options
  const header = request.headers.get('authorization') ?? ''
  const [type, token] = header.split(' ')
  if (type?.toLowerCase() !== 'bearer' || !token) return undefined
  return await Sealed.unseal<Grant>({ kind: 'oauth-access', secret, value: token })
}

export declare namespace resolveGrant {
  /** Options for {@link resolveGrant}. */
  export type Options = {
    /** Incoming request. */
    request: Request
    /** Secret passed to {@link oauth}. */
    secret: string
  }
}

function connectedAddress(result: unknown): string | undefined {
  const accounts = (result as { accounts?: readonly { address?: unknown }[] } | null)?.accounts
  const address = accounts?.[0]?.address
  return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : undefined
}

function isAllowedRedirect(value: string) {
  try {
    const url = new URL(value)
    if (url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function pkceChallenge(verifier: string) {
  return Base64.fromBytes(Hash.sha256(Bytes.fromString(verifier), { as: 'Bytes' }), {
    pad: false,
    url: true,
  })
}

async function readForm(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json')) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>
    return new Map(
      Object.entries(json).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  }
  // Decode bytes directly; `text()` on form bodies logs a warning in workerd.
  const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()))
  return new Map(form.entries())
}

function oauthError(error: string, error_description: string) {
  return Response.json(
    { error, error_description },
    { headers: { 'cache-control': 'no-store' }, status: 400 },
  )
}

function renderPage(options: oauth.render.Options) {
  const client = escape(options.client ?? 'An app')
  const body = (() => {
    if (options.status === 'expired')
      return `<h1>Request expired</h1><p>Start the connection again from ${client}.</p>`
    return `<h1>Connect your account</h1>
<p>${client} wants to connect to your account.</p>
<p>Confirmation code: <code>${escape(format(options.userCode))}</code></p>
<p><a href="${escape(options.url)}" target="_blank" rel="noopener">Approve in your wallet</a></p>
<p>This page continues automatically after you approve.</p>`
  })()
  const refresh =
    options.status === 'pending'
      ? `<meta http-equiv="refresh" content="2;url=${escape(options.refreshUrl)}">`
      : ''
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Connect account</title>${refresh}</head><body><main>${body}</main></body></html>`,
    { headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' } },
  )
}

function format(userCode: string) {
  return userCode.length === 8 ? `${userCode.slice(0, 4)}-${userCode.slice(4)}` : userCode
}

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' })[character]!,
  )
}

function redirectTo(url: URL) {
  return new Response(null, {
    headers: { 'cache-control': 'no-store', location: url.toString() },
    status: 302,
  })
}
