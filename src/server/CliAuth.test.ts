import { Base64 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { accounts, chain, privateKeys, webAuthnAccounts } from '../../test/config.js'
import * as CliAuth from './CliAuth.js'
import * as Handler from './Handler.js'

const root = accounts[0]!
const webAuthnRoot = webAuthnAccounts[0]!
const accessKey = TempoAccount.fromP256(privateKeys[1]!)
const secpAccessKey = accounts[1]!
const expiry = Math.floor(Date.now() / 1000) + 3_600
const limits = [
  {
    limit: 1_000n,
    token: '0x20c0000000000000000000000000000000000001' as const,
  },
] as const

async function authorize(
  code: string,
  options: {
    accessKey?:
      | {
          address: `0x${string}`
          keyType: 'secp256k1' | 'p256' | 'webAuthn'
        }
      | undefined
    accessKeyAddress?: `0x${string}` | undefined
    expiry?: number | undefined
    limits?: readonly { token: `0x${string}`; limit: bigint }[] | undefined
  } = {},
) {
  const key = options.accessKey ?? accessKey
  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: options.accessKeyAddress ?? key.address,
      keyType: key.keyType,
    },
    {
      chainId: BigInt(chain.id),
      expiry: options.expiry ?? expiry,
      limits: options.limits ?? limits,
    },
  )
  const keyAuthorization = KeyAuthorization.toRpc(signed)

  return {
    accountAddress: root.address,
    code,
    keyAuthorization: z.decode(CliAuth.keyAuthorization, {
      ...keyAuthorization,
      address: keyAuthorization.keyId,
    }),
  } satisfies z.output<typeof CliAuth.authorizeRequest>
}

async function authorizeWebAuthn(
  code: string,
  options: {
    accessKey?:
      | {
          address: `0x${string}`
          keyType: 'secp256k1' | 'p256' | 'webAuthn'
        }
      | undefined
    expiry?: number | undefined
    limits?: readonly { token: `0x${string}`; limit: bigint }[] | undefined
  } = {},
) {
  const key = options.accessKey ?? secpAccessKey
  const signed = await webAuthnRoot.signKeyAuthorization(
    {
      accessKeyAddress: key.address,
      keyType: key.keyType,
    },
    {
      chainId: BigInt(chain.id),
      expiry: options.expiry ?? expiry,
      limits: options.limits ?? limits,
    },
  )
  const keyAuthorization = KeyAuthorization.toRpc(signed)

  return {
    accountAddress: webAuthnRoot.address,
    code,
    keyAuthorization: z.decode(CliAuth.keyAuthorization, {
      ...keyAuthorization,
      address: keyAuthorization.keyId,
    }),
  } satisfies z.output<typeof CliAuth.authorizeRequest>
}

async function createRequest(
  codeVerifier = 'device-code-verifier',
  options: {
    accessKey?:
      | {
          keyType: 'secp256k1' | 'p256' | 'webAuthn'
          publicKey: `0x${string}`
        }
      | undefined
    expiry?: number | undefined
    keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
    limits?: readonly { token: `0x${string}`; limit: bigint }[] | undefined
  } = {},
) {
  const key = options.accessKey ?? accessKey
  return {
    codeVerifier,
    request: {
      codeChallenge: await createCodeChallenge(codeVerifier),
      ...('expiry' in options
        ? typeof options.expiry !== 'undefined'
          ? { expiry: options.expiry }
          : {}
        : { expiry }),
      ...('keyType' in options
        ? options.keyType
          ? { keyType: options.keyType }
          : {}
        : { keyType: key.keyType }),
      ...('limits' in options ? (options.limits ? { limits: options.limits } : {}) : { limits }),
      pubKey: key.publicKey,
    } satisfies z.output<typeof CliAuth.createRequest>,
  }
}

