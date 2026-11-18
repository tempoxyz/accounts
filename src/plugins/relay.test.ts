/**
 * Runs the `relay` plugin's route without a server: the access token check before each relay, and
 * `authorize`, batches, a DPoP proof behind a proxy and its repeat, and a resource's tokens. The issuer's key set comes through the instance's `fetch`, and nothing listens at the
 * Tempo API's URL, so a request that passes the check receives the route's 503.
 * @module
 */
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Base64, Bytes, Hash, Secp256k1 } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { custom } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Relay } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Dpop from '../internal/Dpop.js'
import { relay } from './relay.js'
import { viem } from './viem.js'

describe('relay', () => {
  test('refuses a request without an access token with 401, before the Tempo API', async () => {
    const accounts = instance(await issuer())

    const response = await accounts.relay.fetch(request())

    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Invalid access token: the request carries no valid access token of the app. Sign in again.",
        "reason": "invalid_token",
        "status": 401,
      }
    `)
  })

  test("refuses another app's access token with 401", async () => {
    const keys = await issuer()
    const accounts = instance(keys)

    const response = await accounts.relay.fetch(
      request({
        token: await keys.sign({ clientId: 'https://other.example' }),
      }),
    )

    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Invalid access token: the request carries no valid access token of the app. Sign in again.",
        "reason": "invalid_token",
        "status": 401,
      }
    `)
  })

  test('relays a request with a valid access token after `authorize` accepts it', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = instance(keys, {
      authorize: (options) => {
        users.push(options.token.userId)
      },
    })

    const response = await accounts.relay.fetch(
      request({ token: await keys.sign() }),
    )

    expect(users).toMatchInlineSnapshot(`
      [
        "user_1",
      ]
    `)
    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Sponsor unavailable: the request to the Tempo API failed. Retry later.",
        "reason": "temporarily_unavailable",
        "status": 503,
      }
    `)
  })

  test('returns the response of `authorize` that refuses the caller', async () => {
    const keys = await issuer()
    const accounts = instance(keys, {
      authorize: () => Response.json({ error: 'slow_down' }, { status: 429 }),
    })

    const response = await accounts.relay.fetch(
      request({ token: await keys.sign() }),
    )

    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "reason": "slow_down",
        "status": 429,
      }
    `)
  })

  test("returns 503 when the issuer's key set cannot be fetched", async () => {
    const keys = await issuer()
    const accounts = instance({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    })

    const response = await accounts.relay.fetch(
      request({ token: await keys.sign() }),
    )

    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Relay unavailable: the access token cannot be verified. Retry later.",
        "reason": "temporarily_unavailable",
        "status": 503,
      }
    `)
  })

  test('relays a request without an access token with `verify: false`', async () => {
    const accounts = instance(await issuer(), { verify: false })

    const response = await accounts.relay.fetch(request())

    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Sponsor unavailable: the request to the Tempo API failed. Retry later.",
        "reason": "temporarily_unavailable",
        "status": 503,
      }
    `)
  })
})

