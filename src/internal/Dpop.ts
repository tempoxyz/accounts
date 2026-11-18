/**
 * Holds a DPoP key (RFC 9449), and signs the proofs that bind an app's tokens to it. With a key on
 * the instance, each token request sends a proof, and Tempo ID issues `DPoP` tokens that work only
 * with a proof from the same key. The `dpop` plugin of `accounts/plugins` sets the instance's DPoP
 * key, and keeps it in the store.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { dpop } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ clientId: 'tempo-cli', plugins: [await dpop()] })
 * await accounts.session.refresh()
 * ```
 * @module
 */
import { Base64, Bytes, Hash, type WebCryptoP256 } from 'ox'

/**
 * How far the `iat` of each proof for Tempo ID lies before its signature, in seconds. Tempo ID refuses
 * an `iat` more than 5 seconds ahead of its clock, and accepts a proof for 300 seconds after it, so a
 * device clock up to 65 seconds fast, or 240 seconds slow, signs proofs that it accepts.
 */
const skew = 60

/**
 * A [DPoP key](https://github.com/tempoxyz/id/blob/main/docs/dpop.md), whose proofs bind the
 * instance's tokens: an ECDSA P-256 key pair whose private key signs each proof. A browser keeps it
 * in IndexedDB, which stores a non-extractable key without its private bytes. {@link proof} states
 * the `iat` of each proof.
 */
export type Dpop = {
  /**
   * The public P-256 key as a JWK. Each proof's header carries only its public members, `crv`, `kty`,
   * `x`, and `y`, so a JWK that also holds the private key sends no private member.
   */
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
 * Throws a `TypeError` that names the fix in a runtime without `crypto.subtle`, such as React
 * Native, which generates each DPoP key and signs its proofs. Without the check, the runtime's own
 * `TypeError` reads a property of `undefined`.
 *
 * @throws {TypeError} In a runtime without `crypto.subtle`.
 *
 * @example
 * ```ts
 * import { Dpop } from 'accounts/internal'
 *
 * Dpop.supported()
 * ```
 */
export function supported() {
  if (typeof globalThis.crypto?.subtle?.generateKey === 'function') return
  throw new TypeError(
    'Invalid DPoP key: the runtime has no `crypto.subtle`, which generates the key and signs its proofs. Install a `crypto.subtle` before the call, or create the instance without `dpop`.',
  )
}

/**
 * Generates a DPoP key. Its private key is non-extractable unless `extractable` is `true`, such as
 * for a CLI that writes the key to a file between runs.
 *
 * @throws {TypeError} In a runtime without `crypto.subtle`, such as React Native, as {@link supported}
 *   throws.
 *
 * @example
 * ```ts
 * const dpop = await Dpop.create()
 * ```
 */
export async function create(options: create.Options = {}): Promise<Dpop> {
  const { extractable = false } = options
  supported()
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
 * const auth = Accounts.create({ clientId: 'client_…', dpop: Dpop.fromKeyPair(keyPair) })
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
 * Returns the JWK thumbprint of a DPoP key (RFC 7638), which a DPoP token names in `cnf.jkt`.
 *
 * @example
 * ```ts
 * const jkt = Dpop.thumbprint(await Dpop.create())
 * ```
 */
export function thumbprint(dpop: Dpop): string {
  const { crv, kty, x, y } = dpop.jwk
  // RFC 7638 hashes the required members in lexicographic order, without whitespace.
  return Base64.fromBytes(
    Hash.sha256(Bytes.fromString(JSON.stringify({ crv, kty, x, y }))),
    { pad: false, url: true },
  )
}

/**
 * Returns a DPoP proof for one request: a JWT that the key signs over the request's method and URL.
 * A request with a DPoP access token passes it as `accessToken`, so the proof names its hash. Each
 * proof has a new `jti`, and Tempo ID refuses a proof that it already accepted. With `issuer`, its
 * `iat` lies 60 seconds before the signature, since Tempo ID refuses an `iat` more than 5 seconds
 * ahead of its clock. A device clock up to 65 seconds fast, or 240 seconds slow, thus signs proofs
 * that Tempo ID accepts. A proof for any other API holds the device's current time, so a verifier
 * with a short window accepts it.
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
  const { accessToken, issuer = false, method } = options
  const url = new URL(options.url)

  // The header names only the public members of the JWK, so a `jwk` that also holds the private
  // scalar `d`, such as an export of the private key, never leaves the device in a proof.
  const { crv, kty, x, y } = dpop.jwk
  const header = { alg: 'ES256', jwk: { crv, kty, x, y }, typ: 'dpop+jwt' }
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
    // The device's clock sets `iat`, so an earlier `iat` covers a clock that runs ahead of Tempo
    // ID's. Another API can accept a shorter window, so its proofs hold the current time.
    iat: Math.floor(Date.now() / 1000) - (issuer ? skew : 0),
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
    /**
     * Whether the request goes to Tempo ID, whose `iat` window allows 5 seconds of a fast clock.
     * Its proof's `iat` then lies 60 seconds before the signature. Defaults to `false`.
     */
    issuer?: boolean | undefined
    /** The request's HTTP method, such as `POST`. */
    method: string
    /** The request's URL. The proof leaves out its query and fragment. */
    url: string | URL
  }
}
