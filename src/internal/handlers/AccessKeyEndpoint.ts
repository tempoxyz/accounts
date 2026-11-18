/**
 * The access key endpoint route of a registered resource's API, which Tempo ID calls at each
 * approval of a connection, for a policy with an access key endpoint. It verifies the access key
 * request token, and returns the public key of a new access key, which the API keeps until a
 * redemption claims it.
 * @module
 */
import { RequestError } from '../../Accounts.js'
import * as AccessToken from '../../AccessToken.js'
import * as Handler from '../Handler.js'

/**
 * Creates the handler of the access key endpoint. It answers a `POST` with `Authorization: Bearer
 * <access key request token>`. A token that does not verify, or repeats a `jti` or `nonce`,
 * receives 401, and a JSON Web Key Set that cannot be fetched receives 503. Tempo ID reads each
 * refusal as `access_key_endpoint_failed`.
 *
 * @example
 * ```ts
 * app.all('/accounts/*', (c) => accounts.handler.fetch(c.req.raw))
 * ```
 */
export function create(options: create.Options): Handler.Handler {
  const { prepare, verifier } = options
  return Handler.from({
    async fetch(request) {
      if (request.method !== 'POST')
        return json({ error: 'invalid_request' }, { status: 405 })
      const token = /^Bearer (.+)$/i.exec(
        request.headers.get('authorization') ?? '',
      )?.[1]
      if (!token) return json({ error: 'invalid_token' }, { status: 401 })

      try {
        const claims = await verifier.verifyAccessKeyRequest({ token })
        const prepared = await prepare(claims)
        if (!prepared) return json({ error: 'invalid_token' }, { status: 401 })
        return json(
          { key_type: prepared.keyType, public_key: prepared.publicKey },
          { status: 200 },
        )
      } catch (error) {
        if (error instanceof AccessToken.InvalidError)
          return json({ error: 'invalid_token' }, { status: 401 })
        if (error instanceof RequestError && error.status === 0)
          return json({ error: 'temporarily_unavailable' }, { status: 503 })
        throw error
      }
    },
  })
}

export declare namespace create {
  type Options = {
    /**
     * Generates and keeps an access key for a verified access key request, and returns its public
     * key, or
     * `undefined` for a repeated `jti` or `nonce`.
     */
    prepare: (request: AccessToken.create.AccessKeyRequest) => Promise<
      | {
          /** The access key's signature scheme. */
          keyType: 'p256' | 'secp256k1'
          /** The access key's uncompressed public key. */
          publicKey: `0x${string}`
        }
      | undefined
    >
    /** The verifier of the resource's tokens, which verifies the access key request token. */
    verifier: Pick<AccessToken.create.ReturnType, 'verifyAccessKeyRequest'>
  }
}

/** Returns a JSON response that no cache keeps, since it names an access key's public key. */
function json(body: unknown, options: { status: number }) {
  return new Response(JSON.stringify(body), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    },
    status: options.status,
  })
}
