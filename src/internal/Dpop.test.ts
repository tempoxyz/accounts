/**
 * Tests `Dpop.proof`: the proofs that Tempo ID accepts, also from a device whose clock runs ahead of
 * its clock, and the proofs that another API accepts.
 * @module
 */
import { EmbeddedJWK, jwtVerify } from 'jose'
import { Base64 } from 'ox'
import { describe, expect, test } from 'vite-plus/test'
import * as Dpop from './Dpop.js'

describe('Dpop.proof', () => {
  test("signs a proof for Tempo ID that it accepts when the device's clock runs up to 60 seconds ahead of the issuer's", async () => {
    const dpop = await Dpop.create()
    const url = 'https://id.example.com/oauth2/token'

    const proof = await Dpop.proof(dpop, { issuer: true, method: 'POST', url })
    // Tempo ID accepts a proof for 300 seconds after its `iat`, and an `iat` at most 5 seconds
    // ahead of its own clock, which here runs 60 seconds behind the device's.
    const verified = await jwtVerify(proof, EmbeddedJWK, {
      clockTolerance: 5,
      currentDate: new Date(Date.now() - 60_000),
      maxTokenAge: 300,
      requiredClaims: ['htm', 'htu', 'iat', 'jti'],
      typ: 'dpop+jwt',
    }).then(
      (result) => ({ htm: result.payload.htm, htu: result.payload.htu }),
      (error: Error) => `${error.name}: ${error.message}`,
    )

    expect(verified).toMatchInlineSnapshot(`
      {
        "htm": "POST",
        "htu": "https://id.example.com/oauth2/token",
      }
    `)
  })
  test("signs a proof for another API that a verifier with a 30-second window accepts at the device's own clock", async () => {
    const dpop = await Dpop.create()
    const url = 'https://api.example.com/me'

    const proof = await Dpop.proof(dpop, { method: 'GET', url })
    const verified = await jwtVerify(proof, EmbeddedJWK, {
      maxTokenAge: 30,
      requiredClaims: ['htm', 'htu', 'iat', 'jti'],
      typ: 'dpop+jwt',
    }).then(
      (result) => ({ htm: result.payload.htm, htu: result.payload.htu }),
      (error: Error) => `${error.name}: ${error.message}`,
    )

    expect(verified).toMatchInlineSnapshot(`
      {
        "htm": "GET",
        "htu": "https://api.example.com/me",
      }
    `)
  })

  test('sends only the public members of a JWK that also holds the private key, such as one that the app exported', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    // An app that keeps its own DPoP key may pass the private key's export as `jwk`.
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const dpop = Dpop.from({
      jwk: jwk as Dpop.Dpop.Jwk,
      privateKey: pair.privateKey,
    })

    const proof = await Dpop.proof(dpop, {
      method: 'GET',
      url: 'https://api.example.com/me',
    })
    const header = JSON.parse(
      new TextDecoder().decode(Base64.toBytes(proof.split('.')[0]!)),
    ) as { jwk: Record<string, unknown> }

    expect(Object.keys(header.jwk).sort()).toMatchInlineSnapshot(`
      [
        "crv",
        "kty",
        "x",
        "y",
      ]
    `)
  })
})
