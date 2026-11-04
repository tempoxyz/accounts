/**
 * Signs client assertions (RFC 7523) on an app's backend, which authenticate an app with
 * `private_key_jwt` in place of a client secret. Each request carries a new assertion, which
 * Tempo ID accepts once.
 *
 * @example
 * ```ts
 * import { ClientAssertion } from 'accounts/internal'
 *
 * const auth = Accounts.create({
 *   clientAssertion: ClientAssertion.fromPrivateKey({ privateKey: JSON.parse(process.env.TEMPO_ID_PRIVATE_KEY!) }),
 *   clientId: 'DkqRtYbW…',
 * })
 * ```
 * @module
 */
import { importJWK, importPKCS8, type JWK, SignJWT } from 'jose'

/** The signing algorithms that Tempo ID accepts for a client assertion. */
export type Algorithm =
  | 'EdDSA'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'

/**
 * Returns a new client assertion for the app with `clientId`, addressed to `audience`. `Config`
 * calls it before each request that authenticates the app.
 */
export type Signer = (options: {
  /** Tempo ID's issuer, such as `https://id.tempo.xyz`, which each endpoint accepts as `aud`. */
  audience: string
  /** The app's client ID, which the assertion holds as `iss` and `sub`. */
  clientId: string
}) => Promise<string>

/**
 * Returns a {@link Signer} that signs with `privateKey`. The public half of the key is registered
 * on the app, with the same `kid`.
 *
 * @example
 * ```ts
 * const clientAssertion = ClientAssertion.fromPrivateKey({ privateKey: jwk })
 * ```
 */
export function fromPrivateKey(options: fromPrivateKey.Options): Signer {
  return (context) => sign({ ...options, ...context })
}

export declare namespace fromPrivateKey {
  type Options = Omit<sign.Options, 'audience' | 'clientId'>
}

/**
 * Signs one client assertion: `iss` and `sub` are the client ID, `aud` is `audience`, and `jti` is
 * a new random value. It expires after `expiresIn` seconds.
 *
 * @example
 * ```ts
 * const assertion = await ClientAssertion.sign({
 *   audience: 'https://id.tempo.xyz',
 *   clientId: 'DkqRtYbW…',
 *   privateKey: jwk,
 * })
 * ```
 */
export async function sign(options: sign.Options): Promise<string> {
  const { audience, clientId, expiresIn = 60, privateKey } = options
  const jwk = typeof privateKey === 'string' ? undefined : privateKey
  // An EC or OKP key without `alg` signs with its curve's algorithm, and a PEM key with RS256.
  const algorithm =
    options.algorithm ??
    (jwk?.alg as Algorithm | undefined) ??
    curves[jwk?.crv ?? ''] ??
    'RS256'
  const keyId = options.keyId ?? jwk?.kid
  const key = jwk
    ? await importJWK(jwk, algorithm)
    : await importPKCS8(privateKey as string, algorithm)
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({})
    .setProtectedHeader({
      alg: algorithm,
      typ: 'JWT',
      ...(keyId ? { kid: keyId } : {}),
    })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .setJti(crypto.randomUUID())
    .sign(key)
}

export declare namespace sign {
  type Options = {
    /**
     * The signing algorithm, such as `ES256` or `EdDSA`. Defaults to the JWK's `alg`, else the
     * algorithm of its curve, else `RS256`.
     */
    algorithm?: Algorithm | undefined
    /** The `aud`: Tempo ID's issuer, such as `https://id.tempo.xyz`. */
    audience: string
    /** The app's client ID. */
    clientId: string
    /** The seconds until the assertion expires, up to 300. Defaults to 60. */
    expiresIn?: number | undefined
    /** The `kid` of the registered public key. Defaults to the JWK's `kid`. */
    keyId?: string | undefined
    /**
     * The private key, as a JWK, whose `kid` names the registered public key, or a PKCS #8 PEM
     * string. Only the app's backend holds it.
     */
    privateKey: JWK | string
  }
}

/** The `private_key_jwt` algorithm of each curve of an EC or OKP key. */
const curves: Record<string, Algorithm | undefined> = {
  Ed25519: 'EdDSA',
  'P-256': 'ES256',
  'P-384': 'ES384',
  'P-521': 'ES512',
}
