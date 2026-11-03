/**
 * An app's access key on a user's Tempo Account, as the app stores it.
 * @module
 */
import { type Address, type Hex, PublicKey, type WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import type { OneOf } from 'viem'
import { Account, KeyAuthorizationManager } from 'viem/tempo'

/**
 * A stored access key. A browser key is a non-extractable WebCrypto key pair, and any other a
 * secp256k1 private key. A key that the app supplied as `accessKey` carries no material.
 */
export type AccessKey<chainId extends number = number> = {
  /** The Tempo Account the access key acts for. */
  account: Address.Address
  /** The chain the access key acts on, from its authorization. */
  chainId: chainId
  /** The signed authorization, in the node's RPC format. */
  keyAuthorization: KeyAuthorization.Rpc
} & Material

/** The key material that the library generated for a sign-in. */
export type Material = OneOf<
  | {
      /** A non-extractable WebCrypto P256 key pair, in a browser. */
      keyPair: WebCryptoP256.createKeyPair.ReturnType
    }
  | {
      /** A secp256k1 private key, outside a browser. Keep it as secret as a session. */
      privateKey: Hex.Hex
    }
  | {}
>

/**
 * `toAccount` received an access key without material and no `accessKey`, or an access key given
 * only by its `publicKey` received a signing request.
 */
export class AccessKeyRequiredError extends Error {
  override readonly name = 'AccessKey.AccessKeyRequiredError'

  constructor() {
    super(
      'The access key has no signer here. Pass the `accessKey` the app supplied, or sign where the app holds the private key.',
    )
  }
}

/**
 * Whether the access key's authorization is expired, so a new sign-in must authorize a new access key.
 *
 * @example
 * ```ts
 * if (AccessKey.expired(saved.key)) await signInAgain()
 * ```
 */
export function expired(key: AccessKey) {
  const { expiry } = KeyAuthorization.fromRpc(key.keyAuthorization)
  return Boolean(expiry) && expiry! * 1000 <= Date.now()
}

/**
 * Instantiates a {@link AccessKey}, and fills an absent `chainId` from the key authorization.
 *
 * @example
 * ```ts
 * const key = AccessKey.from(JSON.parse(saved).key)
 * ```
 */
export function from<chainId extends number = number>(
  value: from.Value<chainId>,
): AccessKey<chainId> {
  if (value.chainId !== undefined) return { ...value, chainId: value.chainId }
  // The node signs the chain ID the request named, so it is the request's literal.
  const chainId = Number(
    KeyAuthorization.fromRpc(value.keyAuthorization).chainId,
  ) as chainId
  return { ...value, chainId }
}

export declare namespace from {
  type Value<chainId extends number = number> = {
    /** The Tempo Account the access key acts for. */
    account: Address.Address
    /** The key's chain. Defaults to the key authorization's chain. */
    chainId?: chainId | undefined
    /** The signed authorization, in the node's RPC format. */
    keyAuthorization: KeyAuthorization.Rpc
  } & Material
}

/**
 * Returns the key as a Viem access key account for its Tempo Account. Viem attaches the
 * authorization to transactions until the chain registers the access key. Throws
 * {@link AccessKeyRequiredError} for an access key without material and no `accessKey`.
 *
 * @example
 * ```ts
 * import { AccessKey } from 'accounts'
 *
 * const account = AccessKey.toAccount(key)
 * await client.token.transferSync({ account, amount, to, token })
 * ```
 */
export function toAccount(
  key: AccessKey,
  options: toAccount.Options = {},
): Account.AccessKeyAccount {
  const { accessKey } = options
  const keyAuthorization = KeyAuthorization.fromRpc(key.keyAuthorization)
  const keyAuthorizationManager = KeyAuthorizationManager.memory()
  // The memory manager stores synchronously, so the authorization is in place before the account
  // is returned.
  void keyAuthorizationManager.set(
    {
      accessKey: keyAuthorization.address,
      address: key.account,
      chainId: Number(keyAuthorization.chainId),
    },
    keyAuthorization,
  )
  const access = { access: key.account, keyAuthorizationManager }

  if (key.keyPair) return Account.fromWebCryptoP256(key.keyPair, access)
  if (key.privateKey) return Account.fromSecp256k1(key.privateKey, access)
  if (!accessKey) throw new AccessKeyRequiredError()
  // A raw signature is the access key's own, which the bound account wraps for the Tempo Account.
  return Account.from({
    ...access,
    keyType: accessKey.keyType,
    publicKey: PublicKey.fromHex(accessKey.publicKey),
    sign: (parameters) => accessKey.sign({ ...parameters, raw: true }),
  })
}

export declare namespace toAccount {
  type Options = {
    /** The access key that the app supplied to the sign-in, which signs for an access key without material. */
    accessKey?: Account.Account | undefined
  }
}
