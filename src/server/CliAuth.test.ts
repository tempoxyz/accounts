import { Base64 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { accounts, chain, privateKeys } from '../../test/config.js'
import * as CliAuth from './CliAuth.js'
import * as Handler from './Handler.js'

const root = accounts[0]!
const accessKey = TempoAccount.fromP256(privateKeys[1]!)
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
    accessKeyAddress?: `0x${string}` | undefined
    expiry?: number | undefined
    limits?: readonly { token: `0x${string}`; limit: bigint }[] | undefined
  } = {},
) {
  const signed = await root.signKeyAuthorization(
    {
      accessKeyAddress: options.accessKeyAddress ?? accessKey.address,
      keyType: accessKey.keyType,
    },
    {
      chainId: BigInt(chain.id),
      expiry: options.expiry ?? expiry,
      limits: options.limits ?? limits,
    },
  )
  const keyAuthorization = KeyAuthorization.toRpc(signed)

  return {
    account_address: root.address,
    code,
    key_authorization: z.decode(CliAuth.keyAuthorization, {
      ...keyAuthorization,
      address: keyAuthorization.keyId,
    }),
  } satisfies z.output<typeof CliAuth.authorizeRequest>
}

async function createRequest(codeVerifier = 'device-code-verifier') {
  return {
    codeVerifier,
    request: {
      code_challenge: await createCodeChallenge(codeVerifier),
      expiry,
      key_type: accessKey.keyType,
      limits,
      pub_key: accessKey.publicKey,
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
    const handler = Handler.cliAuth({
      policy: {
        validate() {
          throw new Error('Expiry exceeds policy.')
        },
      },
    })

    const result = await post(handler, {
      body: request,
      request: CliAuth.createRequest,
      url: 'http://localhost/cli-auth/device-code',
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
    const handler = Handler.cliAuth()
    const response = await handler.fetch(
      new Request('http://localhost/cli-auth/device-code', {
        body: JSON.stringify({ expiry }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    const body = await response.json()

    expect(body.error).toMatchInlineSnapshot(`
      "[\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "code_challenge"\n    ],\n    "message": "Invalid input"\n  },\n  {\n    "code": "invalid_union",\n    "errors": [\n      [\n        {\n          "code": "invalid_value",\n          "values": [\n            "secp256k1"\n          ],\n          "path": [],\n          "message": "Invalid input"\n        }\n      ],\n      [\n        {\n          "code": "invalid_value",\n          "values": [\n            "p256"\n          ],\n          "path": [],\n          "message": "Invalid input"\n        }\n      ],\n      [\n        {\n          "code": "invalid_value",\n          "values": [\n            "webAuthn"\n          ],\n          "path": [],\n          "message": "Invalid input"\n        }\n      ]\n    ],\n    "path": [\n      "key_type"\n    ],\n    "message": "Invalid input"\n  },\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "pub_key"\n    ],\n    "message": "Expected hex value"\n  }\n]"
    `)
    expect(response.status).toMatchInlineSnapshot(`400`)
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
        code_verifier: codeVerifier,
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
    const handler = Handler.cliAuth({
      chainId: chain.id,
      store: CliAuth.Store.memory(),
    })
    const { request } = await createRequest()
    const created = await post(handler, {
      body: request,
      request: CliAuth.createRequest,
      response: CliAuth.createResponse,
      url: 'http://localhost/cli-auth/device-code',
    })

    const result = await post(handler, {
      body: {
        code_verifier: 'wrong',
      },
      request: CliAuth.pollRequest,
      url: `http://localhost/cli-auth/poll/${(created.body as z.output<typeof CliAuth.createResponse>).code}`,
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
        code_verifier: codeVerifier,
      },
      store,
    })
    const second = await CliAuth.poll({
      code,
      request: {
        code_verifier: codeVerifier,
      },
      store,
    })

    const first_ =
      first.status === 'authorized'
        ? {
            ...first,
            key_authorization: {
              ...first.key_authorization,
              signature: {
                type: first.key_authorization.signature.type,
              },
            },
          }
        : first

    expect({ first: first_, second }).toMatchInlineSnapshot(`
      {
        "first": {
          "account_address": "${root.address}",
          "key_authorization": {
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
        code_verifier: codeVerifier,
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
        code_verifier: codeVerifier,
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
        code_verifier: codeVerifier,
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
        request: await authorize(code, { expiry: expiry + 1 }),
        store,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Key authorization expiry does not match the device-code request.]`,
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
        code_verifier: codeVerifier,
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
})

describe('Store.kv', () => {
  test('default: persists encoded entries through KV', async () => {
    const store = CliAuth.Store.kv({
      async delete() {},
      async get<value = unknown>(_key: string) {
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
