import { Base64, Bytes, Hash, Hex, PublicKey } from 'ox'
import { Authenticator } from 'ox/webauthn'

/**
 * Creates an in-memory WebAuthn authenticator for Node tests.
 *
 * Implements the `navigator.credentials` `create` / `get` surface with real
 * P-256 keys, attestation objects and assertion signatures, so the WebAuthn
 * adapter and `Handler.webAuthn` run unmodified ceremonies. Every call is
 * recorded with a timestamp for ordering assertions.
 */
export function create(options: create.Options) {
  const { origin, rpId } = options
  const keys = new Map<string, { keyPair: CryptoKeyPair; signCount: number }>()
  const calls: { method: 'create' | 'get'; time: number }[] = []

  const credentials = {
    async create(request: { publicKey: PublicKeyCredentialCreationOptions }) {
      calls.push({ method: 'create', time: performance.now() })
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )
      const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
      const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
      const rawId = Bytes.random(16)
      const id = Base64.fromBytes(rawId, { pad: false, url: true })
      keys.set(id, { keyPair, signCount: 0 })

      const authenticatorData = Authenticator.getAuthenticatorData({
        credential: { id: rawId, publicKey: PublicKey.from(publicKey) },
        flag: 0x45,
        rpId,
      })
      const clientDataJSON = Authenticator.getClientDataJSON({
        challenge: toHex(request.publicKey.challenge),
        origin,
        type: 'webauthn.create',
      })
      return {
        authenticatorAttachment: 'platform',
        getClientExtensionResults: () => ({}),
        id,
        rawId: toBuffer(rawId),
        response: {
          attestationObject: toBuffer(
            Bytes.fromHex(Authenticator.getAttestationObject({ authData: authenticatorData })),
          ),
          clientDataJSON: toBuffer(Bytes.fromString(clientDataJSON)),
          getAuthenticatorData: () => toBuffer(Bytes.fromHex(authenticatorData)),
          getPublicKey: () => spki,
          getPublicKeyAlgorithm: () => -7,
          getTransports: () => ['internal'],
        },
        type: 'public-key',
      }
    },
    async get(request: { publicKey: PublicKeyCredentialRequestOptions }) {
      calls.push({ method: 'get', time: performance.now() })
      const allowed = request.publicKey.allowCredentials?.map((credential) =>
        Base64.fromBytes(new Uint8Array(toBytes(credential.id)), { pad: false, url: true }),
      )
      const id = allowed?.find((id) => keys.has(id)) ?? [...keys.keys()].at(-1)
      const key = id ? keys.get(id) : undefined
      if (!id || !key) throw new Error('No credential available.')
      key.signCount += 1

      const authenticatorData = Bytes.fromHex(
        Authenticator.getAuthenticatorData({ flag: 0x05, rpId, signCount: key.signCount }),
      )
      const clientDataJSON = Bytes.fromString(
        Authenticator.getClientDataJSON({
          challenge: toHex(request.publicKey.challenge),
          origin,
          type: 'webauthn.get',
        }),
      )
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          { hash: 'SHA-256', name: 'ECDSA' },
          key.keyPair.privateKey,
          toBuffer(Bytes.concat(authenticatorData, Hash.sha256(clientDataJSON))),
        ),
      )
      return {
        authenticatorAttachment: 'platform',
        getClientExtensionResults: () => ({}),
        id,
        rawId: toBuffer(Base64.toBytes(id)),
        response: {
          authenticatorData: toBuffer(authenticatorData),
          clientDataJSON: toBuffer(clientDataJSON),
          signature: toBuffer(toDer(signature)),
          userHandle: null,
        },
        type: 'public-key',
      }
    },
  }

  return {
    /** Ceremony calls in order, with `performance.now()` timestamps. */
    calls,
    /** `navigator.credentials`-compatible surface. */
    credentials,
  }
}

export declare namespace create {
  type Options = {
    /** Origin written into client data (must match the relying party server). */
    origin: string
    /** Relying party ID scoped into authenticator data. */
    rpId: string
  }
}

function toBytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}

function toHex(source: BufferSource): Hex.Hex {
  return Hex.fromBytes(toBytes(source))
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

/** Encodes a raw `r || s` P-256 signature (WebCrypto output) as ASN.1 DER. */
function toDer(signature: Uint8Array): Uint8Array {
  function integer(bytes: Uint8Array) {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value: Uint8Array = bytes.slice(start)
    if (value[0]! & 0x80) value = Bytes.concat(new Uint8Array([0]), value)
    return Bytes.concat(new Uint8Array([0x02, value.length]), value)
  }
  const body = Bytes.concat(integer(signature.slice(0, 32)), integer(signature.slice(32)))
  return Bytes.concat(new Uint8Array([0x30, body.length]), body)
}
