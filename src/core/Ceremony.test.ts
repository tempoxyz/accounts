import { describe, expect, test } from 'vp/test'

import * as Ceremony from './Ceremony.js'

describe('from', () => {
  test('default: returns the ceremony', () => {
    const ceremony = Ceremony.from({
      getRegistrationOptions: async () => ({ options: {} as any }),
      verifyRegistration: async () => ({ credentialId: 'cred-1', publicKey: '0x1234' }),
      getAuthenticationOptions: async () => ({ options: {} as any }),
      verifyAuthentication: async () => ({ credentialId: 'cred-1', publicKey: '0x1234' }),
    })
    expect(ceremony).toBeDefined()
    expect(typeof ceremony.getRegistrationOptions).toMatchInlineSnapshot(`"function"`)
    expect(typeof ceremony.verifyRegistration).toMatchInlineSnapshot(`"function"`)
    expect(typeof ceremony.getAuthenticationOptions).toMatchInlineSnapshot(`"function"`)
    expect(typeof ceremony.verifyAuthentication).toMatchInlineSnapshot(`"function"`)
  })
})

describe('local', () => {
  test('default: creates a ceremony', () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })
    expect(ceremony).toBeDefined()
  })

  test('behavior: getRegistrationOptions returns serialized options', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    const { options } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rp.id).toMatchInlineSnapshot(`"example.com"`)
    expect(options.publicKey!.rp.name).toMatchInlineSnapshot(`"example.com"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
    expect(options.publicKey!.authenticatorSelection).toBeDefined()
  })

  test('behavior: getAuthenticationOptions returns serialized options', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    const { options } = await ceremony.getAuthenticationOptions()
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rpId).toMatchInlineSnapshot(`"example.com"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
  })

  test('behavior: verifyRegistration stores credential and returns publicKey', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    const result = await ceremony.verifyRegistration({
      attestationObject: 'mock',
      clientDataJSON: 'mock',
      id: 'cred-1',
      publicKey: '0xabcd',
      raw: {
        id: 'cred-1',
        type: 'public-key',
        authenticatorAttachment: null,
        rawId: 'cred-1',
        response: { clientDataJSON: 'mock' },
      },
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "credentialId": "cred-1",
        "publicKey": "0xabcd",
      }
    `)
  })

  test('behavior: verifyAuthentication returns stored publicKey', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    // Register first to store the credential
    await ceremony.verifyRegistration({
      attestationObject: 'mock',
      clientDataJSON: 'mock',
      id: 'cred-1',
      publicKey: '0xabcd',
      raw: {
        id: 'cred-1',
        type: 'public-key',
        authenticatorAttachment: null,
        rawId: 'cred-1',
        response: { clientDataJSON: 'mock' },
      },
    })

    const result = await ceremony.verifyAuthentication({
      id: 'cred-1',
      metadata: {
        authenticatorData: '0x00',
        clientDataJSON: '{}',
      },
      raw: {
        id: 'cred-1',
        type: 'public-key',
        authenticatorAttachment: null,
        rawId: 'cred-1',
        response: { clientDataJSON: 'mock' },
      },
      signature: '0x00',
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "credentialId": "cred-1",
        "publicKey": "0xabcd",
      }
    `)
  })

  test('error: verifyAuthentication throws for unknown credential', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    await expect(
      ceremony.verifyAuthentication({
        id: 'unknown',
        metadata: {
          authenticatorData: '0x00',
          clientDataJSON: '{}',
        },
        raw: {
          id: 'unknown',
          type: 'public-key',
          authenticatorAttachment: null,
          rawId: 'unknown',
          response: { clientDataJSON: 'mock' },
        },
        signature: '0x00',
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Unknown credential: unknown]`)
  })

  test('behavior: each call to getRegistrationOptions generates a unique challenge', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    const { options: a } = await ceremony.getRegistrationOptions({ name: 'Test' })
    const { options: b } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })

  test('behavior: each call to getAuthenticationOptions generates a unique challenge', async () => {
    const ceremony = Ceremony.local({ rpId: 'example.com' })

    const { options: a } = await ceremony.getAuthenticationOptions()
    const { options: b } = await ceremony.getAuthenticationOptions()
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})
