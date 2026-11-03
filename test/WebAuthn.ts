/**
 * A software authenticator for the integration tests: a P256 key that signs WebAuthn ceremonies as
 * a browser does.
 * @module
 */
import {
  Base64,
  Bytes,
  Cbor,
  CoseKey,
  Hash,
  Hex,
  P256,
  PublicKey,
  Signature,
} from 'ox'
import { Authentication, type Types } from 'ox/webauthn'

const base64url = { pad: false, url: true } as const

/** Creates a passkey for `rpId` whose ceremonies run at `origin`. */
export function create(options: create.Options) {
  const { origin, rpId } = options
  const privateKey = P256.randomPrivateKey()
  const publicKey = P256.getPublicKey({ privateKey })
  const id = Base64.fromBytes(
    crypto.getRandomValues(new Uint8Array(32)),
    base64url,
  )

  const passkey = {
    /**
     * Returns a `createFn` for `Registration.create`, which creates this passkey as
     * `navigator.credentials.create()` does, from `origin` if given.
     */
    createFn(options: { origin?: string | undefined } = {}) {
      return (
        request?: Types.CredentialCreationOptions,
      ): Promise<Types.Credential | null> => {
        const credential = passkey.register({
          challenge: bytes(request!.publicKey!.challenge),
          ...(options.origin ? { origin: options.origin } : {}),
        })
        return Promise.resolve({
          authenticatorAttachment: 'platform',
          getClientExtensionResults: () => ({}),
          id,
          rawId: buffer(Base64.toBytes(id)),
          response: {
            attestationObject: buffer(
              Base64.toBytes(credential.attestationObject),
            ),
            clientDataJSON: buffer(Base64.toBytes(credential.clientDataJSON)),
            // The SubjectPublicKeyInfo of a P256 key: its fixed DER prefix, then the uncompressed key.
            getPublicKey: () =>
              buffer(
                Bytes.concat(
                  Bytes.fromHex(
                    '0x3059301306072a8648ce3d020106082a8648ce3d030107034200',
                  ),
                  PublicKey.toBytes(publicKey),
                ),
              ),
          },
          type: 'public-key',
        } as unknown as Types.Credential)
      }
    },
    /**
     * Returns a `getFn` for `Authentication.sign`, which signs as `navigator.credentials.get()`
     * does, from `origin` if given.
     */
    getFn(options: { origin?: string | undefined } = {}) {
      return (
        request?: Types.CredentialRequestOptions,
      ): Promise<Types.Credential | null> => {
        const challenge = bytes(request!.publicKey!.challenge)
        const { metadata, payload } = Authentication.getSignPayload({
          challenge,
          flag: 0x05,
          origin: options.origin ?? origin,
          rpId,
          userVerification: 'required',
        })
        const signature = P256.sign({ hash: true, payload, privateKey })
        return Promise.resolve({
          authenticatorAttachment: 'platform',
          getClientExtensionResults: () => ({}),
          id,
          rawId: buffer(Base64.toBytes(id)),
          response: {
            authenticatorData: buffer(Hex.toBytes(metadata.authenticatorData)),
            clientDataJSON: buffer(Bytes.fromString(metadata.clientDataJSON)),
            signature: buffer(der(signature)),
          },
          type: 'public-key',
        } as unknown as Types.Credential)
      }
    },
    id,
    publicKey: PublicKey.toHex(publicKey),
    /**
     * Returns the credential that `navigator.credentials.create()` serializes, with a `none`
     * attestation.
     */
    register(options: register.Options) {
      const authenticatorData = Bytes.concat(
        Hash.sha256(Bytes.fromString(rpId)),
        new Uint8Array([options.flag ?? 0x45]),
        // The signature counter, then an all-zero AAGUID, as authenticators without attestation send.
        new Uint8Array(4),
        new Uint8Array(16),
        Bytes.fromNumber(Base64.toBytes(id).length, { size: 2 }),
        Base64.toBytes(id),
        Bytes.fromHex(CoseKey.fromPublicKey(publicKey)),
      )
      const attestationObject = Base64.fromBytes(
        Cbor.encode(
          { attStmt: {}, authData: authenticatorData, fmt: 'none' },
          { as: 'Bytes' },
        ),
        base64url,
      )
      const clientDataJSON = Base64.fromString(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: Base64.fromHex(options.challenge, base64url),
          origin: options.origin ?? origin,
          crossOrigin: options.crossOrigin ?? false,
        }),
        base64url,
      )
      return {
        attestationObject,
        clientDataJSON,
        id,
        publicKey: PublicKey.toHex(publicKey),
        raw: {
          authenticatorAttachment: 'platform',
          id,
          rawId: id,
          response: { attestationObject, clientDataJSON },
          type: 'public-key',
        },
      }
    },
    /** Returns the assertion that `navigator.credentials.get()` serializes. */
    sign(options: sign.Options) {
      const { metadata, payload } = Authentication.getSignPayload({
        challenge: options.challenge,
        crossOrigin: options.crossOrigin,
        ...(options.topOrigin
          ? { extraClientData: { topOrigin: options.topOrigin } }
          : {}),
        flag: options.flag ?? 0x05,
        origin: options.origin ?? origin,
        rpId,
        userVerification: options.flag === undefined ? 'required' : 'preferred',
      })
      // Fresh randomness per signature, as hedged authenticators sign, so two ceremonies over one
      // challenge return different signatures.
      const signature = P256.sign({
        extraEntropy: true,
        hash: true,
        payload,
        privateKey: options.privateKey ?? privateKey,
      })
      return {
        id,
        metadata,
        raw: {
          authenticatorAttachment: 'platform',
          id,
          rawId: id,
          response: {
            authenticatorData: Base64.fromHex(
              metadata.authenticatorData,
              base64url,
            ),
            clientDataJSON: Base64.fromString(
              metadata.clientDataJSON,
              base64url,
            ),
            signature: Base64.fromHex(Signature.toHex(signature), base64url),
          },
          type: 'public-key' as const,
        },
        signature: Signature.toHex(signature),
      }
    },
  }
  return passkey
}

