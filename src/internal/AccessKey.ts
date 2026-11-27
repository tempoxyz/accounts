/**
 * An app's access key on a user's Tempo Account, as the app stores it.
 * @module
 */
import { type Address, type Hex, P256, PublicKey, WebCryptoP256 } from 'ox'
import {
  KeyAuthorization,
  SignatureEnvelope,
  SignaturePreAuthorized,
} from 'ox/tempo'
import type { OneOf } from 'viem'
import { Account, Secp256k1 } from 'viem/tempo'
import { RequestError } from '../Accounts.js'
import type { WithAccount } from '../Permissions.js'

/** The expiry of a sign-in's access key that names none. */
export const defaultExpiry = '1d' as const

/**
 * An app's access key, as the session holds it. A browser access key is a non-extractable WebCrypto
 * key pair, and any other a secp256k1 private key. An access key that the app supplied as
 * `accessKey` carries no material.
 */
export type AccessKey<chainId extends number = number> = {
  /** The Tempo Account the access key acts for. */
  account: Address.Address
  /** The chain the access key acts on, from its authorization. */
  chainId: chainId
  /** The signed authorization, in the node's RPC format. */
  keyAuthorization: KeyAuthorization.Rpc
  /**
   * The seconds from the sign-in's request to the access key's expiry. A renewal through
   * `session.get` with `reauthorize` requests the same lifetime again. Absent for an access key
   * that never expires, and for one saved before the field existed.
   */
  lifetime?: number | undefined
} & Material

/** The material of an access key that the library generated for a sign-in. */
export type Material = OneOf<
  | {
      /**
       * A non-extractable WebCrypto P256 key pair, in a browser. IndexedDB stores it without
       * exporting it.
       */
      keyPair: WebCryptoP256.createKeyPair.ReturnType
    }
  | {
      /** A secp256k1 private key, outside a browser. Keep it as secret as a session. */
      privateKey: Hex.Hex
    }
  | {}
>

/** `toAccount` received a configurable account's authorization, which authorizes no access key. */
export class KeyTypeError extends Error {
  override readonly name = 'AccessKey.KeyTypeError'

  constructor() {
    super(
      'The authorization is for a configurable account, not an access key. Sign in again for an access key.',
    )
  }
}

/**
 * `toAccount` received an access key without material and no `signer`, or an access key given
 * only by its `publicKey` received a signing request.
 */
export class SignerRequiredError extends Error {
  override readonly name = 'AccessKey.SignerRequiredError'

  constructor() {
    super(
      'The access key has no signer here. Pass the `signer` that the app supplied, or sign where the app holds the private key.',
    )
  }
}

/**
 * Whether the access key's authorization is expired, so a new sign-in must authorize a new access key.
 *
 * @example
 * ```ts
 * if (AccessKey.expired(saved.accessKey)) await signInAgain()
 * ```
 */
export function expired(accessKey: AccessKey) {
  const at = expiry(accessKey)
  return at !== undefined && at <= Date.now()
}

/**
 * When the access key expires, in milliseconds, or `undefined` for one that never expires.
 *
 * @example
 * ```ts
 * import { AccessKey } from 'accounts/internal'
 *
 * const at = AccessKey.expiry(session.accessKey)
 * ```
 */
export function expiry(accessKey: AccessKey) {
  const { expiry } = KeyAuthorization.fromRpc(accessKey.keyAuthorization)
  return expiry ? expiry * 1000 : undefined
}

/**
 * Whether the access key holds its material, a key pair or a private key, so it signs here. The app's
 * own access key, which the sign-in named by its public key or as a Viem account, holds none.
 *
 * @example
 * ```ts
 * import { AccessKey } from 'accounts/internal'
 *
 * const signer = AccessKey.held(accessKey) ? AccessKey.toAccount(accessKey) : undefined
 * ```
 */
export function held(accessKey: Material | undefined): boolean {
  return Boolean(accessKey?.keyPair || accessKey?.privateKey)
}

/**
 * Instantiates a {@link AccessKey}, and fills an absent `chainId` from the key authorization.
 *
 * @example
 * ```ts
 * const accessKey = AccessKey.from(JSON.parse(saved).accessKey)
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
    /** The access key's chain. Defaults to the key authorization's chain. */
    chainId?: chainId | undefined
    /** The signed authorization, in the node's RPC format. */
    keyAuthorization: KeyAuthorization.Rpc
    /**
     * The seconds from the sign-in to the access key's expiry, which a renewal requests again. Absent
     * for an access key that never expires, and for one saved before the field existed.
     */
    lifetime?: number | undefined
  } & Material
}

/**
 * Returns the app's own access key: its Viem account, or an account of its `publicKey` that signs
 * nothing. Returns `undefined` for neither.
 */