async function post<request extends z.ZodMiniType, response extends z.ZodMiniType>(
  handler: Handler.Handler,
  options: {
    body: z.output<request>
    request: request
    response?: response | undefined
    url: string
  },
) {
  const result = await handler.fetch(
    new Request(options.url, {
      body: JSON.stringify(z.encode(options.request, options.body)),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
  const json = (await result.json().catch(() => ({}))) as z.input<response>

  return {
    body: options.response ? z.decode(options.response, json) : json,
    status: result.status,
  }
}

async function get<response extends z.ZodMiniType>(
  handler: Handler.Handler,
  options: {
    response?: response | undefined
    url: string
  },
) {
  const result = await handler.fetch(new Request(options.url))
  const json = (await result.json().catch(() => ({}))) as z.input<response>

  return {
    body: options.response ? z.decode(options.response, json) : json,
    status: result.status,
  }
}

describe('from', () => {
  test('default: shares defaults across the device-code flow', async () => {
    const store = CliAuth.Store.memory()
    const now = () => 1_000
    const { codeVerifier, request } = await createRequest()
    const cli = CliAuth.from({
      chains: [chain],
      now,
      random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      store,
      ttlMs: 30_000,
    })

    const created = await cli.createDeviceCode({ request })
    const entry = await store.get(created.code)
    const authorized = await cli.authorize({
      request: await authorize(created.code),
    })
    const polled = await cli.poll({
      code: created.code,
      request: {
        codeVerifier,
      },
    })

    expect(created).toMatchInlineSnapshot(`
      {
        "code": "ABCDEFGH",
      }
    `)
    expect(entry).toMatchInlineSnapshot(`
      {
        "chainId": 1337n,
        "code": "ABCDEFGH",
        "codeChallenge": "NUwjc1h8PuXcsvSOG44Rp4bMayBXnOkriHEJ19CaSQM",
        "createdAt": 1000,
        "expiresAt": 31000,
        "expiry": ${expiry},
        "keyType": "p256",
        "limits": [
          {
            "limit": 1000n,
            "token": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "pubKey": "${accessKey.publicKey}",
        "status": "pending",
      }
    `)
    expect(authorized).toMatchInlineSnapshot(`
      {
        "status": "authorized",
      }
    `)
    expect(polled.status).toMatchInlineSnapshot(`"authorized"`)
  })
})

describe('createDeviceCode', () => {
  test('default: creates a pending device code', async () => {
    const store = CliAuth.Store.memory()
    const now = () => 1_000
    const { request } = await createRequest()

    const result = await CliAuth.createDeviceCode({
      chainId: chain.id,
      now,
      random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      request,
      store,
      ttlMs: 30_000,
    })
    const entry = await store.get(result.code)

    expect(result).toMatchInlineSnapshot(`
      {
        "code": "ABCDEFGH",
      }
    `)
    expect(entry).toMatchInlineSnapshot(`
      {
        "chainId": 1337n,
        "code": "ABCDEFGH",
        "codeChallenge": "NUwjc1h8PuXcsvSOG44Rp4bMayBXnOkriHEJ19CaSQM",
        "createdAt": 1000,
        "expiresAt": 31000,
        "expiry": ${expiry},
        "keyType": "p256",
        "limits": [
          {
            "limit": 1000n,
            "token": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "pubKey": "${accessKey.publicKey}",
        "status": "pending",
      }
    `)
  })

  test('behavior: policy rejection returns an error from the handler', async () => {
    const { request } = await createRequest()
    const handler = Handler.codeAuth({
      policy: {
        validate() {
          throw new Error('Expiry exceeds policy.')
        },
      },
    })

    const result = await post(handler, {
      body: request,
      request: CliAuth.createRequest,
      url: 'http://localhost/auth/pkce/code',
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "Expiry exceeds policy.",
        },
        "status": 400,
      }
    `)
  })

  test('behavior: invalid input returns 400', async () => {
    const handler = Handler.codeAuth()
    const response = await handler.fetch(
      new Request('http://localhost/auth/pkce/code', {
        body: JSON.stringify({ expiry }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    const body = await response.json()

    expect(body.error).toMatchInlineSnapshot(`
      "[\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "codeChallenge"\n    ],\n    "message": "Invalid input"\n  },\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "pubKey"\n    ],\n    "message": "Expected hex value"\n  }\n]"
    `)
    expect(response.status).toMatchInlineSnapshot(`400`)
  })

  test('behavior: handler rejects requests for unconfigured chains', async () => {
    const handler = Handler.codeAuth({
      chains: [chain],
    })
    const { request } = await createRequest()

    const result = await post(handler, {
      body: {
        ...request,
        chainId: BigInt(chain.id + 1),
      },
      request: CliAuth.createRequest,
      url: 'http://localhost/auth/pkce/code',
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "Chain 1338 not configured",
        },
        "status": 400,
      }
    `)
  })

  test('behavior: supports pubkey-only requests with server defaults', async () => {
    const store = CliAuth.Store.memory()
    const now = () => 1_000
    const defaultExpiry = 4_600
    let validatedChainId: bigint | undefined
    const { request } = await createRequest('device-code-verifier', {
      accessKey: secpAccessKey,
      expiry: undefined,
      keyType: undefined,
      limits: undefined,
    })

    const result = await CliAuth.createDeviceCode({
      chainId: chain.id,
      now,
      policy: {
        validate({ chainId, expiry, limits }) {
          validatedChainId = chainId
          return {
            expiry: expiry ?? defaultExpiry,
            ...(limits ? { limits } : {}),
          }
        },
      },
      random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      request,
      store,
      ttlMs: 30_000,
    })
    const entry = await store.get(result.code)

    expect({ entry, validatedChainId }).toMatchInlineSnapshot(`
      {
        "entry": {
          "chainId": 1337n,
          "code": "ABCDEFGH",
          "codeChallenge": "NUwjc1h8PuXcsvSOG44Rp4bMayBXnOkriHEJ19CaSQM",
          "createdAt": 1000,
          "expiresAt": 31000,
          "expiry": 4600,
          "keyType": "secp256k1",
          "pubKey": "${secpAccessKey.publicKey}",
          "status": "pending",
        },
        "validatedChainId": 1337n,
      }
    `)
  })
})

describe('pending', () => {
  test('default: returns request details for a pending entry', async () => {
    const store = CliAuth.Store.memory()
    const { request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      request,
      store,
    })

    const result = await CliAuth.pending({
      code,
      store,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "accessKeyAddress": "${accessKey.address.toLowerCase()}",
        "chainId": 1337n,
        "code": "ABCDEFGH",
        "expiry": ${expiry},
        "keyType": "p256",
        "limits": [
          {
            "limit": 1000n,
            "token": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "pubKey": "${accessKey.publicKey}",
        "status": "pending",
      }
    `)
  })

  test('behavior: handler returns 404 for an unknown code', async () => {
    const handler = Handler.codeAuth()

    const result = await get(handler, {
      url: 'http://localhost/auth/pkce/pending/ABCDEFGH',
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "Unknown device code.",
        },
        "status": 404,
      }
    `)
  })

  test('behavior: handler returns 400 for a completed code', async () => {
    const store = CliAuth.Store.memory()
    const handler = Handler.codeAuth({
      chains: [chain],
      store,
    })
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      request,
      store,
    })

    await CliAuth.authorize({
      chainId: chain.id,
      request: await authorize(code),
      store,
    })
    await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    const result = await get(handler, {
      url: `http://localhost/auth/pkce/pending/${code}`,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "Device code already completed.",
        },
        "status": 400,
      }
    `)
  })

  test('behavior: handler accepts a hyphenated code', async () => {
    const store = CliAuth.Store.memory()
    const handler = Handler.codeAuth({
      chains: [chain],
      store,
    })
    const { request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      request,
      store,
    })

    const result = await get(handler, {
      response: CliAuth.pendingResponse,
      url: `http://localhost/auth/pkce/pending/${code.slice(0, 4)}-${code.slice(4)}`,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "accessKeyAddress": "${accessKey.address.toLowerCase()}",
          "chainId": 1337n,
          "code": "ABCDEFGH",
          "expiry": ${expiry},
          "keyType": "p256",
          "limits": [
            {
              "limit": 1000n,
              "token": "0x20c0000000000000000000000000000000000001",
            },
          ],
          "pubKey": "${accessKey.publicKey}",
          "status": "pending",
        },
        "status": 200,
      }
    `)
  })
})

describe('poll', () => {
  test('default: returns pending while awaiting authorization', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })

    const result = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "status": "pending",
      }
    `)
  })

  test('behavior: rejects a PKCE mismatch', async () => {
    const handler = Handler.codeAuth({
      chains: [chain],
      store: CliAuth.Store.memory(),
    })
    const { request } = await createRequest()
    const created = await post(handler, {
      body: request,
      request: CliAuth.createRequest,
      response: CliAuth.createResponse,
      url: 'http://localhost/auth/pkce/code',
    })

    const result = await post(handler, {
      body: {
        codeVerifier: 'wrong',
      },
      request: CliAuth.pollRequest,
      url: `http://localhost/auth/pkce/poll/${(created.body as z.output<typeof CliAuth.createResponse>).code}`,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "Invalid code verifier.",
        },
        "status": 400,
      }
    `)
  })

  test('behavior: consumes an authorization exactly once', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })

    await CliAuth.authorize({
      chainId: chain.id,
      request: await authorize(code),
      store,
    })

    const first = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })
    const second = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    const first_ =
      first.status === 'authorized'
        ? {
            ...first,
            keyAuthorization: {
              ...first.keyAuthorization,
              signature: {
                type: first.keyAuthorization.signature.type,
              },
            },
          }
        : first

    expect({ first: first_, second }).toMatchInlineSnapshot(`
      {
        "first": {
          "accountAddress": "${root.address}",
          "keyAuthorization": {
            "address": "${accessKey.address}",
            "chainId": 1337n,
            "expiry": ${expiry},
            "keyId": "${accessKey.address}",
            "keyType": "p256",
            "limits": [
              {
                "limit": 1000n,
                "token": "0x20c0000000000000000000000000000000000001",
              },
            ],
            "signature": {
              "type": "secp256k1",
            },
          },
          "status": "authorized",
        },
        "second": {
          "status": "expired",
        },
      }
    `)
  })

  test('behavior: accepts a hyphenated code when polling', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })

    const result = await CliAuth.poll({
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "status": "pending",
      }
    `)
  })

  test('behavior: expires after TTL elapses', async () => {
    let time = 10_000
    const now = () => time
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      now,
      request,
      store,
      ttlMs: 10,
    })

    time += 11

    const result = await CliAuth.poll({
      code,
      now,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    expect(result).toMatchInlineSnapshot(`
      {
        "status": "expired",
      }
    `)
  })
})

