import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as WebAuthnCeremony from './WebAuthnCeremony.js'

afterEach(() => vi.unstubAllGlobals())

describe('from', () => {
  test('default: returns the ceremony', () => {
    const ceremony = WebAuthnCeremony.from({
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
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })
    expect(ceremony).toBeDefined()
  })

  test('behavior: getRegistrationOptions returns serialized options', async () => {
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

    const { options } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rp.id).toMatchInlineSnapshot(`"example.com"`)
    expect(options.publicKey!.rp.name).toMatchInlineSnapshot(`"example.com"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
    expect(options.publicKey!.authenticatorSelection).toBeDefined()
  })

  test('behavior: getAuthenticationOptions returns serialized options', async () => {
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

    const { options } = await ceremony.getAuthenticationOptions()
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rpId).toMatchInlineSnapshot(`"example.com"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
  })

  test('behavior: getAuthenticationOptions restricts authentication to multiple credentials', async () => {
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

    const { options } = await ceremony.getAuthenticationOptions({
      credentialId: ['Y3JlZC0x', 'Y3JlZC0y'],
    })

    expect(options.publicKey?.allowCredentials).toMatchInlineSnapshot(`
      [
        {
          "id": "Y3JlZC0x",
          "type": "public-key",
        },
        {
          "id": "Y3JlZC0y",
          "type": "public-key",
        },
      ]
    `)
  })

  test('behavior: verifyRegistration stores credential and returns publicKey', async () => {
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

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
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

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
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

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
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

    const { options: a } = await ceremony.getRegistrationOptions({ name: 'Test' })
    const { options: b } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })

  test('behavior: each call to getAuthenticationOptions generates a unique challenge', async () => {
    const ceremony = WebAuthnCeremony.local({ rpId: 'example.com' })

    const { options: a } = await ceremony.getAuthenticationOptions()
    const { options: b } = await ceremony.getAuthenticationOptions()
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('server', () => {
  test('uses the default credential mode when omitted', async () => {
    let request: RequestInit | undefined
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      request = init
      return Response.json({ options: {} })
    })

    const ceremony = WebAuthnCeremony.server({ url: 'https://wallet.example.com/webauthn' })
    await ceremony.getRegistrationOptions({ name: 'Test' })

    expect(request?.credentials).toMatchInlineSnapshot(`undefined`)
  })

  test('includes configured credentials in ceremony requests', async () => {
    let request: RequestInit | undefined
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      request = init
      return Response.json({ options: {} })
    })

    const ceremony = WebAuthnCeremony.server({
      credentials: 'include',
      url: 'https://wallet.example.com/webauthn',
    })
    await ceremony.getRegistrationOptions({ name: 'Test' })

    expect({ credentials: request?.credentials, method: request?.method }).toMatchInlineSnapshot(`
      {
        "credentials": "include",
        "method": "POST",
      }
    `)
  })

  describe('deferRegistration', () => {
    const credential = { id: 'credential', publicKey: '0x04ab' } as never

    /** Answers each `/register` with the next of `responses`, recording the paths. */
    function stub(responses: ((init?: RequestInit) => Response | Promise<Response>)[]) {
      const paths: string[] = []
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        paths.push(`${new URL(input).pathname}${init?.keepalive ? ' (keepalive)' : ''}`)
        return await responses.shift()!(init)
      })
      return paths
    }

    test('behavior: returns the public key before the server stores the credential', async () => {
      let release = () => {}
      const paths = stub([
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(Response.json({ credentialId: 'credential' }))
          }),
      ])
      const ceremony = WebAuthnCeremony.server({
        deferRegistration: true,
        url: 'https://wallet.example.com/webauthn',
      })

      const { verified, ...result } = await ceremony.verifyRegistration(credential, {
        name: 'alice',
      })

      expect(result).toMatchInlineSnapshot(`
        {
          "credentialId": "credential",
          "publicKey": "0x04ab",
        }
      `)
      await vi.waitFor(() => expect(paths).toHaveLength(1))
      release()
      await expect(verified).resolves.toMatchInlineSnapshot(`
        {
          "session": true,
        }
      `)
    })

    test('behavior: retries a request that failed in transit', async () => {
      const paths = stub([
        () => Promise.reject(new TypeError('Failed to fetch')),
        () => new Response('Bad Gateway', { status: 502 }),
        // The first attempt registered the credential before its response was lost.
        () => Response.json({ error: 'Credential already exists' }, { status: 400 }),
      ])
      const ceremony = WebAuthnCeremony.server({
        deferRegistration: true,
        url: 'https://wallet.example.com/webauthn',
      })

      const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

      await expect(verified).resolves.toMatchInlineSnapshot(`
        {
          "session": false,
        }
      `)
      expect(paths).toMatchInlineSnapshot(`
        [
          "/webauthn/register (keepalive)",
          "/webauthn/register (keepalive)",
          "/webauthn/register (keepalive)",
        ]
      `)
    })

    test('behavior: stops waiting for a slow request without retrying it', async () => {
      vi.useFakeTimers()
      // A slow server may still store the credential, so the request is left running.
      const paths = stub([() => new Promise<Response>(() => {})])
      const ceremony = WebAuthnCeremony.server({
        deferRegistration: true,
        url: 'https://wallet.example.com/webauthn',
      })

      const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })
      await vi.advanceTimersByTimeAsync(10_000)
      vi.useRealTimers()

      await expect(verified).resolves.toMatchInlineSnapshot(`
        {
          "session": false,
        }
      `)
      expect(paths).toMatchInlineSnapshot(`
        [
          "/webauthn/register (keepalive)",
        ]
      `)
    })

    test('error: a retry that finds the challenge consumed rejects', async () => {
      // The challenge may have expired, so it does not prove the server stored the credential.
      stub([
        () => Promise.reject(new TypeError('Failed to fetch')),
        () => Response.json({ error: 'Missing or expired challenge' }, { status: 400 }),
      ])
      const ceremony = WebAuthnCeremony.server({
        deferRegistration: true,
        url: 'https://wallet.example.com/webauthn',
      })

      const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

      await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Missing or expired challenge]`,
      )
    })

    test('error: rejects when the server refuses the registration', async () => {
      stub([() => Response.json({ error: 'Missing or expired challenge' }, { status: 400 })])
      const ceremony = WebAuthnCeremony.server({
        deferRegistration: true,
        url: 'https://wallet.example.com/webauthn',
      })

      const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

      await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Missing or expired challenge]`,
      )
    })
  })
})
