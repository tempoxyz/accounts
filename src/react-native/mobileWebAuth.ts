import { Base64, Hex, Json, Provider as ox_Provider, RpcRequest } from 'ox'

/**
 * Creates a single-request mobile web auth transport.
 */
export function mobileWebAuth(options: mobileWebAuth.Options): mobileWebAuth.Transport {
  const { callback, host, id = new URL(host).origin, open = defaultOpen } = options
  const ids = RpcRequest.createStore()

  return {
    async request(request) {
      const state = Base64.fromHex(Hex.random(16), { pad: false, url: true })
      const url = new URL('/remote/auth/mobile', host)
      url.searchParams.set('version', '1')
      url.searchParams.set('id', id)
      url.searchParams.set('callback', callback)
      url.searchParams.set('state', state)
      url.searchParams.set('pubkey', Base64.fromHex(Hex.random(32), { pad: false, url: true }))
      url.searchParams.set('message', encode(ids.prepare(request as never)))

      const callbackUrl = await open(url.toString(), callback)
      if (!callbackUrl) throw new AuthCancelledError()

      const params = new URL(callbackUrl).searchParams
      if (params.get('state') !== state) throw new StateMismatchError()

      const message = params.get('message')
      if (!message) throw new Error('Missing message in callback.')

      const response = decode<mobileWebAuth.Response>(message)
      if (response.error) throw ox_Provider.parseError(response.error)
      return response.result
    },
  }
}

export declare namespace mobileWebAuth {
  type Options = {
    /** Redirect URI for the auth callback. */
    callback: string
    /** Mobile auth host URL. */
    host: string
    /** Consumer identifier sent to the wallet. */
    id?: string | undefined
    /** Opens the auth URL and returns the callback URL. */
    open?: ((url: string, redirectUri: string) => Promise<string | null>) | undefined
  }

  type Response = {
    error?: { code: number; message: string } | undefined
    id: number
    jsonrpc: '2.0'
    result?: unknown
  }

  type Transport = {
    /** Sends one JSON-RPC request through the mobile auth flow. */
    request(request: unknown): Promise<unknown>
  }
}

class AuthCancelledError extends Error {
  constructor() {
    super('Authentication was cancelled by the user.')
    this.name = 'AuthCancelledError'
  }
}

class StateMismatchError extends Error {
  constructor() {
    super('State parameter mismatch — possible CSRF attack.')
    this.name = 'StateMismatchError'
  }
}

async function defaultOpen(url: string, redirectUri: string): Promise<string | null> {
  const { openAuthSessionAsync } = await import('expo-web-browser')
  const result = await openAuthSessionAsync(url, redirectUri)
  if (result.type !== 'success') return null
  return result.url
}

function encode(value: unknown) {
  return Base64.fromString(Json.stringify(value), { pad: false, url: true })
}

function decode<type>(value: string): type {
  return Json.parse(Base64.toString(value)) as type
}