describe('relay fee payer', () => {
  test('throws for `account` with `plugins`, which states no order of the fee payer', () => {
    const account = privateKeyToAccount(generatePrivateKey())

    const create = () =>
      // @ts-expect-error The options type refuses `account` with `plugins`.
      relay({ account, plugins: [Relay.autoSwap()] })

    expect(create).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid options: \`account\` and \`plugins\` are both set, which states no order of the fee payer among the plugins. Remove \`account\`, and pass \`Relay.feePayer({ account })\` in \`plugins\`, after each plugin that refuses a request.]`,
    )
  })

  test('throws for `apiKey` with `plugins`, which the Tempo API mode never runs', () => {
    const options = { apiKey: 'test', plugins: [Relay.autoSwap()] }

    const create = () =>
      // @ts-expect-error The options type refuses `apiKey` with `plugins`.
      relay(options)

    expect(create).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid options: \`apiKey\` and \`plugins\` are both set, and a route with \`apiKey\` runs no plugin. Remove \`apiKey\` for a route that runs \`plugins\`, or remove \`plugins\`.]`,
    )
  })

  test('signs a prepared fill with `account`', async () => {
    const keys = await issuer()
    const fees = feePayer()
    const accounts = sponsor(keys, { account: fees.account })

    const response = await accounts.relay.fetch(
      rpc(await keys.sign(), 'eth_fillTransaction', prepared()),
    )

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(fees.signed.length).toMatchInlineSnapshot(`1`)
  })

  test('sends a prepared fill to a plugin before `Relay.feePayer`, which then signs nothing', async () => {
    const keys = await issuer()
    const fees = feePayer()
    const policy = refusal()
    const accounts = sponsor(keys, {
      plugins: [policy.plugin, Relay.feePayer({ account: fees.account })],
    })

    const response = await accounts.relay.fetch(
      rpc(await keys.sign(), 'eth_fillTransaction', prepared()),
    )

    expect(policy.methods).toMatchInlineSnapshot(`
      [
        "eth_fillTransaction",
      ]
    `)
    expect(await failure(response)).toMatchInlineSnapshot(`
      {
        "code": -32603,
        "message": "Internal error",
      }
    `)
    expect(fees.signed).toMatchInlineSnapshot(`[]`)
  })

  test('sends a raw transaction to a plugin before `Relay.feePayer`, which then signs nothing', async () => {
    const keys = await issuer()
    const fees = feePayer()
    const policy = refusal()
    const accounts = sponsor(keys, {
      plugins: [policy.plugin, Relay.feePayer({ account: fees.account })],
    })

    const response = await accounts.relay.fetch(
      rpc(
        await keys.sign(),
        'eth_signRawTransaction',
        raw(accounts.config.chainId),
      ),
    )

    expect(policy.methods).toMatchInlineSnapshot(`
      [
        "eth_signRawTransaction",
      ]
    `)
    expect(await failure(response)).toMatchInlineSnapshot(`
      {
        "code": -32603,
        "message": "Internal error",
      }
    `)
    expect(fees.signed).toMatchInlineSnapshot(`[]`)
  })
})

