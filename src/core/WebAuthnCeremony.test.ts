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
})

describe('server: prefetch', () => {
  /** Serialized credential whose client data carries challenge `0x01`. */
  const credential = {
    attestationObject: 'AA',
    clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJBUSJ9',
    id: 'credential',
    publicKey: '0x04ab',
    raw: {
      authenticatorAttachment: null,
      id: 'credential',
      rawId: 'Y3JlZGVudGlhbA',
      response: { clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJBUSJ9' },
      type: 'public-key',
    },
  } as never

  /**
   * Issues registration challenges `0x01`, `0x02`, … and login challenges
   * `0x11`, `0x12`, …, with a challenge TTL of `ttl` seconds (none when
   * null), and records each request's path and body.
   */
  function stub(ttl: number | null = 300) {
    const requests: { body: unknown; path: string }[] = []
    let logins = 0
    let registrations = 0
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname.replace('/webauthn', '')
      const body = JSON.parse(String(init?.body ?? 'null'))
      requests.push({ body, path })
      if (path === '/login/options')
        return Response.json({
          options: { publicKey: { challenge: `0x1${++logins}`, rpId: 'example.com' } },
          ...(ttl === null ? {} : { ttl }),
        })
      if (path === '/register/options')
        return Response.json({
          options: {
            publicKey: {
              challenge: `0x0${++registrations}`,
              rp: { id: 'example.com', name: 'example.com' },
            },
          },
          ...(ttl === null ? {} : { ttl }),
        })
      return Response.json({ credentialId: 'credential', publicKey: '0x04ab' })
    })
    return requests
  }

  /** Waits for the two prefetch requests to answer. */
  async function prefetched(requests: readonly unknown[]) {
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve))
  }

  test('behavior: builds options from prefetched challenges and fetches the next', async () => {
    const requests = stub()
    const ceremony = WebAuthnCeremony.server({ url: 'https://example.com/webauthn' })

    ceremony.prefetch!()
    await prefetched(requests)
    const { options: registration } = await ceremony.getRegistrationOptions({ name: 'alice' })
    const { options: authentication } = await ceremony.getAuthenticationOptions({
      credentialId: 'abc',
    })
    await vi.waitFor(() => expect(requests).toHaveLength(4))

    expect({
      authentication: authentication.publicKey,
      registration: {
        challenge: registration.publicKey!.challenge,
        rp: registration.publicKey!.rp,
        user: registration.publicKey!.user.name,
      },
      requests,
    }).toMatchInlineSnapshot(`
      {
        "authentication": {
          "allowCredentials": [
            {
              "id": "abc",
              "type": "public-key",
            },
          ],
          "challenge": "0x11",
          "rpId": "example.com",
          "userVerification": "required",
        },
        "registration": {
          "challenge": "0x01",
          "rp": {
            "id": "example.com",
            "name": "example.com",
          },
          "user": "alice",
        },
        "requests": [
          {
            "body": {},
            "path": "/login/options",
          },
          {
            "body": {},
            "path": "/register/options",
          },
          {
            "body": {},
            "path": "/register/options",
          },
          {
            "body": {},
            "path": "/login/options",
          },
        ],
      }
    `)
  })

  test('behavior: sends the name with a registration whose challenge was prefetched', async () => {
    const requests = stub()
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://example.com/webauthn' })
    ceremony.prefetch!()
    await prefetched(requests)

    // Takes challenge `0x01`, the credential's. Verification sends the name
    // the options were built with, even when the caller omits it.
    await ceremony.getRegistrationOptions({ name: 'alice' })
    const { verified } = await ceremony.verifyRegistration(credential)
    await verified

    expect(requests.find(({ path }) => path === '/register')!.body).toMatchInlineSnapshot(`
      {
        "attestationObject": "AA",
        "clientDataJSON": "eyJjaGFsbGVuZ2UiOiJBUSJ9",
        "id": "credential",
        "name": "alice",
        "publicKey": "0x04ab",
        "raw": {
          "authenticatorAttachment": null,
          "id": "credential",
          "rawId": "Y3JlZGVudGlhbA",
          "response": {
            "clientDataJSON": "eyJjaGFsbGVuZ2UiOiJBUSJ9",
          },
          "type": "public-key",
        },
      }
    `)
  })

  test('behavior: a challenge taken for local options answers without a request', async () => {
    const requests = stub()
    const ceremony = WebAuthnCeremony.server({ url: 'https://example.com/webauthn' })
    ceremony.prefetch!()
    await prefetched(requests)

    const challenge = ceremony.takeChallenge!()
    const { options } = await ceremony.getAuthenticationOptions({ challenge, credentialId: 'abc' })
    await vi.waitFor(() => expect(requests).toHaveLength(3))

    expect({ challenge, options: options.publicKey, paths: requests.map(({ path }) => path) })
      .toMatchInlineSnapshot(`
        {
          "challenge": "0x11",
          "options": {
            "allowCredentials": [
              {
                "id": "abc",
                "type": "public-key",
              },
            ],
            "challenge": "0x11",
            "rpId": "example.com",
            "userVerification": "required",
          },
          "paths": [
            "/login/options",
            "/register/options",
            "/login/options",
          ],
        }
      `)
  })

  test('behavior: ignores challenges from a server that sends no TTL', async () => {
    const requests = stub(null)
    const ceremony = WebAuthnCeremony.server({ url: 'https://example.com/webauthn' })
    ceremony.prefetch!()
    await prefetched(requests)

    const { options } = await ceremony.getRegistrationOptions({ name: 'alice' })

    expect({
      challenge: options.publicKey!.challenge,
      requests: requests.slice(2),
    }).toMatchInlineSnapshot(`
      {
        "challenge": "0x03",
        "requests": [
          {
            "body": {},
            "path": "/register/options",
          },
          {
            "body": {
              "name": "alice",
            },
            "path": "/register/options",
          },
        ],
      }
    `)
  })

  test('behavior: stops using a prefetched challenge before the server TTL runs out', async () => {
    const requests = stub(60)
    const ceremony = WebAuthnCeremony.server({ url: 'https://example.com/webauthn' })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    ceremony.prefetch!()
    await prefetched(requests)

    // A 60 s TTL leaves 48 s to use the challenge.
    clock.mockReturnValue(now + 48_000)
    const { options } = await ceremony.getAuthenticationOptions()
    clock.mockRestore()

    expect({
      challenge: options.publicKey!.challenge,
      requests: requests.slice(2).map(({ path }) => path),
    }).toMatchInlineSnapshot(`
      {
        "challenge": "0x13",
        "requests": [
          "/login/options",
          "/login/options",
        ],
      }
    `)
  })

  test('behavior: without prefetch, fetches options for each ceremony', async () => {
    const requests = stub()
    const ceremony = WebAuthnCeremony.server({ url: 'https://example.com/webauthn' })

    expect(ceremony.takeChallenge!()).toMatchInlineSnapshot(`undefined`)
    await ceremony.getAuthenticationOptions()
    await ceremony.verifyRegistration(credential, { name: 'alice' })

    expect(requests).toMatchInlineSnapshot(`
      [
        {
          "body": {},
          "path": "/login/options",
        },
        {
          "body": {
            "attestationObject": "AA",
            "clientDataJSON": "eyJjaGFsbGVuZ2UiOiJBUSJ9",
            "id": "credential",
            "publicKey": "0x04ab",
            "raw": {
              "authenticatorAttachment": null,
              "id": "credential",
              "rawId": "Y3JlZGVudGlhbA",
              "response": {
                "clientDataJSON": "eyJjaGFsbGVuZ2UiOiJBUSJ9",
              },
              "type": "public-key",
            },
          },
          "path": "/register",
        },
      ]
    `)
  })
})