export function own(accessKey: own.Options | undefined): own.ReturnType {
  if (accessKey?.account) return accessKey.account
  if (!accessKey?.publicKey) return undefined

  // The parser's own error quotes the value, which can be a private key in its place, so the
  // refusal quotes none of it and has no `cause`.
  const publicKey = (() => {
    try {
      // The parser checks only the length, so the curve of `type` checks the prefix and the point.
      const parsed = PublicKey.fromHex(accessKey.publicKey)
      // A compressed public key holds 32 bytes after its prefix, as a private key does, so only
      // the uncompressed form passes.
      if (parsed.y === undefined) throw new TypeError('Compressed public key.')
      // Each branch reads `noble` from its namespace, so that a bundle keeps no other export of it,
      // such as its mnemonic derivation.
      const curve = accessKey.type === 'p256' ? P256.noble : Secp256k1.noble
      curve.ProjectivePoint.fromHex(PublicKey.toHex(parsed).slice(2))
      return parsed
    } catch {
      throw new RequestError({
        code: 'invalid_request',
        field: 'accessKey.publicKey',
        message:
          'Invalid public key: `accessKey.publicKey` holds no uncompressed public key, such as a private key in its place. Pass the public key of the access key.',
        reason: 'invalid_public_key',
        status: 0,
      })
    }
  })()
  return Account.from({
    keyType: accessKey.type ?? 'secp256k1',
    publicKey,
    sign: () => Promise.reject(new SignerRequiredError()),
  })
}

export declare namespace own {
  type Options = Pick<WithAccount, 'account' | 'publicKey' | 'type'>

  type ReturnType = Account.Account | undefined
}

/**
 * Returns the app's own access key, or creates one: a non-extractable `CryptoKey` in a browser, or
 * else a secp256k1 access key.
 */
export async function resolve(
  accessKey: own.Options | undefined,
): Promise<resolve.ReturnType> {
  const account = own(accessKey)
  if (account) return { material: {}, signer: account }

  if (typeof indexedDB !== 'undefined') {
    const keyPair = await WebCryptoP256.createKeyPair()
    return {
      material: { keyPair },
      signer: Account.fromWebCryptoP256(keyPair),
    }
  }

  const privateKey = Secp256k1.randomPrivateKey()
  return {
    material: { privateKey },
    signer: Account.fromSecp256k1(privateKey),
  }
}

export declare namespace resolve {
  type ReturnType = {
    /** What the authorization keeps to rebuild the access key. Empty for the app's own access key. */
    material: Material
    /** A Viem account that signs with the access key. */
    signer: Account.Account
  }
}

/**
 * Returns the access key as a Viem access key account for its Tempo Account. Viem attaches the
 * authorization to transactions until the chain registers the access key. The account signs a hash,
 * a message, and typed data in a keychain envelope without the authorization, also before the chain
 * registers the access key. Throws {@link SignerRequiredError} for an access key without material
 * and no `signer`, and {@link KeyTypeError} for a configurable account's authorization.
 *
 * @example
 * ```ts
 * import { AccessKey } from 'accounts/internal'
 *
 * const account = AccessKey.toAccount(accessKey)
 * await client.token.transferSync({ account, amount, to, token })
 * ```
 */
export function toAccount(
  accessKey: AccessKey,
  options: toAccount.Options = {},
): Account.AccessKeyAccount {
  const { signer } = options
  const access = {
    access: accessKey.account,
    keyAuthorization: KeyAuthorization.fromRpc(accessKey.keyAuthorization),
  }

  if (accessKey.keyPair)
    return plain(Account.fromWebCryptoP256(accessKey.keyPair, access))
  if (accessKey.privateKey)
    return plain(Account.fromSecp256k1(accessKey.privateKey, access))
  if (!signer) throw new SignerRequiredError()
  // The authorization names the access key's type. A configurable account's authorization
  // authorizes no access key.
  const { type } = access.keyAuthorization
  if (type === 'configurable') throw new KeyTypeError()
  // A raw signature is the access key's own, which the bound account wraps for the Tempo Account.
  return plain(
    Account.from({
      ...access,
      keyType: type,
      publicKey: PublicKey.fromHex(signer.publicKey),
      sign: (parameters) => signer.sign({ ...parameters, raw: true }),
    }),
  )
}

export declare namespace toAccount {
  type Options = {
    /**
     * The account that the app supplied to the sign-in as its access key, which signs for an access
     * key without material.
     */
    signer?: Account.Account | undefined
  }
}

/**
 * Returns `account`, which signs a hash, a message, and typed data in a keychain envelope alone.
 * Viem's access key account wraps each envelope with its key authorization (TIP-1165) while its
 * manager holds the authorization. The `viem` plugin keeps the authorization there after the chain
 * registered the access key, so the wrapper would stay for the whole session. A verifier that reads
 * a keychain envelope, such as `Verify.hash`, refuses the wrapped signature.
 */
function plain(account: Account.AccessKeyAccount): Account.AccessKeyAccount {
  return {
    ...account,
    async sign(parameters) {
      return unwrap(await account.sign(parameters))
    },
    async signMessage(parameters) {
      return unwrap(await account.signMessage(parameters))
    },
    async signTypedData(typedData) {
      return unwrap(await account.signTypedData(typedData))
    },
  }
}

/**
 * Returns the keychain envelope of a signature that Viem wrapped with a key authorization, and any
 * other signature as it is, such as a raw signature of the access key.
 */
function unwrap(signature: Hex.Hex): Hex.Hex {
  if (!SignaturePreAuthorized.validate(signature)) return signature

  return SignatureEnvelope.serialize(
    SignaturePreAuthorized.unwrap(signature).signature,
  )
}
