/**
 * Resolves the access key that a sign-in authorizes: the app's own, or a new one.
 * @module
 */
import { WebCryptoP256 } from 'ox'
import { Account, Secp256k1 } from 'viem/tempo'
import type * as AccessKey from '../AccessKey.js'

/**
 * Returns the app's access key, or creates one: a non-extractable `CryptoKey` in a browser, or else a
 * secp256k1 access key.
 */
export async function resolve(
  accessKey: Account.Account | undefined,
): Promise<resolve.ReturnType> {
  if (accessKey) return { accessKey, material: {} }

  if (typeof indexedDB !== 'undefined') {
    const keyPair = await WebCryptoP256.createKeyPair()
    return {
      accessKey: Account.fromWebCryptoP256(keyPair),
      material: { keyPair },
    }
  }

  const privateKey = Secp256k1.randomPrivateKey()
  return {
    accessKey: Account.fromSecp256k1(privateKey),
    material: { privateKey },
  }
}

/**
 * Rebuilds an access key that {@link resolve} generated from its material. Returns `undefined` for the
 * empty material of the app's own access key.
 */
export function restore(
  material: AccessKey.Material,
): resolve.ReturnType | undefined {
  if (material.keyPair)
    return { accessKey: Account.fromWebCryptoP256(material.keyPair), material }
  if (material.privateKey)
    return { accessKey: Account.fromSecp256k1(material.privateKey), material }
  return undefined
}

export declare namespace resolve {
  type ReturnType = {
    /** A Viem account that signs with the access key. */
    accessKey: Account.Account
    /** What the authorization keeps to rebuild the access key. Empty for the app's own access key. */
    material: AccessKey.Material
  }
}