export declare namespace create {
  type Options = {
    /** The origin of the passkey's ceremonies. */
    origin: string
    /** The relying party ID of the passkey. */
    rpId: string
  }
}

/** Types for a passkey's `register` method. */
export declare namespace register {
  /** The challenge, and any fields that a test overrides. */
  type Options = {
    /** The challenge from the creation options. */
    challenge: Hex.Hex
    /** Whether the ceremony ran in a cross-origin iframe. Defaults to `false`. */
    crossOrigin?: boolean | undefined
    /** The authenticator data flags. Defaults to `0x45`: user present, verified, and attested. */
    flag?: number | undefined
    /** The origin that the browser reports. Defaults to the passkey's own. */
    origin?: string | undefined
  }
}

/** Types for a passkey's `sign` method. */
export declare namespace sign {
  /** The challenge, and any fields that a test overrides. */
  type Options = {
    /** The challenge from the request options. */
    challenge: Hex.Hex
    /** Whether the ceremony ran in a cross-origin iframe. */
    crossOrigin?: boolean | undefined
    /** The authenticator data flags. Defaults to `0x05`: user present and verified. */
    flag?: number | undefined
    /** The origin that the browser reports. Defaults to the passkey's own. */
    origin?: string | undefined
    /** A key that signs in place of the passkey's own, to forge an assertion. */
    privateKey?: Hex.Hex | undefined
    /** The top-level origin that a browser reports for a cross-origin iframe. Absent, none. */
    topOrigin?: string | undefined
  }
}

/** Copies `bytes` into a new `ArrayBuffer`. */
function buffer(bytes: Uint8Array) {
  return bytes.slice().buffer
}

/** Returns a ceremony's challenge, as the browser receives it in the options, as hex. */
function bytes(source: Types.BufferSource) {
  return Hex.fromBytes(
    ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source),
  )
}

/** Encodes a P256 signature in ASN.1 DER, as an authenticator returns it. */
function der(signature: { r: bigint; s: bigint }) {
  const integer = (value: bigint) => {
    const bytes = Bytes.fromNumber(value)
    // A leading high bit would read as a negative integer, so it gains a zero byte.
    const positive =
      bytes[0]! & 0x80 ? Bytes.concat(new Uint8Array([0]), bytes) : bytes
    return Bytes.concat(new Uint8Array([0x02, positive.length]), positive)
  }
  const body = Bytes.concat(integer(signature.r), integer(signature.s))
  return Bytes.concat(new Uint8Array([0x30, body.length]), body)
}
