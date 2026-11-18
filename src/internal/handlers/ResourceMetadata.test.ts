/**
 * Tests the metadata routes of `accounts.handler` with `connections.metadata`: the documents that
 * Tempo ID reads to discover an API, and the client assertions that the app's document verifies.
 * @module
 */
import { createLocalJWKSet, decodeJwt, generateKeyPair, jwtVerify } from 'jose'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../../Accounts.js'
import * as Memory from '../../stores/Memory.js'

async function api() {
  const pair = await generateKeyPair('ES256', { extractable: true })
  // Web Crypto exports a private JWK with `key_ops: ['sign']`, which the public key must not keep.
  const privateKey = {
    ...(await crypto.subtle.exportKey('jwk', pair.privateKey as CryptoKey)),
    alg: 'ES256',
    kid: 'api',
  }
  return Accounts.create({
    chain: 'testnet',
    connections: {
      metadata: {
        accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
        name: 'Example API',
        privateKey,
      },
      resource: 'https://api.example/mcp',
      store: Memory.create(),
    },
    handler: { basePath: '/accounts' },
  })
}

describe('accounts.handler', () => {
  test("serves the protected resource metadata, with the handler's access key endpoint and the policy's limits in base units on the instance's chain", async () => {
    const accounts = await api()

    const response = await accounts.handler.fetch(
      new Request(
        'https://api.example/.well-known/oauth-protected-resource/mcp',
      ),
    )
    const body = (await response.json()) as {
      tempo_access_key_policy: Record<string, unknown>
    }

    expect(accounts.config.clientId).toMatchInlineSnapshot(
      `"https://api.example/accounts/client.json"`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect({
      ...body,
      tempo_access_key_policy: {
        ...body.tempo_access_key_policy,
        scopes: undefined,
      },
    }).toMatchInlineSnapshot(`
      {
        "authorization_servers": [
          "https://id.tempo.xyz",
        ],
        "resource": "https://api.example/mcp",
        "tempo_access_key_policy": {
          "access_key_endpoint": "https://api.example/accounts/access-keys",
          "chain_id": 42431,
          "client_id": "https://api.example/accounts/client.json",
          "lifetime": 2592000,
          "limits": [
            {
              "limit": "0x17d7840",
              "token": "0x20c0000000000000000000006a37DA5C996874BE",
            },
          ],
          "scopes": undefined,
        },
      }
    `)
  })

  test("serves the app's document without the private key, and its key verifies the instance's client assertion", async () => {
    const accounts = await api()

    const document = (await (
      await accounts.handler.fetch(
        new Request('https://api.example/accounts/client.json'),
      )
    ).json()) as { jwks: { keys: Record<string, unknown>[] } }
    const assertion = await accounts.config.clientAssertion!({
      audience: 'https://id.tempo.xyz',
      clientId: accounts.config.clientId,
    })
    const verified = await jwtVerify(
      assertion,
      createLocalJWKSet(document.jwks as never),
      { audience: 'https://id.tempo.xyz' },
    )

    expect({ ...document, jwks: undefined }).toMatchInlineSnapshot(`
      {
        "client_id": "https://api.example/accounts/client.json",
        "client_name": "Example API",
        "grant_types": [
          "refresh_token",
        ],
        "jwks": undefined,
        "token_endpoint_auth_method": "private_key_jwt",
      }
    `)
    expect(document.jwks.keys.map((key) => Object.keys(key).sort()))
      .toMatchInlineSnapshot(`
      [
        [
          "alg",
          "crv",
          "kid",
          "kty",
          "x",
          "y",
        ],
      ]
    `)
    expect(verified.payload.iss).toBe(accounts.config.clientId)
  })

  test("publishes the next key's public half beside the signing key, so a document from before a rotation verifies the next key's assertion", async () => {
    const [current, next] = await Promise.all(
      ['current', 'next'].map(async (kid) => {
        const pair = await generateKeyPair('ES256', { extractable: true })
        return {
          ...(await crypto.subtle.exportKey(
            'jwk',
            pair.privateKey as CryptoKey,
          )),
          alg: 'ES256',
          kid,
        }
      }),
    )
    const create = (
      privateKey: NonNullable<typeof current>,
      publicKeys: readonly NonNullable<typeof current>[],
    ) =>
      Accounts.create({
        chain: 'testnet',
        connections: {
          metadata: {
            accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
            privateKey,
            publicKeys,
          },
          resource: 'https://api.example/mcp',
          store: Memory.create(),
        },
      })
    const before = create(current!, [next!])
    const after = create(next!, [])

    const document = (await (
      await before.handler.fetch(
        new Request('https://api.example/api/client.json'),
      )
    ).json()) as { jwks: { keys: Record<string, unknown>[] } }
    const assertion = await after.config.clientAssertion!({
      audience: 'https://id.tempo.xyz',
      clientId: after.config.clientId,
    })
    const verified = await jwtVerify(
      assertion,
      createLocalJWKSet(document.jwks as never),
      { audience: 'https://id.tempo.xyz' },
    )
    const refused = await Promise.all(
      [
        create(current!, [{ ...next!, kid: 'current' }]),
        create({ ...current!, kid: '' }, [next!]),
      ].map((accounts) =>
        accounts.handler
          .fetch(new Request('https://api.example/api/client.json'))
          .catch((error: Error) => error.message),
      ),
    )

    expect(document.jwks.keys.map((key) => [key.kid, 'd' in key]))
      .toMatchInlineSnapshot(`
      [
        [
          "current",
          false,
        ],
        [
          "next",
          false,
        ],
      ]
    `)
    expect(verified.protectedHeader.kid).toBe('next')
    expect(refused).toMatchInlineSnapshot(`
      [
        "Invalid \`metadata.publicKeys\`: a key has no \`kid\`, an empty one, or shares the \`kid\` of another key. Give each key its own \`kid\`.",
        "Invalid \`metadata.publicKeys\`: a key has no \`kid\`, an empty one, or shares the \`kid\` of another key. Give each key its own \`kid\`.",
      ]
    `)
  })

  test("signs for the issuer, not the instance's url, when the instance reaches Tempo ID at another address", async () => {
    const pair = await generateKeyPair('ES256', { extractable: true })
    const accounts = Accounts.create({
      chain: 'testnet',
      connections: {
        issuer: 'https://id.tempo.xyz/',
        metadata: {
          accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
          privateKey: {
            ...(await crypto.subtle.exportKey(
              'jwk',
              pair.privateKey as CryptoKey,
            )),
            kid: 'api',
          },
        },
        resource: 'https://api.example/mcp',
        store: Memory.create(),
      },
      url: 'http://10.0.0.2:8787',
    })

    const assertion = await accounts.config.clientAssertion!({
      audience: accounts.config.url,
      clientId: accounts.config.clientId,
    })

    expect(decodeJwt(assertion).aud).toBe('https://id.tempo.xyz')
  })

  test('serves a request under another origin, such as behind a proxy, refuses another method with 405, and serves no document at another path', async () => {
    const accounts = await api()

    const statuses = await Promise.all(
      [
        new Request('http://10.0.0.2:8080/accounts/client.json'),
        new Request('https://api.example/accounts/client.json', {
          method: 'POST',
        }),
        new Request('https://api.example/.well-known/oauth-protected-resource'),
        new Request('https://api.example/client.json'),
      ].map(async (request) => (await accounts.handler.fetch(request)).status),
    )

    expect(statuses).toMatchInlineSnapshot(`
      [
        200,
        405,
        404,
        404,
      ]
    `)
  })

  test('serves a resource with a trailing slash at both its path and the path without the slash', async () => {
    const accounts = Accounts.create({
      chain: 'testnet',
      connections: {
        metadata: {
          accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
          privateKey: { crv: 'P-256', kid: 'api', kty: 'EC', x: 'x', y: 'y' },
        },
        resource: 'https://api.example/mcp/',
        store: Memory.create(),
      },
    })

    const statuses = await Promise.all(
      [
        'https://api.example/.well-known/oauth-protected-resource/mcp/',
        'https://api.example/.well-known/oauth-protected-resource/mcp',
        'https://api.example/.well-known/oauth-protected-resource/mcp//',
      ].map(
        async (url) => (await accounts.handler.fetch(new Request(url))).status,
      ),
    )

    expect(statuses).toMatchInlineSnapshot(`
      [
        200,
        200,
        404,
      ]
    `)
  })

  test("serves only a scope's address, recipients, and selector, and keeps an empty selector", async () => {
    const scope = {
      address: '0x20c0000000000000000000000000000000000000',
      note: 'internal',
      recipients: ['0x0000000000000000000000000000000000000001'],
      selector: 'transfer(address,uint256)',
    } as const
    const accounts = Accounts.create({
      chain: 'testnet',
      connections: {
        metadata: {
          accessKey: {
            limits: [{ limit: '25', token: 'ousd' }],
            scopes: [
              scope,
              {
                address: '0x20c0000000000000000000000000000000000001',
                selector: '',
              },
            ],
          },
          privateKey: { crv: 'P-256', kid: 'api', kty: 'EC', x: 'x', y: 'y' },
        },
        resource: 'https://api.example/mcp',
        store: Memory.create(),
      },
    })

    const response = await accounts.handler.fetch(
      new Request(
        'https://api.example/.well-known/oauth-protected-resource/mcp',
      ),
    )
    const body = (await response.json()) as {
      tempo_access_key_policy: { scopes: unknown }
    }

    expect(body.tempo_access_key_policy.scopes).toMatchInlineSnapshot(`
      [
        {
          "address": "0x20c0000000000000000000000000000000000000",
          "recipients": [
            "0x0000000000000000000000000000000000000001",
          ],
          "selector": "transfer(address,uint256)",
        },
        {
          "address": "0x20c0000000000000000000000000000000000001",
          "selector": "",
        },
      ]
    `)
  })

  test('refuses a lifetime that is not a whole number of seconds from 1 to 30 days, at the first request', async () => {
    const results = await Promise.all(
      [2_592_000, 2_592_001, 0, 1.5].map((lifetime) =>
        Accounts.create({
          chain: 'testnet',
          connections: {
            metadata: {
              accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
              lifetime,
              privateKey: {
                crv: 'P-256',
                kid: 'api',
                kty: 'EC',
                x: 'x',
                y: 'y',
              },
            },
            resource: 'https://api.example/mcp',
            store: Memory.create(),
          },
        })
          .handler.fetch(new Request('https://api.example/api/client.json'))
          .then(
            (response) => response.status,
            (error: Error) => error.message,
          ),
      ),
    )

    expect(results).toMatchInlineSnapshot(`
      [
        200,
        "Invalid \`metadata.lifetime\`: 2592001 is not a whole number of seconds from 1 to 2592000. Use a lifetime of at most 30 days.",
        "Invalid \`metadata.lifetime\`: 0 is not a whole number of seconds from 1 to 2592000. Use a lifetime of at most 30 days.",
        "Invalid \`metadata.lifetime\`: 1.5 is not a whole number of seconds from 1 to 2592000. Use a lifetime of at most 30 days.",
      ]
    `)
  })

  test('refuses a key without a public half, such as a symmetric key, at the first request', async () => {
    const accounts = Accounts.create({
      chain: 'testnet',
      connections: {
        metadata: {
          accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
          privateKey: { k: 'c2VjcmV0', kid: 'api', kty: 'oct' },
        },
        resource: 'https://api.example/mcp',
        store: Memory.create(),
      },
    })

    const refused = await accounts.handler
      .fetch(new Request('https://api.example/api/client.json'))
      .catch((error: Error) => error.message)

    expect(refused).toMatchInlineSnapshot(
      `"Unsupported \`metadata.privateKey\`: a oct JWK has no public key to publish. Use an EC, OKP, or RSA key, such as ES256."`,
    )
  })

  test("refuses other credentials, a client ID, a resource with a query, and a basePath that joins the host or the metadata's path, at creation", () => {
    const connections = {
      metadata: {
        accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
        privateKey: { crv: 'P-256', kid: 'api', kty: 'EC', x: 'x', y: 'y' },
      } as const,
      resource: 'https://api.example/mcp',
      store: Memory.create(),
    }

    const refused = [
      { clientSecret: 'secret' },
      { clientId: 'https://api.example/api/access-keys' },
      {
        connections: {
          ...connections,
          resource: 'https://api.example/mcp?tenant=a',
        },
      },
      { connections: { ...connections, resource: 'https://api.example/mcp#' } },
      {
        connections: {
          ...connections,
          resource: 'https://api.example/client.json',
        },
        handler: { basePath: '/.well-known/oauth-protected-resource' },
      },
      { handler: { basePath: '.other.example' } },
    ].map((options) => {
      try {
        Accounts.create({ connections, ...options })
        return 'created'
      } catch (error) {
        return (error as Error).message
      }
    })

    expect(refused).toMatchInlineSnapshot(`
      [
        "Conflicting credentials: \`connections.metadata\` names the app and signs its client assertions with its \`privateKey\`. Remove \`clientAssertion\`, \`clientId\`, and \`clientSecret\`.",
        "Conflicting credentials: \`connections.metadata\` names the app and signs its client assertions with its \`privateKey\`. Remove \`clientAssertion\`, \`clientId\`, and \`clientSecret\`.",
        "Invalid \`connections.resource\`: https://api.example/mcp?tenant=a holds a query or a fragment, which Tempo ID discovers no resource with. Remove them.",
        "Invalid \`connections.resource\`: https://api.example/mcp# holds a query or a fragment, which Tempo ID discovers no resource with. Remove them.",
        "Invalid \`handler.basePath\`: /.well-known/oauth-protected-resource does not start with /, or sits inside /.well-known/oauth-protected-resource, where the handler serves the resource's metadata. Use another \`basePath\`, such as /api.",
        "Invalid \`handler.basePath\`: .other.example does not start with /, or sits inside /.well-known/oauth-protected-resource, where the handler serves the resource's metadata. Use another \`basePath\`, such as /api.",
      ]
    `)
  })

  test("keeps the client ID and the access key endpoint on the resource's origin for a basePath that starts with //", async () => {
    const accounts = Accounts.create({
      chain: 'testnet',
      connections: {
        metadata: {
          accessKey: { limits: [{ limit: '25', token: 'ousd' }] },
          privateKey: { crv: 'P-256', kid: 'api', kty: 'EC', x: 'x', y: 'y' },
        },
        resource: 'https://api.example/mcp',
        store: Memory.create(),
      },
      handler: { basePath: '//other.example' },
    })

    const response = await accounts.handler.fetch(
      new Request(
        'https://api.example/.well-known/oauth-protected-resource/mcp',
      ),
    )
    const body = (await response.json()) as {
      tempo_access_key_policy: { access_key_endpoint: string }
    }

    expect([
      accounts.config.clientId,
      body.tempo_access_key_policy.access_key_endpoint,
    ]).toMatchInlineSnapshot(`
      [
        "https://api.example//other.example/client.json",
        "https://api.example//other.example/access-keys",
      ]
    `)
  })
})
