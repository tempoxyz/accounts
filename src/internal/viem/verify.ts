/**
 * Verifies a message, typed data, or hash for a Tempo Account as the Viem plugin's clients do. The
 * account's owner signs as the account, and an access key's signature counts only for the app whose
 * access token names the access key.
 * `module
 */
import { Address, Hex } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import {
  type Chain,
  type Client,
  hashMessage,
  hashTypedData,
  keccak256,
  type Transport,
  type VerifyHashParameters,
  type VerifyMessageParameters,
  type VerifyTypedDataParameters,
} from 'viem'
import { verifyHash } from 'viem/actions'
import type * as AccessToken from '../AccessToken.js'

/**
 * Returns whether `signature` signs `hash` for `address` on the client's chain. With `accessToken`, an
 * access key's signature counts only when the verified token's `access_keys` names the access key
 * for the account and the chain, so another app's access key on the same account does not. Without
 * it, Viem's default mode refuses an access key's signature. A `mode` of the call skips the token,
 * and Viem verifies the signature with it alone. A signature that is no access key's, or does not
 * parse, verifies in Viem's default mode. Throws `AccessToken.InvalidError` for a token that does not
 * verify.
 */
export async function hash(
  client: Client<Transport, Chain>,
  options: hash.Options,
): Promise<boolean> {
  const { accessToken, verifier, ...parameters } = options
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
  const token = verifier().verify({ accessToken })
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

/** Returns whether `signature` signs `message` for `address`, as {`link hash} decides. */
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

/** Returns whether `signature` signs the typed data for `address`, as {`link hash} decides. */
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
   * `access_keys` names the access key. Without it, an access key's signature does not count.
   */
  accessToken?: string | undefined
  /**
   * Viem's verification mode, such as `allowAccessKey`. With it, Viem verifies the signature alone,
   * without the token. Defaults to Viem's own default, which refuses an access key's signature
   * without `accessToken`.
   */
  mode?: 'allowAccessKey' | 'auto' | 'eoa' | (string & {}) | undefined
  /** Returns the verifier of the app's access tokens. */
  verifier: () => AccessToken.create.ReturnType
}