describe('deferred', () => {
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
    const ceremony = WebAuthnCeremony.deferred({
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
      () => new Response(null, { status: 204 }),
    ])
    const ceremony = WebAuthnCeremony.deferred({
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
        "/webauthn/logout",
      ]
    `)
  })

  test('error: a retry that finds the challenge consumed rejects', async () => {
    // The challenge may have expired, so it does not prove the server stored the credential.
    stub([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Response.json({ error: 'Missing or expired challenge' }, { status: 400 }),
    ])
    const ceremony = WebAuthnCeremony.deferred({
      url: 'https://wallet.example.com/webauthn',
    })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Missing or expired challenge]`,
    )
  })

  test('error: rejects when the server refuses the registration', async () => {
    stub([() => Response.json({ error: 'Missing or expired challenge' }, { status: 400 })])
    const ceremony = WebAuthnCeremony.deferred({
      url: 'https://wallet.example.com/webauthn',
    })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Missing or expired challenge]`,
    )
  })

  test('behavior: a retry without the session ends the session in place', async () => {
    const paths = stub([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Response.json({ error: 'Credential already exists' }, { status: 400 }),
      () => new Response(null, { status: 204 }),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })

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
        "/webauthn/logout",
      ]
    `)
  })

  test('error: a retry without the session rejects when it cannot end the session in place', async () => {
    stub([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Response.json({ error: 'Credential already exists' }, { status: 400 }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Failed to fetch]`,
    )
  })

  test('behavior: retries a JSON 5xx response', async () => {
    const paths = stub([
      () => Response.json({ error: 'Service unavailable' }, { status: 503 }),
      () => Response.json({ credentialId: 'credential' }),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).resolves.toMatchInlineSnapshot(`
      {
        "session": true,
      }
    `)
    expect(paths).toHaveLength(2)
  })

  test('error: a retry without the session rejects when logout answers with an error', async () => {
    stub([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Response.json({ error: 'Credential already exists' }, { status: 400 }),
      () => new Response(null, { status: 500 }),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Logout failed with status 500]`,
    )
  })

  test('error: rejects when the server stored a different public key', async () => {
    const paths = stub([
      () => Response.json({ credentialId: 'credential', publicKey: '0x04cd' }),
      () => new Response(null, { status: 204 }),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Server stored a different public key]`,
    )
    expect(paths).toMatchInlineSnapshot(`
      [
        "/webauthn/register (keepalive)",
        "/webauthn/logout",
      ]
    `)
  })

  test('error: a key mismatch rejects with the logout failure when it cannot end the session', async () => {
    stub([
      () => Response.json({ credentialId: 'credential', publicKey: '0x04cd' }),
      () => new Response(null, { status: 500 }),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })

    const { verified } = await ceremony.verifyRegistration(credential, { name: 'alice' })

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Logout failed with status 500]`,
    )
  })

  test('error: a cancelled verification rejects without retrying', async () => {
    const paths = stub([
      (init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
        ),
    ])
    const ceremony = WebAuthnCeremony.deferred({ url: 'https://wallet.example.com/webauthn' })
    const controller = new AbortController()

    const { verified } = await ceremony.verifyRegistration(credential, {
      name: 'alice',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(paths).toHaveLength(1))
    controller.abort(new Error('Cancelled'))

    await expect(verified).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Cancelled]`)
    expect(paths).toHaveLength(1)
  })
})
