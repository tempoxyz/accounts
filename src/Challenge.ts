/**
 * Verifies a challenge's proof on an app's backend: a key authorization whose witness binds the
 * challenge, signed by the account's owner, for an access key that Tempo ID signed for the app. Any
 * app may set the witness of an access key, so the witness alone proves nothing about who requested
 * the access key.
 * @module
 */
import { Address, Hex } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { type Chain, type Client, hashMessage, type Transport } from 'viem'
import { verifyHash } from 'viem/actions'
import { Actions } from 'viem/tempo'
import type * as AccessToken from './AccessToken.js'

/**
 * The key authorization does not prove the challenge for the app and its user. The key
 * authorization is malformed, the witness does not bind the challenge, the access key acts on
 * another chain than the client's, the app's access token does not name the access key, or the
 * account's owner did not sign the key authorization.
 */
export class InvalidError extends Error {
  override readonly name = 'Challenge.InvalidError'

  constructor(options: InvalidError.Options) {
    super(
      `Invalid challenge proof: ${options.reason}. Sign in again with a new challenge.`,
    )
  }
}

export declare namespace InvalidError {
  type Options = {
    /** The fault, as a clause. */
    reason: string
  }
}

/**
 * Verifies that `keyAuthorization` proves `challenge` for the user of `accessToken`, and returns
 * the Tempo Account and the access key. The proof is the key authorization of a sign-in that sent
 * `challenge`. It passes when three checks hold:
 *
 * 1. Its witness equals `hashMessage(challenge)`.
 * 2. The app's verified access token names its access key, for the account and the chain, in
 *    `access_keys`.
 * 3. The account's owner signed it.
 *
 * Any app may set an access key's witness, so a witness alone proves nothing about who requested
 * the access key, as [Witnesses](https://github.com/tempoxyz/id/blob/main/docs/witnesses.md)
 * describes. The token binds the proof to the app and the user, since an access key that another
 * app requested is not in its `access_keys`.
 *
 * The chain decides who the account's owner is. A root key's signature verifies locally, and counts
 * only while the chain holds no configuration of the account. An account with a configuration
 * retired its root key ([TIP-1113](https://tips.sh/1113)), so only a configurable account's
 * signature proves it, which Viem's `verifyHash` verifies.
 *
 * `client` is a Viem client on the access key's chain. A root key's signature that verifies sends
 * one request, which reads the account's configuration. A configurable account's signature sends
 * one request for each account that the token names for the access key. If a request fails, the
 * call rejects with Viem's error, which is no refusal of the proof.
 *
 * Verify `accessToken` first with `AccessToken.create`, which checks its issuer, expiry, client ID,
 * and DPoP proof. Verify it for the app's own client ID only, never with `clientIds: 'any'`, since
 * another app's token names that app's access keys. Spend the challenge once it verifies.
 * @throws {InvalidError} When the proof fails a check.
 *
 * @example
 * ```ts
 * import { AccessToken, Accounts, Challenge } from 'accounts'
 * import { createClient, http } from 'viem'
 * import { tempo } from 'viem/chains'
 *
 * const verifier = AccessToken.create(Accounts.from({ clientId }))
 * const client = createClient({ chain: tempo, transport: http() })
 *
 * const token = await verifier.verify({ accessToken, dpop })
 * const { account } = await Challenge.verify(client, {
 *   accessToken: token,
 *   challenge, // the backend's own, spent once it verifies
 *   keyAuthorization,
 * })
 * ```
 */
