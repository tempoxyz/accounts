import { Base64, Bytes, Hex } from 'ox'
import { Credential } from 'ox/webauthn'
import {
  Authentication,
  Registration,
  type Registration as Registration_Types,
} from 'webauthx/server'

import { type Handler, from } from '../../Handler.js'
import * as Kv from '../../Kv.js'

/**
 * Instantiates a WebAuthn ceremony handler that manages registration and
 * authentication flows server-side.
 *
 * Exposes 4 POST endpoints following the webauthx convention:
 * - `POST /register/options` — generate credential creation options
 * - `POST /register` — verify registration and store credential
 * - `POST /login/options` — generate credential request options
 * - `POST /login` — verify authentication
 *
 * @example
 * ```ts
 * import { Handler, Kv } from 'accounts/server'
 *
 * const handler = Handler.webAuthn({
 *   kv: Kv.memory(),
 *   origin: 'https://example.com',
 *   rpId: 'example.com',
 * })
 *
 * export default handler
 * ```
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function webAuthn(options: webAuthn.Options): Handler {
  const { challengeTtl = 300, kv, onAuthenticate, onRegister, path = '', rpId, ...rest } = options
  const origin = options.origin as string | string[]

  const router = from(rest)

  router.post(`${path}/register/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const { excludeCredentialIds, name, userId } = body as {
        excludeCredentialIds?: string[]
        name: string
        userId?: string
      }

      const { challenge, options } = Registration.getOptions({
        excludeCredentialIds,
        name,
        rp: { id: rpId, name: rpId },
        ...(userId ? { user: { id: new TextEncoder().encode(userId), name } } : undefined),
      })

      await kv.set(`challenge:${challenge}`, { created: Date.now(), name })

      return Response.json({ options })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/register`, async (c) => {
    try {
      const credential = (await c.req.raw.json()) as Registration_Types.Credential
      const deserialized = Credential.deserialize(credential)

      const clientData = JSON.parse(
        Bytes.toString(new Uint8Array(deserialized.clientDataJSON)),
      ) as { challenge: string }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))
      const stored = await kv.get<{ created: number; name: string }>(`challenge:${challenge}`)
      if (!stored || Date.now() - stored.created > challengeTtl * 1_000)
        throw new Error('Missing or expired challenge')
      await kv.delete(`challenge:${challenge}`)

      const result = Registration.verify(credential, {
        challenge,
        origin,
        rpId,
      })

      const { publicKey } = result.credential
      const credentialId = credential.id

      await kv.set(`credential:${credentialId}`, { publicKey })

      const json = { credentialId, publicKey }
      const hook = await onRegister?.({
        credentialId,
        name: stored.name,
        publicKey,
        request: c.req.raw,
      })
      return mergeResponse(json, hook)
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/login/options`, async (c) => {
    try {
      const body = await c.req.raw.json()
      const {
        allowCredentialIds,
        challenge: requestChallenge,
        credentialId,
        mediation,
      } = body as {
        allowCredentialIds?: string[]
        challenge?: Hex.Hex
        credentialId?: string
        mediation?: string
      }

      const { challenge, options: authOptions } = Authentication.getOptions({
        challenge: requestChallenge,
        credentialId: allowCredentialIds ?? credentialId,
        rpId,
      })
      const options = mediation ? { ...authOptions, mediation } : authOptions

      await kv.set(`challenge:${challenge}`, Date.now())

      return Response.json({ options })
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  router.post(`${path}/login`, async (c) => {
    try {
      const response = (await c.req.raw.json()) as Authentication.Response

      const clientData = JSON.parse(response.metadata.clientDataJSON) as {
        challenge: string
      }
      const challenge = Hex.fromBytes(Base64.toBytes(clientData.challenge))
      const stored = await kv.get<number>(`challenge:${challenge}`)
      if (!stored || Date.now() - stored > challengeTtl * 1_000)
        throw new Error('Missing or expired challenge')
      await kv.delete(`challenge:${challenge}`)

      const credentialData = await kv.get<{ publicKey: string }>(`credential:${response.id}`)
      if (!credentialData) throw new Error('Unknown credential')

      const valid = Authentication.verify(response, {
        challenge,
        origin,
        publicKey: credentialData.publicKey as `0x${string}`,
        rpId,
      })
      if (!valid) throw new Error('Authentication failed')

      const rawResponse = response.raw?.response as unknown as Record<string, string> | undefined
      const userHandle = rawResponse?.userHandle

      const json = {
        credentialId: response.id,
        publicKey: credentialData.publicKey,
        ...(userHandle && userHandle.length > 0 ? { userId: userHandle } : undefined),
      }
      const hook = await onAuthenticate?.({ ...json, request: c.req.raw })
      return mergeResponse(json, hook)
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 })
    }
  })

  return router
}

export declare namespace webAuthn {
  type Options = from.Options & {
    /** Maximum age of a challenge in seconds before it expires. @default 300 */
    challengeTtl?: number | undefined
    /** Key-value store for challenges and credentials. */
    kv: Kv.Kv
    /** Called after a successful registration. The returned response is merged onto the default JSON response. */
    onRegister?: (parameters: {
      credentialId: string
      /** The name provided during `/register/options` (e.g. user email). */
      name: string
      publicKey: string
      request: Request
    }) => Response | Promise<Response> | void | Promise<void>
    /** Called after a successful authentication. The returned response is merged onto the default JSON response. */
    onAuthenticate?: (parameters: {
      credentialId: string
      publicKey: string
      userId?: string | undefined
      request: Request
    }) => Response | Promise<Response> | void | Promise<void>
    /** Expected origin(s) (e.g. `"https://example.com"` or `["https://a.com", "https://b.com"]`). */
    origin: string | readonly string[]
    /** Path prefix for the WebAuthn endpoints (e.g. `"/webauthn"`). @default "" */
    path?: string | undefined
    /** Relying Party ID (e.g. `"example.com"`). */
    rpId: string
  }
}

async function mergeResponse(
  json: Record<string, unknown>,
  hook?: Response | void,
): Promise<Response> {
  if (!hook) return Response.json(json)
  const extra = (await hook.json().catch(() => ({}))) as Record<string, unknown>
  const headers = new Headers(hook.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify({ ...json, ...extra }), {
    headers,
    status: hook.status,
  })
}
