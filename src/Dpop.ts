/**
 * Holds a DPoP key (RFC 9449), and signs the proofs that bind an app's tokens to it. With a key on
 * the instance, each token request sends a proof, and Tempo ID issues `DPoP` tokens that work only
 * with a proof from the same key.
 *
 * @example
 * ```ts
 * import { Dpop, Id } from 'accounts'
 *
 * const tempoId = Id.create({ clientId: 'tempo-cli', dpop: await Dpop.create() })
 * await tempoId.session.refresh()
 * ```
 * @module
 */
import { Base64, Bytes, Hash, type WebCryptoP256 } from 'ox'

/**
 * A DPoP key: an ECDSA P-256 key pair whose private key signs each proof. A browser keeps it in
 * IndexedDB, which stores a non-extractable key without its private bytes.
 */
export type Dpop = {
  /** The public key as a JWK, which each proof's header carries. */
  jwk: Dpop.Jwk
  /** The private key, which signs each proof with ES256. */
  privateKey: CryptoKey
}

export declare namespace Dpop {
  /** A public P-256 key as a JWK (RFC 7517). */
  type Jwk = {
    /** Always `P-256`. */
    crv: string
    /** Always `EC`. */
    kty: string
    /** The x coordinate, base64url. */
    x: string
    /** The y coordinate, base64url. */
    y: string
  }
}

/**
 * Generates a DPoP key. Its private key is non-extractable unless `extractable` is `true`, such as
 * for a CLI that writes the key to a file between runs.
 *
 * @example
 * ```ts
 * const dpop = await Dpop.create()
 * ```
 */
export async function create(options: create.Options = {}): Promise<Dpop> {
  const { extractable = false } = options
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    extractable,
    ['sign', 'verify'],
  )
  // A public key is always extractable.
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return from({
    jwk: { crv: jwk.crv!, kty: jwk.kty!, x: jwk.x!, y: jwk.y! },
    privateKey: pair.privateKey,
  })
}

export declare namespace create {
  type Options = {
    /** Whether `crypto.subtle.exportKey` can export the private key. Defaults to `false`. */
    extractable?: boolean | undefined
  }
}

/**
 * Instantiates a {@link Dpop}, such as from a key that IndexedDB stored.
 *
 * @example
 * ```ts
 * const dpop = Dpop.from(await idb.get('dpop'))
 * ```
 */
export function from(value: Dpop): Dpop {
  return value
}

/**
 * Returns the DPoP key of a WebCrypto P256 key pair, such as the one that the app creates for its
 * access key, so one non-extractable key pair signs both transactions and proofs. The app passes
 * the pair's account as the sign-in's `accessKey`, and this key as the instance's `dpop`, so the
 * sign-in's redemption binds the tokens to the same pair.
 *
 * @example
 * ```ts
 * const keyPair = await WebCryptoP256.createKeyPair()
 * const auth = Id.create({ clientId: 'client_…', dpop: Dpop.fromKeyPair(keyPair) })
 * await Actions.email.signIn(auth, { accessKey: Account.fromWebCryptoP256(keyPair), code, email })
 * ```
 */
export function fromKeyPair(
  keyPair: WebCryptoP256.createKeyPair.ReturnType,
): Dpop {
  const { privateKey, publicKey } = keyPair
  const coordinate = (value: bigint) =>
    Base64.fromBytes(Bytes.fromNumber(value, { size: 32 }), {
      pad: false,
      url: true,
    })
  return from({
    jwk: {
      crv: 'P-256',
      kty: 'EC',
      x: coordinate(publicKey.x),
      y: coordinate(publicKey.y),
    },
    privateKey,
  })
}

/**
 * Returns a DPoP proof for one request: a JWT that the key signs over the request's method and URL.
 * A request with a DPoP access token passes it as `accessToken`, so the proof names its hash. Each
 * proof has a new `jti`, and Tempo ID refuses a proof that it already accepted.
 *
 * @example
 * ```ts
 * const response = await fetch(url, {
 *   headers: {
 *     authorization: `DPoP ${tokens.accessToken}`,
 *     dpop: await Dpop.proof(dpop, { accessToken: tokens.accessToken, method: 'GET', url }),
 *   },
 * })
 * ```
 */
export async function proof(
  dpop: Dpop,
  options: proof.Options,
): Promise<string> {
  const { accessToken, method } = options
  const url = new URL(options.url)

  const header = { alg: 'ES256', jwk: dpop.jwk, typ: 'dpop+jwt' }
  const payload = {
    ...(accessToken === undefined
      ? {}
      : {
          ath: Base64.fromBytes(Hash.sha256(Bytes.fromString(accessToken)), {
            pad: false,
            url: true,
          }),
        }),
    htm: method.toUpperCase(),
    // The proof names the URL without its query and fragment (RFC 9449 §4.2).
    htu: `${url.origin}${url.pathname}`,
    iat: Math.floor(Date.now() / 1000),
    // React Native's shim provides `getRandomValues` only, not `randomUUID`.
    jti: Base64.fromBytes(crypto.getRandomValues(new Uint8Array(16)), {
      pad: false,
      url: true,
    }),
  }
  const input = [header, payload]
    .map((part) =>
      Base64.fromString(JSON.stringify(part), { pad: false, url: true }),
    )
    .join('.')
  // WebCrypto returns the signature as `r || s`, which is the JWS form of ES256.
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    dpop.privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${Base64.fromBytes(new Uint8Array(signature), { pad: false, url: true })}`
}

export declare namespace proof {
  type Options = {
    /** The DPoP access token that the request sends. Absent for a request to the token endpoint. */
    accessToken?: string | undefined
    /** The request's HTTP method, such as `POST`. */
    method: string
    /** The request's URL. The proof leaves out its query and fragment. */
    url: string | URL
  }
}