export async function verify(
  client: Client<Transport, Chain>,
  options: verify.Options,
): Promise<verify.ReturnType> {
  const { accessToken, challenge } = options
  // The proof comes from the caller, so a malformed one is a refusal, never a parser's error. The
  // parser checks neither the key ID nor the witness's type, and only the payload encodes each
  // other field, such as the expiry and the limits. So each read of the proof that throws is here.
  //
  // The payload encodes each address and the witness as bytes, and encodes an object with a `length`
  // as that many bytes. So each of them is checked before the payload, which keeps the work of a
  // proof in proportion to its size. `Address.assert` tests a pattern, which converts its input to
  // a string, so `Hex.assert` first refuses a value that is no string, such as an array of one
  // address.
  const { authorization, payload } = (() => {
    try {
      const authorization = KeyAuthorization.fromRpc(options.keyAuthorization)
      const { account, limits = [], scopes = [] } = authorization
      const addresses = [
        authorization.address,
        ...(account === undefined ? [] : [account]),
        ...limits.map((limit) => limit.token),
        ...scopes.flatMap((scope) => [
          scope.address,
          ...(scope.recipients ?? []),
        ]),
      ]
      for (const address of addresses) {
        Hex.assert(address, { strict: true })
        Address.assert(address, { strict: false })
      }
      if (authorization.witness !== undefined)
        Hex.assert(authorization.witness, { strict: true })

      return {
        authorization,
        payload: KeyAuthorization.getSignPayload(authorization),
      }
    } catch {
      throw new InvalidError({ reason: 'the key authorization is malformed' })
    }
  })()

  if (authorization.witness?.toLowerCase() !== hashMessage(challenge))
    throw new InvalidError({
      reason: 'the witness does not bind the challenge',
    })
  if (Number(authorization.chainId) !== client.chain.id)
    throw new InvalidError({
      reason: `the access key acts on chain ${authorization.chainId}, not ${client.chain.id}`,
    })
  if (!authorization.signature)
    throw new InvalidError({ reason: 'the key authorization has no signature' })

  // The token names only access keys that Tempo ID signed for its own app and user, so an access
  // key that another app requested, with the same witness, is not among them. One access key may
  // serve several of the user's accounts, so each entry is a candidate signer.
  const entries = accessToken.accessKeys.filter(
    (accessKey) =>
      Address.isEqual(accessKey.address, authorization.address) &&
      accessKey.chainId === client.chain.id,
  )
  if (entries.length === 0)
    throw new InvalidError({
      reason: "the app's access token does not name the access key",
    })

  // A configurable account's signature needs the chain, which holds the account's configuration. A
  // root key's signature verifies locally for the account's address. A P256 or WebAuthn envelope
  // embeds its public key, so the signature itself is checked, never only the address. A root key
  // signs for the account only until the account holds a configuration, so the chain decides that
  // too, for the one account whose address the root key derives.
  const { signature } = authorization
  const signed = await Promise.all(
    entries.map(async (entry) => {
      if (signature.type === 'configurable')
        return await verifyHash(client, {
          address: entry.account,
          hash: payload,
          signature: Hex.from(SignatureEnvelope.serialize(signature)),
        })

      const valid = (() => {
        // An envelope that the owner cannot sign with, such as an access key's, fails the check.
        try {
          return SignatureEnvelope.verify(signature, {
            address: entry.account,
            payload,
          })
        } catch {
          return false
        }
      })()
      if (!valid) return false

      // Viem's `verifyHash` refuses a retired root key too, with up to two requests for each
      // candidate account. The local check leaves one account, so one read decides. A chain without
      // configurable accounts answers the zero commitment.
      const commitment = await Actions.accounts.getConfigCommitment(client, {
        account: entry.account,
      })
      return Hex.toBigInt(commitment) === 0n
    }),
  )
  const entry = entries[signed.indexOf(true)]
  if (!entry)
    throw new InvalidError({
      reason: "the account's owner did not sign the key authorization",
    })

  return { accessKey: entry.address, account: entry.account }
}

export declare namespace verify {
  type Options = {
    /** The app's access token from the same sign-in, verified with `AccessToken.create`. */
    accessToken: Pick<AccessToken.create.Token, 'accessKeys'>
    /** The challenge that the app's backend issued, as the sign-in sent it. */
    challenge: string
    /** The signed key authorization of the sign-in, in the node's RPC format. */
    keyAuthorization: KeyAuthorization.Rpc
  }

  type ReturnType = {
    /** The access key, which Tempo ID signed for the app. */
    accessKey: Address.Address
    /** The Tempo Account that the user proved. */
    account: Address.Address
  }

  type ErrorType = InvalidError
}