describe('relay guard', () => {
  test('refuses a JSON-RPC batch with 400, before `authorize`', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = instance(keys, {
      authorize: (options) => {
        users.push(options.token.userId)
      },
    })

    const response = await accounts.relay.fetch(
      request({ batch: true, token: await keys.sign() }),
    )

    expect(users).toMatchInlineSnapshot(`[]`)
    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Invalid request: the route relays one JSON-RPC request at a time. Send each request alone.",
        "reason": "invalid_request",
        "status": 400,
      }
    `)
  })

  test('refuses a JSON-RPC batch behind byte order marks with 400, before `authorize`', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = instance(keys, {
      authorize: (options) => {
        users.push(options.token.userId)
      },
    })
    const token = await keys.sign()
    // A runtime's body readers remove one mark, or more, so each count is a different body to them.
    const bodies = [1, 2, 3, 4].map(
      (marks) => `${'\uFEFF'.repeat(marks)}[{"id":1,"jsonrpc":"2.0"}]`,
    )

    const statuses: number[] = []
    for (const body of bodies) {
      const response = await accounts.relay.fetch(
        new Request(request({ token }), { body, method: 'POST' }),
      )
      statuses.push(response.status)
    }

    expect(users).toMatchInlineSnapshot(`[]`)
    expect(statuses).toMatchInlineSnapshot(`
      [
        400,
        400,
        400,
        400,
      ]
    `)
  })

  test('refuses a body that is not one JSON object with 400, before `authorize`', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = instance(keys, {
      authorize: (options) => {
        users.push(options.token.userId)
      },
    })
    const token = await keys.sign()

    const responses: Response[] = []
    for (const body of ['', 'not json', 'null', '"text"', '\uFEFF\uFEFF{}'])
      responses.push(
        await accounts.relay.fetch(
          new Request(request({ token }), { body, method: 'POST' }),
        ),
      )

    expect(users).toMatchInlineSnapshot(`[]`)
    expect(responses.map((response) => response.status)).toMatchInlineSnapshot(`
      [
        400,
        400,
        400,
        400,
        400,
      ]
    `)
    expect(await summary(responses[0]!)).toMatchInlineSnapshot(`
      {
        "message": "Invalid request: the body is not one JSON object. Send one JSON-RPC request as a JSON object.",
        "reason": "invalid_request",
        "status": 400,
      }
    `)
  })

  test('gives `authorize` the JSON object of the body, as the route relays it', async () => {
    const keys = await issuer()
    const bodies: string[] = []
    const accounts = instance(keys, {
      authorize: async (options) => {
        bodies.push(await options.request.text())
      },
    })

    const response = await accounts.relay.fetch(
      new Request(request({ token: await keys.sign() }), {
        body: '\uFEFF { "method": "eth_call", "id": 1, "jsonrpc": "2.0", "method": "eth_fillTransaction" }',
        method: 'POST',
      }),
    )

    expect(bodies).toMatchInlineSnapshot(`
      [
        "{"method":"eth_fillTransaction","id":1,"jsonrpc":"2.0"}",
      ]
    `)
    expect((await summary(response)).status).toMatchInlineSnapshot(`503`)
  })

  test('refuses a body above 1 MiB with 413, before `authorize`, and reads no more of it', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = instance(keys, {
      authorize: (options) => {
        users.push(options.token.userId)
      },
    })
    const body = large()

    const response = await accounts.relay.fetch(
      new Request(request({ token: await keys.sign() }), body.init),
    )

    expect(users).toMatchInlineSnapshot(`[]`)
    expect(body.read()).toMatchInlineSnapshot(`17`)
    expect(await summary(response)).toMatchInlineSnapshot(`
      {
        "message": "Request too large: the body exceeds 1 MiB. Send a smaller request.",
        "reason": "body_too_large",
        "status": 413,
      }
    `)
  })

  test('refuses a declared body size above 1 MiB with 413, and reads none of the body', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const body = large()
    const base = request({ token: await keys.sign() })
    base.headers.set('content-length', String(1024 * 1024 + 1))

    const response = await accounts.relay.fetch(new Request(base, body.init))

    expect(body.read()).toMatchInlineSnapshot(`0`)
    expect((await summary(response)).status).toMatchInlineSnapshot(`413`)
  })

  test('refuses a body above 1 MiB with 413 in the Tempo API mode with `verify: false`', async () => {
    const accounts = instance(await issuer(), { verify: false })
    const body = large()

    const response = await accounts.relay.fetch(
      new Request(request(), body.init),
    )

    expect(body.read()).toMatchInlineSnapshot(`17`)
    expect((await summary(response)).status).toMatchInlineSnapshot(`413`)
  })

  test('refuses a body above 1 MiB with 413 in the Viem relay mode, before `authorize`', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = Accounts.create({
      chain: 'testnet',
      clientId: 'https://app.example',
      fetch: keys.fetch,
      plugins: [
        relay({
          authorize: (options) => {
            users.push(options.token.userId)
          },
          plugins: [],
        }),
      ],
      url,
    })
    const body = large()

    const response = await accounts.relay.fetch(
      new Request(request({ token: await keys.sign() }), body.init),
    )

    expect(users).toMatchInlineSnapshot(`[]`)
    expect(body.read()).toMatchInlineSnapshot(`17`)
    expect((await summary(response)).status).toMatchInlineSnapshot(`413`)
  })

  test('refuses a body above 1 MiB with 413 while a clone of the request holds its body', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const declared = request({ token: await keys.sign() })
    declared.headers.set('content-length', String(1024 * 1024 + 1))
    // A cancel of one branch of a cloned body settles only once the other branch ends.
    const originals = [
      new Request(declared, large().init),
      new Request(request({ token: await keys.sign() }), large().init),
    ]

    const responses: Response[] = []
    for (const original of originals)
      responses.push(await accounts.relay.fetch(original.clone()))

    expect(responses.map((response) => response.status)).toMatchInlineSnapshot(`
      [
        413,
        413,
      ]
    `)
  })

  test('refuses a body whose encoding exceeds 1 MiB with 413, before `authorize`', async () => {
    const keys = await issuer()
    const users: string[] = []
    const accounts = instance(keys, {
      authorize: (options) => {
        users.push(options.token.userId)
      },
    })
    // The route writes each `1e20` of 4 bytes as 21 digits, so 0.3 MiB of them encode to 1.3 MiB.
    const body = `{"a":[${Array.from({ length: 60_000 }, () => '1e20').join(',')}]}`

    const response = await accounts.relay.fetch(
      new Request(request({ token: await keys.sign() }), {
        body,
        method: 'POST',
      }),
    )

    expect(users).toMatchInlineSnapshot(`[]`)
    expect((await summary(response)).status).toMatchInlineSnapshot(`413`)
  })

  // The depth that `JSON.stringify` encodes differs by runtime, and the test needs a body that it
  // refuses.
  test.skipIf(nested().encodes)(
    'refuses a body that nests too deep to encode with 400, before `authorize`',
    async () => {
      const keys = await issuer()
      const users: string[] = []
      const accounts = instance(keys, {
        authorize: (options) => {
          users.push(options.token.userId)
        },
      })

      const response = await accounts.relay.fetch(
        new Request(request({ token: await keys.sign() }), {
          body: nested().body,
          method: 'POST',
        }),
      )

      expect(users).toMatchInlineSnapshot(`[]`)
      expect(await summary(response)).toMatchInlineSnapshot(`
        {
          "message": "Invalid request: the body nests too deep to relay. Send a request with less nesting.",
          "reason": "invalid_request",
          "status": 400,
        }
      `)
    },
  )

  test('verifies a DPoP proof of the public URL with `url`, behind a proxy that terminates TLS', async () => {
    const keys = await issuer()
    const dpop = await Dpop.create()
    const token = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
    const proof = await Dpop.proof(dpop, {
      accessToken: token,
      method: 'POST',
      url: 'https://app.example/api/relay',
    })
    const internal = () =>
      request({ dpop: proof, token, url: 'http://10.0.0.1/api/relay' })
    const without = instance(keys)
    const behind = instance(keys, { url: 'https://app.example/api/relay' })

    const refused = await without.relay.fetch(internal())
    const accepted = await behind.relay.fetch(internal())

    expect((await summary(refused)).status).toMatchInlineSnapshot(`401`)
    expect((await summary(accepted)).status).toMatchInlineSnapshot(`503`)
  })

  test('refuses a repeated DPoP proof with 401 and invalid_dpop_proof, and relays a new proof and a repeated Bearer token', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const dpop = await Dpop.create()
    const bound = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
    const proof = () =>
      Dpop.proof(dpop, {
        accessToken: bound,
        method: 'POST',
        url: 'https://app.example/api/relay',
      })
    const captured = await proof()
    const bearer = await keys.sign()

    const first = await accounts.relay.fetch(
      request({ dpop: captured, token: bound }),
    )
    const replayed = await accounts.relay.fetch(
      request({ dpop: captured, token: bound }),
    )
    const fresh = await accounts.relay.fetch(
      request({ dpop: await proof(), token: bound }),
    )
    const bearers = await Promise.all([
      accounts.relay.fetch(request({ token: bearer })),
      accounts.relay.fetch(request({ token: bearer })),
    ])

    expect((await summary(first)).status).toMatchInlineSnapshot(`503`)
    expect(replayed.headers.get('www-authenticate')).toMatchInlineSnapshot(
      `"DPoP error="invalid_dpop_proof""`,
    )
    expect(await summary(replayed)).toMatchInlineSnapshot(`
      {
        "message": "Invalid DPoP proof: the route accepted this proof already, or it expired or names a \`jti\` above 256 characters. Send a new proof with each request.",
        "reason": "invalid_dpop_proof",
        "status": 401,
      }
    `)
    expect((await summary(fresh)).status).toMatchInlineSnapshot(`503`)
    expect(
      await Promise.all(
        bearers.map(async (entry) => (await summary(entry)).status),
      ),
    ).toMatchInlineSnapshot(`
      [
        503,
        503,
      ]
    `)
  })

  test('refuses the proofs of one DPoP key above 1,000 unexpired ones with 429, and relays the proofs of another key', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const [busy, other] = [await Dpop.create(), await Dpop.create()]
    const send = async (dpop: Dpop.Dpop) => {
      const token = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
      const proof = await Dpop.proof(dpop, {
        accessToken: token,
        method: 'POST',
        url: 'https://app.example/api/relay',
      })
      return await summary(
        await accounts.relay.fetch(request({ dpop: proof, token })),
      )
    }

    const statuses = new Set<number>()
    for (let index = 0; index < 1_000; index++)
      statuses.add((await send(busy)).status)
    const limited = await send(busy)
    const another = await send(other)

    expect([...statuses]).toMatchInlineSnapshot(`
      [
        503,
      ]
    `)
    expect(limited).toMatchInlineSnapshot(`
      {
        "message": "Too many requests: the DPoP key holds too many unexpired proofs of the route. Retry later.",
        "reason": "rate_limited",
        "status": 429,
      }
    `)
    expect(another.status).toMatchInlineSnapshot(`503`)
  }, 60_000)

  test('refuses a repeated proof whose first request `authorize` refused, so no copy relays another body', async () => {
    const keys = await issuer()
    let open = false
    const accounts = instance(keys, {
      authorize: () =>
        open
          ? undefined
          : Response.json({ error: 'slow_down' }, { status: 429 }),
    })
    const dpop = await Dpop.create()
    const token = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
    const proof = await Dpop.proof(dpop, {
      accessToken: token,
      method: 'POST',
      url: 'https://app.example/api/relay',
    })

    const refused = await accounts.relay.fetch(request({ dpop: proof, token }))
    open = true
    const repeated = await accounts.relay.fetch(request({ dpop: proof, token }))

    expect(refused.status).toMatchInlineSnapshot(`429`)
    expect((await summary(repeated)).reason).toMatchInlineSnapshot(
      `"invalid_dpop_proof"`,
    )
  })

  test('deletes each expired proof before the limits apply, also behind a later proof that expires last', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const [early, busy] = [await Dpop.create(), await Dpop.create()]
    const send = async (
      dpop: Dpop.Dpop,
      options: { iat?: number | undefined } = {},
    ) => {
      const token = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
      const proof = await sign(dpop, {
        accessToken: token,
        iat: options.iat,
        jti: crypto.randomUUID(),
        url: 'https://app.example/api/relay',
      })
      return (
        await summary(
          await accounts.relay.fetch(request({ dpop: proof, token })),
        )
      ).status
    }
    const now = Math.floor(Date.now() / 1000)

    // A clock ahead of the route's dates the first proof late, so it expires after the others.
    await send(early, { iat: now + 50 })
    // The verifier accepts a proof for 361 seconds after its `iat`, so these expire within 6 seconds.
    for (let index = 0; index < 1_000; index++)
      await send(busy, { iat: now - 355 })
    const limited = await send(busy)

    expect(limited).toMatchInlineSnapshot(`429`)
    await expect
      .poll(() => send(busy), { interval: 500, timeout: 15_000 })
      .toBe(503)
  }, 60_000)

  test('refuses a DPoP proof whose jti exceeds 256 characters with 401, before it holds the proof', async () => {
    const keys = await issuer()
    const accounts = instance(keys)
    const dpop = await Dpop.create()
    const bound = await keys.sign({ jkt: Dpop.thumbprint(dpop) })
    const proof = await sign(dpop, {
      accessToken: bound,
      jti: 'a'.repeat(257),
      url: 'https://app.example/api/relay',
    })

    const response = await accounts.relay.fetch(
      request({ dpop: proof, token: bound }),
    )

    expect((await summary(response)).reason).toMatchInlineSnapshot(
      `"invalid_dpop_proof"`,
    )
  })

  test("accepts a resource's tokens only with its `audience` in `verify`", async () => {
    const keys = await issuer()
    const token = await keys.sign({ audience: 'https://api.example' })
    const implicit = instance(keys, {}, { resource: 'https://api.example' })
    const accounts = instance(
      keys,
      { verify: { audience: 'https://api.example' } },
      { resource: 'https://api.example' },
    )

    const refused = await implicit.relay.fetch(request({ token }))

    const response = await accounts.relay.fetch(request({ token }))

    expect((await summary(refused)).status).toMatchInlineSnapshot(`401`)
    expect((await summary(response)).status).toMatchInlineSnapshot(`503`)
  })
})

/** The instance's Tempo ID, and the issuer of its tokens. */
const url = 'https://id.test'

/** Returns an instance on Tempo testnet whose relay route sends to a Tempo API that nothing serves. */
function instance(
  keys: { fetch: typeof globalThis.fetch },
  options:
    | Pick<relay.Options.Verified, 'authorize' | 'url' | 'verify'>
    | { verify: false } = {},
  config: { resource?: string | undefined } = {},
) {
  return Accounts.create({
    ...config,
    clientId: 'https://app.example',
    chain: 'testnet',
    fetch: keys.fetch,
    plugins: [
      relay({ apiKey: 'test', apiUrl: 'http://127.0.0.1:9', ...options }),
    ],
    url,
  })
}

/** Returns the code and message of the JSON-RPC error of `response`. */
async function failure(response: Response) {
  const body = (await response.json()) as {
    error?: { code?: number; message?: string }
  }
  return { code: body.error?.code, message: body.error?.message }
}

/** Returns a DPoP proof of a \`POST\` to \`url\` with its own \`jti\`, which \`Dpop.proof\` generates. */
async function sign(
  dpop: Dpop.Dpop,
  options: {
    accessToken: string
    iat?: number | undefined
    jti: string
    url: string
  },
) {
  const encode = (value: unknown) =>
    Base64.fromString(JSON.stringify(value), { pad: false, url: true })
  const input = [
    encode({ alg: 'ES256', jwk: dpop.jwk, typ: 'dpop+jwt' }),
    encode({
      ath: Base64.fromBytes(
        Hash.sha256(Bytes.fromString(options.accessToken)),
        {
          pad: false,
          url: true,
        },
      ),
      htm: 'POST',
      htu: options.url,
      iat: options.iat ?? Math.floor(Date.now() / 1000),
      jti: options.jti,
    }),
  ].join('.')
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    dpop.privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${Base64.fromBytes(new Uint8Array(signature), { pad: false, url: true })}`
}

/** Returns a fee payer, and the hash of each payload that it signs. */
function feePayer() {
  const signed: string[] = []
  const key = privateKeyToAccount(generatePrivateKey())
  const account = {
    ...key,
    sign: (parameters: Parameters<typeof key.sign>[0]) => {
      signed.push(parameters.hash)
      return key.sign(parameters)
    },
  }
  return { account, signed }
}

/** Returns a signer of access tokens, and a `fetch` that serves its key set at Tempo ID's JWKS URL. */
async function issuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test' }
  return {
    fetch: (() =>
      Promise.resolve(
        Response.json({ keys: [jwk] }),
      )) as unknown as typeof globalThis.fetch,
    sign: (
      options: {
        audience?: string | undefined
        clientId?: string | undefined
        jkt?: string | undefined
      } = {},
    ) =>
      new SignJWT({
        client_id: options.clientId ?? 'https://app.example',
        ...(options.jkt ? { cnf: { jkt: options.jkt } } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test', typ: 'at+jwt' })
        .setAudience(options.audience ?? url)
        .setExpirationTime('5m')
        .setIssuedAt()
        .setIssuer(url)
        .setSubject('user_1')
        .sign(privateKey),
  }
}

/** The private key of the sender of each transaction of the fee payer's tests. */
const sender = generatePrivateKey()

/** Returns a fill that names its sender, gas, nonce, and fee cap, which a fee payer signs without a node. */
function prepared() {
  return {
    from: privateKeyToAccount(sender).address,
    gas: '0x7a120',
    maxFeePerGas: '0x2540be400',
    nonce: '0x1',
    to: '0x00000000000000000000000000000000deadbeef',
  }
}

/** Returns a transaction of `chainId` that its sender signed, and that asks for a fee payer's signature. */
function raw(chainId: number) {
  const envelope = TxEnvelopeTempo.from({
    calls: [{ to: '0x00000000000000000000000000000000deadbeef' }],
    chainId,
    feePayerSignature: null,
    gas: 500_000n,
    maxFeePerGas: 10_000_000_000n,
    maxPriorityFeePerGas: 10_000_000_000n,
    nonce: 1n,
    validBefore: Math.floor(Date.now() / 1_000) + 600,
  })
  const signature = Secp256k1.sign({
    payload: TxEnvelopeTempo.getSignPayload(envelope),
    privateKey: sender,
  })
  return TxEnvelopeTempo.serialize(envelope, {
    signature: SignatureEnvelope.from(signature),
  })
}

/** Returns a relay plugin that refuses each request, and the method of each request that it receives. */
function refusal() {
  const methods: string[] = []
  const plugin: Relay.Plugin = {
    handleRequest(context) {
      methods.push(context.request.method)
      return Promise.reject(
        new Error('Refused sponsorship: the app sponsors no transaction.'),
      )
    },
  }
  return { methods, plugin }
}

/**
 * Returns a fill request to the route at `url`, or a batch of one, with `token` as a Bearer token,
 * or as a DPoP token with `dpop`.
 */
function request(
  options: {
    batch?: boolean | undefined
    dpop?: string | undefined
    token?: string | undefined
    url?: string | undefined
  } = {},
) {
  const { batch, dpop, token } = options
  const fill = {
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_fillTransaction',
    params: [{}],
  }
  return new Request(options.url ?? 'https://app.example/api/relay', {
    body: JSON.stringify(batch ? [fill] : fill),
    headers: {
      'content-type': 'application/json',
      ...(token
        ? { authorization: dpop ? `DPoP ${token}` : `Bearer ${token}` }
        : {}),
      ...(dpop ? { dpop } : {}),
    },
    method: 'POST',
  })
}

/**
 * Returns the `init` of a request whose body is a stream of 32 chunks of 64 KiB, with no declared
 * size, and `read`, which returns the count of the chunks that its reader pulled.
 */
function large() {
  const chunk = new Uint8Array(64 * 1024).fill(0x20)
  let pulled = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled === 32) return controller.close()
        pulled++
        controller.enqueue(chunk)
      },
    },
    // The stream holds no chunk before its reader asks for one, so `pulled` counts the reads.
    { highWaterMark: 0 },
  )
  return {
    init: { body, duplex: 'half' } as RequestInit,
    read: () => pulled,
  }
}

