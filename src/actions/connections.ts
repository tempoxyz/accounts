/**
 * Calls Tempo ID as a registered resource's API, with the API's own client authentication: the
 * redemption of a connection's allowance for the API's access key, and the revocation of that access
 * key.
 * @module
 */
import type { KeyAuthorization } from 'ox/tempo'
import {
  formatTransactionReceipt,
  type RpcTransactionReceipt,
  type TransactionReceipt,
} from 'viem'
import { type Config, RequestError } from '../Accounts.js'
import * as Api from '../internal/Api.js'

/**
 * Redeems the allowance of one user's connection for the API's access key `publicKey`, at
 * `POST /v1/access-keys/connect`. The instance is the API's OAuth app, which the resource's access
 * key policy names, with `clientSecret` or `clientAssertion`. For a policy with an access key endpoint, the
 * owner signed the access key at the approval, and the request sends its `nonce`. A repeat with the
 * same public key returns the same key authorization, so a request without a known outcome sends it
 * again.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const { account, keyAuthorization } = await Actions.connections.connect(auth, {
 *   keyType: 'secp256k1',
 *   publicKey,
 *   resource: 'https://api.example/mcp',
 *   subjectToken: accessToken,
 * })
 * ```
 */
export async function connect(
  auth: Config,
  options: connect.Options,
): Promise<connect.ReturnType> {
  const {
    keyType = 'secp256k1',
    nonce,
    publicKey,
    resource,
    subjectToken,
  } = options
  const body = await Api.json<{
    account: `0x${string}`
    key_authorization: KeyAuthorization.Rpc
  }>(
    await Api.post(auth, '/v1/access-keys/connect', {
      credentials: 'omit',
      json: {
        ...(await Api.clientAuthentication(authenticated(auth))),
        client_id: auth.clientId,
        key_type: keyType,
        ...(nonce !== undefined ? { nonce } : {}),
        public_key: publicKey,
        resource,
        subject_token: subjectToken,
      },
    }),
  )
  return { account: body.account, keyAuthorization: body.key_authorization }
}

export declare namespace connect {
  type Options = {
    /** The signature scheme of the API's access key. Defaults to `secp256k1`. */
    keyType?: 'p256' | 'secp256k1' | undefined
    /**
     * The `nonce` of the access key request token whose public key the API's access key endpoint returned, for a
     * policy with an access key endpoint. Absent for a policy without one, whose API generates the access
     * key at redemption.
     */
    nonce?: string | undefined
    /** The uncompressed public key of the API's access key, hex with the `0x04` prefix. */
    publicKey: `0x${string}`
    /** The API's registered resource, which the access token names in `aud`. */
    resource: string
    /** The app's access token for the connection, as the app sent it to the API. */
    subjectToken: string
  }

  type ReturnType = {
    /** The connection's Tempo Account, which the access key acts for. */
    account: `0x${string}`
    /** The signed key authorization of the API's access key, in RPC format. */
    keyAuthorization: KeyAuthorization.Rpc
  }
}

/**
 * Revokes an access key that the API holds for a connection, on its chain, at
 * `POST /v1/access-keys/revoke`, with the API's own client authentication and no user token.
 * Returns the receipt of the revoking transaction, or `null` when the chain held the access key
 * revoked already. An access key that the API does not hold throws `unknown_key`.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * await Actions.connections.revokeAccessKey(auth, {
 *   accessKey: connection.accessKey.keyAuthorization.keyId,
 *   account: connection.accessKey.account,
 *   chainId: connection.accessKey.chainId,
 * })
 * ```
 */
export async function revokeAccessKey(
  auth: Config,
  options: revokeAccessKey.Options,
): Promise<revokeAccessKey.ReturnType> {
  const { accessKey, account, chainId } = options
  const body = await Api.json<{ receipt?: RpcTransactionReceipt | undefined }>(
    await Api.post(auth, '/v1/access-keys/revoke', {
      credentials: 'omit',
      json: {
        ...(await Api.clientAuthentication(authenticated(auth))),
        account,
        address: accessKey,
        chainId,
        client_id: auth.clientId,
      },
    }),
  )
  return body.receipt ? formatTransactionReceipt(body.receipt) : null
}

export declare namespace revokeAccessKey {
  type Options = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /** The Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The access key's chain ID. */
    chainId: number
  }

  /** The receipt of the revoking transaction, or `null` for an access key revoked already. */
  type ReturnType = TransactionReceipt | null
}

/** Returns `auth`, and throws `invalid_client` without a client secret or assertion. */
function authenticated(auth: Config) {
  if (auth.clientAssertion || auth.clientSecret) return auth
  throw new RequestError({
    code: 'invalid_client',
    message:
      "Missing client authentication: an API authenticates with its OAuth app's secret or a client assertion. Create the instance with `clientSecret` or `clientAssertion`.",
    reason: 'invalid_client',
    status: 0,
  })
}
