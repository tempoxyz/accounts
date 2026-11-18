/**
 * Verifies a message, typed data, hash, or Sign-In with Ethereum message for a Tempo Account as the
 * Viem plugin's clients do. The account's owner signs as the account, and an access key's signature
 * counts only for the app whose access token names the access key. The zero address signs nothing.
 * @module
 */
import { Address, Hex } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import {
  type Chain,
  type Client,
  hashMessage,
  hashTypedData,
  isAddressEqual,
  keccak256,
  type Transport,
  type VerifyHashParameters,
  type VerifyMessageParameters,
  type VerifyTypedDataParameters,
  zeroAddress,
} from 'viem'
import { verifyHash } from 'viem/actions'
import {
  parseSiweMessage,
  verifySiweMessage,
  type VerifySiweMessageParameters,
} from 'viem/siwe'
import type * as AccessToken from '../../AccessToken.js'

/**
 * Returns whether `signature` signs `hash` for `address` on the client's chain. With `accessToken`, an
 * access key's signature counts only when the verified token's `access_keys` names the access key
 * for the account and the chain, so another app's access key on the same account does not. Without
 * it, Viem's default mode refuses an access key's signature. A `mode` of the call skips the token,
 * and Viem verifies the signature with it alone. A signature that is no access key's, or does not
 * parse, verifies in Viem's default mode. The zero address signs nothing, so the call returns
 * `false` for it in each mode, before any request and without a read of the token. Throws
 * `AccessToken.InvalidError` for a token that does not verify.
 */
export async function hash(
  client: Client<Transport, Chain>,
  options: hash.Options,
): Promise<boolean> {
  const { accessToken, dpop, verifier, ...parameters } = options
  // The chain's `ecrecover` returns the zero address for a signature that recovers no key, so the
  // zero address signs nothing.
  if (isAddressEqual(parameters.address, zeroAddress)) return false
  if (options.mode !== undefined || accessToken === undefined)
    return await verifyHash(client, parameters)

  // A keychain envelope arrives as hex or as bytes. A signature object holds no envelope.
  const signature = (() => {
    if (typeof parameters.signature === 'string') return parameters.signature
    if (parameters.signature instanceof Uint8Array)
      return Hex.fromBytes(parameters.signature)
    return undefined
  })()
  const envelope = (() => {
    if (!signature) return undefined
    try {
      return SignatureEnvelope.deserialize(signature)
    } catch {
      return undefined
    }
  })()
  const token = verifier().then((entry) => entry.verify({ accessToken, dpop }))
  // Any signature that is not an access key's verifies in Viem's default mode, which refuses an
  // access key's, so a signature that does not parse fails closed.
  if (envelope?.type !== 'keychain') {
    const [, valid] = await Promise.all([token, verifyHash(client, parameters)])
    return valid
  }

  const [verified, valid] = await Promise.all([
    token,
    verifyHash(client, { ...parameters, mode: 'allowAccessKey' }),
  ])
  if (!valid) return false

  // The access key of a version 2 envelope signs keccak256(0x04 || hash || account), and of a
  // version 1 envelope the hash itself.
  const accessKey = SignatureEnvelope.extractAddress({
    payload:
      envelope.version === 'v2'
        ? keccak256(Hex.concat('0x04', parameters.hash, parameters.address))
        : parameters.hash,
    signature: envelope.inner,
  })
  return verified.accessKeys.some(
    (entry) =>
      Address.isEqual(entry.address, accessKey) &&
      Address.isEqual(entry.account, parameters.address) &&
      entry.chainId === client.chain.id,
  )
}

export declare namespace hash {
  type Options = VerifyHashParameters & Bound
}

/** Returns whether `signature` signs `message` for `address`, as {@link hash} decides. */
export async function message(
  client: Client<Transport, Chain>,
  options: message.Options,
) {
  const { message: value, ...rest } = options
  return await hash(client, { ...rest, hash: hashMessage(value) })
}

export declare namespace message {
  type Options = Omit<VerifyMessageParameters, 'factory' | 'factoryData'> &
    Bound
}

/**
 * Returns whether `signature` signs the Sign-In with Ethereum message `message` for the address that
 * the message names, and the message is valid, as Viem's `verifySiweMessage` decides. Viem's action
 * verifies the hash itself, without {@link hash}. So the call returns `false` for a message that
 * names the zero address, which signs nothing, before any request.
 */
export async function siweMessage(
  client: Client<Transport, Chain>,
  options: siweMessage.Options,
) {
  const { address } = parseSiweMessage(options.message)
  if (address && isAddressEqual(address, zeroAddress)) return false

  return await verifySiweMessage(client, options)
}

export declare namespace siweMessage {
  type Options = VerifySiweMessageParameters
}

/** Returns whether `signature` signs the typed data for `address`, as {@link hash} decides. */
export async function typedData(
  client: Client<Transport, Chain>,
  options: typedData.Options,
) {
  const { domain, message: value, primaryType, types, ...rest } = options
  return await hash(client, {
    ...rest,
    hash: hashTypedData({
      domain,
      message: value,
      primaryType,
      types,
    } as never),
  })
}

export declare namespace typedData {
  type Options = Omit<VerifyTypedDataParameters, 'factory' | 'factoryData'> &
    Bound
}

/** The options that bind an access key's signature to the app's access token. */
type Bound = {
  /**
   * The app's access token of the user. An access key's signature counts only when the token's
   * [`access_keys`](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#access-keys)
   * names the access key. Without it, an access key's signature does not count.
   */
  accessToken?: string | undefined
  /**
   * The DPoP proof of the request that sent `accessToken`: the request's method, absolute URL,
   * `DPoP` header, and `Authorization` scheme. A DPoP token, whose `cnf` names a key, throws
   * `AccessToken.InvalidError` without it. The call returns no proof ID and refuses no repeated
   * proof. So the API refuses a repeated `proof.id` of `AccessToken.create`'s `verify` once per
   * request.
   */
  dpop?: AccessToken.create.Proof | undefined
  /**
   * Viem's verification mode, such as `allowAccessKey`. With it, Viem verifies the signature alone,
   * without the token. Defaults to Viem's own default, which refuses an access key's signature
   * without `accessToken`.
   */
  mode?: 'allowAccessKey' | 'auto' | 'eoa' | (string & {}) | undefined
  /** Returns the verifier of the app's access tokens, which loads on demand. */
  verifier: () => Promise<AccessToken.create.ReturnType>
}