/**
 * Returns a JSON object of 100,000 nested objects as `body`, and as `encodes` whether the runtime's
 * `JSON.stringify` encodes what its `JSON.parse` returns for it.
 */
function nested() {
  const body = `${'{"a":'.repeat(100_000)}1${'}'.repeat(100_000)}`
  const encodes = (() => {
    try {
      JSON.stringify(JSON.parse(body))
      return true
    } catch {
      return false
    }
  })()
  return { body, encodes }
}

/** Returns a request to the route of `method` with `parameter`, with `token` as a Bearer token. */
function rpc(token: string, method: string, parameter: unknown) {
  return new Request('https://app.example/api/relay', {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method,
      params: [parameter],
    }),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
}

/** Returns an instance on Tempo testnet whose relay route runs Viem's relay over a node that nothing serves. */
function sponsor(
  keys: { fetch: typeof globalThis.fetch },
  options: relay.Options.Viem.Account | relay.Options.Viem.Plugins,
) {
  return Accounts.create({
    clientId: 'https://app.example',
    chain: 'testnet',
    fetch: keys.fetch,
    plugins: [
      viem({
        transport: custom({
          request: () => Promise.reject(new Error('No node listens.')),
        }),
      }),
      relay(options),
    ],
    url,
  })
}

/** Returns the status of `response`, and the reason and message of its body's error. */
async function summary(response: Response) {
  const body = (await response.json()) as {
    error?: string | { data?: { reason?: string }; message?: string }
  }
  const error = body.error
  if (typeof error === 'string')
    return { reason: error, status: response.status }
  return {
    message: error?.message,
    reason: error?.data?.reason,
    status: response.status,
  }
}
