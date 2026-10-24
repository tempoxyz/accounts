import { Base64, Bytes, Hash } from 'ox'

/**
 * Registers one wallet JSON-RPC request with a device-code host and returns
 * the pairing details without waiting for approval.
 *
 * Server-side consumers (OAuth authorization, MCP tools) use this to hand the
 * request to the host's standalone approval page, then poll with {@link poll}
 * across separate HTTP requests.
 */
export async function register(options: register.Options): Promise<register.ReturnType> {
  const { context, fetch = globalThis.fetch, meta, method, params, url } = options
  const verifier = Base64.fromBytes(Bytes.random(32), { pad: false, url: true })
  const challenge = Base64.fromBytes(Hash.sha256(Bytes.fromString(verifier), { as: 'Bytes' }), {
    pad: false,
    url: true,
  })
  const response = await fetch(`${url}/register`, {
    body: JSON.stringify({
      code_challenge: challenge,
      code_challenge_method: 'S256',
      message: {
        payload: [{ id: 1, jsonrpc: '2.0', method, params, ...(context ? { context } : {}) }],
        type: 'rpc-requests',
      },
      ...(meta ? { meta } : {}),
    }),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = (await response.json().catch(() => undefined)) as
    | {
        device_code?: string
        error_description?: string
        expires_in?: number
        user_code?: string
        verification_uri?: string
        verification_uri_complete?: string
      }
    | undefined
  if (!response.ok || !body?.device_code || !body.user_code || !body.verification_uri)
    throw new Error(
      `Device-code registration failed (${response.status}): ${body?.error_description ?? 'no details'}`,
    )
  return {
    deviceCode: body.device_code,
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 600),
    url: body.verification_uri_complete ?? body.verification_uri,
    userCode: body.user_code,
    verifier,
  }
}

export declare namespace register {
  /** Options for {@link register}. */
  export type Options = {
    /** Account and chain the approval page should apply before executing. */
    context?: { account?: string | undefined; chainId?: number | undefined } | undefined
    /** Fetch implementation (for example an in-process dispatcher). */
    fetch?: typeof globalThis.fetch | undefined
    /** Consumer metadata shown on the approval page. */
    meta?: { name: string } | undefined
    /** JSON-RPC method. */
    method: string
    /** JSON-RPC params. */
    params: unknown
    /** Base URL of the device-code endpoints. */
    url: string
  }

  /** Pairing details for one registered request. */
  export type ReturnType = {
    /** Opaque device code presented on `/token`. */
    deviceCode: string
    /** Expiry as a UNIX timestamp in seconds. */
    expiresAt: number
    /** Standalone approval page for this request. */
    url: string
    /** Human-facing confirmation code. */
    userCode: string
    /** PKCE verifier for `/token`. */
    verifier: string
  }
}

/** Polls a registered request once. */
export async function poll(options: poll.Options): Promise<poll.ReturnType> {
  const { deviceCode, fetch = globalThis.fetch, url, verifier } = options
  const response = await fetch(`${url}/token`, {
    body: JSON.stringify({
      code_verifier: verifier,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = (await response.json().catch(() => undefined)) as
    | {
        error?: string
        payload?: readonly {
          error?: { code: number; data?: unknown; message: string }
          result?: unknown
        }[]
        type?: string
      }
    | undefined
  if (response.status === 200 && body?.type === 'rpc-responses') {
    const [message] = body.payload ?? []
    if (message?.error) return { error: message.error, status: 'error' }
    return { result: message?.result ?? null, status: 'approved' }
  }
  if (body?.error === 'authorization_pending' || body?.error === 'slow_down')
    return { status: 'pending' }
  if (body?.error === 'access_denied') return { status: 'rejected' }
  return { status: 'expired' }
}

export declare namespace poll {
  /** Options for {@link poll}. */
  export type Options = {
    /** Device code from {@link register}. */
    deviceCode: string
    /** Fetch implementation. */
    fetch?: typeof globalThis.fetch | undefined
    /** Base URL of the device-code endpoints. */
    url: string
    /** PKCE verifier from {@link register}. */
    verifier: string
  }

  /** Current state of a registered request. */
  export type ReturnType =
    | { result: unknown; status: 'approved' }
    | { error: { code: number; data?: unknown; message: string }; status: 'error' }
    | { status: 'expired' | 'pending' | 'rejected' }
}