describe('authorize', () => {
  test('default: authorizes and returns the signed key authorization', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })

    const authorized = await CliAuth.authorize({
      chainId: chain.id,
      request: await authorize(code),
      store,
    })
    const polled = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    expect(authorized).toMatchInlineSnapshot(`
      {
        "status": "authorized",
      }
    `)
    expect(polled.status).toMatchInlineSnapshot(`"authorized"`)
  })

  test('behavior: accepts user-approved expiry and limit changes', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })
    const approvedLimits = [
      {
        limit: 2_000n,
        token: limits[0]!.token,
      },
    ] as const

    const authorized = await CliAuth.authorize({
      chainId: chain.id,
      request: await authorize(code, { expiry: expiry + 60 * 60 * 24 * 6, limits: approvedLimits }),
      store,
    })
    const polled = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    if (polled.status !== 'authorized') throw new Error('Expected device code to be authorized.')

    expect(authorized).toMatchInlineSnapshot(`
      {
        "status": "authorized",
      }
    `)
    expect({ expiry: polled.keyAuthorization.expiry, limits: polled.keyAuthorization.limits })
      .toMatchInlineSnapshot(`
        {
          "expiry": ${expiry + 60 * 60 * 24 * 6},
          "limits": [
            {
              "limit": 2000n,
              "token": "0x20c0000000000000000000000000000000000001",
            },
          ],
        }
      `)
  })

  test('behavior: rejects final expiry and limit changes beyond policy', async () => {
    const store = CliAuth.Store.memory()
    const { request } = await createRequest()
    const maxExpiry = expiry + 60 * 60
    const policy = CliAuth.Policy.from({
      validate(options) {
        if (options.expiry && options.expiry > maxExpiry) throw new Error('Expiry exceeds policy.')
        if (options.limits?.some((limit) => limit.limit > 1_000n))
          throw new Error('Limit exceeds policy.')
        return {
          expiry: options.expiry ?? maxExpiry,
          ...(options.limits ? { limits: options.limits } : {}),
        }
      },
    })
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      policy,
      request,
      store,
    })

    await expect(
      CliAuth.authorize({
        chainId: chain.id,
        policy,
        request: await authorize(code, {
          limits: [{ limit: 2_000n, token: limits[0]!.token }],
        }),
        store,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Limit exceeds policy.]`)
  })

  test('behavior: rejects unsigned expiry and limit changes', async () => {
    const store = CliAuth.Store.memory()
    const { request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })
    const authorized = await authorize(code)

    await expect(
      CliAuth.authorize({
        chainId: chain.id,
        request: {
          ...authorized,
          keyAuthorization: {
            ...authorized.keyAuthorization,
            expiry: expiry + 1,
          },
        },
        store,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Key authorization signature is invalid.]`)

    await expect(
      CliAuth.authorize({
        chainId: chain.id,
        request: {
          ...authorized,
          keyAuthorization: {
            ...authorized.keyAuthorization,
            limits: [{ limit: limits[0]!.limit + 1n, token: limits[0]!.token }],
          },
        },
        store,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Key authorization signature is invalid.]`)
  })

  test('behavior: rejects a mismatched key authorization', async () => {
    const store = CliAuth.Store.memory()
    const { request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })

    await expect(
      CliAuth.authorize({
        chainId: chain.id,
        request: await authorize(code, { accessKeyAddress: secpAccessKey.address }),
        store,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Key authorization key does not match the device-code request.]`,
    )
  })

  test('behavior: accepts a hyphenated code when authorizing', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest()
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })
    const displayCode = `${code.slice(0, 4)}-${code.slice(4)}`

    const authorized = await CliAuth.authorize({
      chainId: chain.id,
      request: await authorize(displayCode),
      store,
    })
    const polled = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    expect(authorized).toMatchInlineSnapshot(`
      {
        "status": "authorized",
      }
    `)
    expect(polled.status).toMatchInlineSnapshot(`"authorized"`)
  })

  test('behavior: accepts a WebAuthn signature envelope from RPC', async () => {
    const store = CliAuth.Store.memory()
    const { codeVerifier, request } = await createRequest('device-code-verifier', {
      accessKey: secpAccessKey,
      keyType: secpAccessKey.keyType,
    })
    const { code } = await CliAuth.createDeviceCode({
      chainId: chain.id,
      request,
      store,
    })

    const authorized = await CliAuth.authorize({
      chainId: chain.id,
      request: await authorizeWebAuthn(code),
      store,
    })
    const polled = await CliAuth.poll({
      code,
      request: {
        codeVerifier: codeVerifier,
      },
      store,
    })

    const keyAuthorization =
      polled.status === 'authorized'
        ? {
            ...polled.keyAuthorization,
            signature: {
              type: polled.keyAuthorization.signature.type,
            },
          }
        : undefined

    expect({
      authorized,
      polled:
        polled.status === 'authorized'
          ? {
              ...polled,
              keyAuthorization: keyAuthorization,
            }
          : polled,
    }).toMatchInlineSnapshot(`
      {
        "authorized": {
          "status": "authorized",
        },
        "polled": {
          "accountAddress": "${webAuthnRoot.address}",
          "keyAuthorization": {
            "address": "${secpAccessKey.address}",
            "chainId": 1337n,
            "expiry": ${expiry},
            "keyId": "${secpAccessKey.address}",
            "keyType": "secp256k1",
            "limits": [
              {
                "limit": 1000n,
                "token": "0x20c0000000000000000000000000000000000001",
              },
            ],
            "signature": {
              "type": "webAuthn",
            },
          },
          "status": "authorized",
        },
      }
    `)
  })
})

describe('Store.kv', () => {
  test('default: persists encoded entries through KV', async () => {
    const store = CliAuth.Store.kv({
      async delete() {},
      async get<_value = unknown>(_key: string) {
        return undefined as never
      },
      async set() {},
    })

    expect(typeof store.create).toMatchInlineSnapshot(`"function"`)
    expect(typeof store.get).toMatchInlineSnapshot(`"function"`)
    expect(typeof store.authorize).toMatchInlineSnapshot(`"function"`)
    expect(typeof store.consume).toMatchInlineSnapshot(`"function"`)
    expect(typeof store.delete).toMatchInlineSnapshot(`"function"`)
  })
})

async function createCodeChallenge(codeVerifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true })
}
