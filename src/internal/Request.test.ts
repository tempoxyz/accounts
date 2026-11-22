/**
 * Tests the request builders: the registered resources that a request names, the authorization URL
 * that holds them, the key authorization of an access key that another party holds, the chain that
 * a challenge without an access key names, and the refusal of an access key expiry that has passed,
 * is fractional, or holds milliseconds, a negative limit, a fractional or negative period, a duration
 * period above the safe integers, two limits on one token, two scopes of one call, a zero or repeated
 * recipient, and empty limits or scopes.
 * @module
 */
import { Base64 } from 'ox'
import { zeroAddress } from 'viem'
import { Scopes } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import type * as Permissions from '../Permissions.js'
import * as Request from './Request.js'

describe('resources', () => {
  test('returns none without a resource', () => {
    const resources = Request.resources({})

    expect(resources).toMatchInlineSnapshot(`[]`)
  })

  test("returns the instance's resource", () => {
    const resources = Request.resources({ resource: 'https://mercator.sh/mcp' })

    expect(resources).toMatchInlineSnapshot(`
      [
        "https://mercator.sh/mcp",
      ]
    `)
  })

  test("returns the request's resources in place of the instance's", () => {
    const resources = Request.resources(
      { resource: 'https://mercator.sh/mcp' },
      { resource: ['https://a.example/mcp', 'https://b.example/mcp'] },
    )

    expect(resources).toMatchInlineSnapshot(`
      [
        "https://a.example/mcp",
        "https://b.example/mcp",
      ]
    `)
  })
})

describe('authorizeUrl', () => {
  test('names no resource without one', async () => {
    const auth = Accounts.from({ clientId: 'client_1' })

    const { url } = await Request.authorizeUrl(auth, {
      redirectUri: 'https://app.example/callback',
    })

    expect(new URL(url).searchParams.getAll('resource')).toMatchInlineSnapshot(
      `[]`,
    )
  })

  test("names the instance's resource", async () => {
    const auth = Accounts.from({
      clientId: 'client_1',
      resource: 'https://mercator.sh/mcp',
    })

    const { url } = await Request.authorizeUrl(auth, {
      redirectUri: 'https://app.example/callback',
    })

    expect(new URL(url).searchParams.getAll('resource')).toMatchInlineSnapshot(`
      [
        "https://mercator.sh/mcp",
      ]
    `)
  })

  test('names each resource of the request in its own parameter', async () => {
    const auth = Accounts.from({
      clientId: 'client_1',
      resource: 'https://mercator.sh/mcp',
    })

    const { url } = await Request.authorizeUrl(auth, {
      redirectUri: 'https://app.example/callback',
      resource: ['https://a.example/mcp', 'https://b.example/mcp'],
    })

    expect(new URL(url).searchParams.getAll('resource')).toMatchInlineSnapshot(`
      [
        "https://a.example/mcp",
        "https://b.example/mcp",
      ]
    `)
  })

  test('sends the fee allowance after the limits of an access key whose limits name no stablecoin', async () => {
    const auth = Accounts.from({ chain: 4217, clientId: 'client_1' })
    const mach = '0x20c000000000000000000000f37de3740adec032'

    const { url } = await Request.authorizeUrl(auth, {
      accessKey: {
        expiry: 4_102_444_800,
        limits: [{ limit: '2', token: 'mach' }],
        scopes: [{ address: mach, selector: '0x95777d59' }],
      },
      redirectUri: 'https://app.example/callback',
    })
    const keyAuthorization = JSON.parse(
      Base64.toString(new URL(url).searchParams.get('key_authorization')!),
    )

    expect(keyAuthorization.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": "0x1e8480",
          "token": "0x20c000000000000000000000f37de3740ADec032",
        },
        {
          "limit": "0x186a0",
          "token": "0x20c0000000000000000000006a37DA5C996874BE",
        },
        {
          "limit": "0x186a0",
          "token": "0x20C0000000000000000000000000000000000000",
        },
        {
          "limit": "0x186a0",
          "token": "0x20C000000000000000000000b9537d11c60E8b50",
        },
        {
          "limit": "0x186a0",
          "token": "0x20C00000000000000000000014f22CA97301EB73",
        },
      ]
    `)
  })

  test('sends only the named limit of an access key that another party holds, whose holder verifies it', async () => {
    const auth = Accounts.from({ chain: 4217, clientId: 'client_1' })
    const mach = '0x20c000000000000000000000f37de3740adec032'

    const { url } = await Request.authorizeUrl(auth, {
      accessKey: {
        address: '0x00000000000000000000000000000000000000cc',
        expiry: 4_102_444_800,
        limits: [{ limit: '2', period: 2_592_000, token: 'mach' }],
        scopes: [{ address: mach, selector: '0x95777d59' }],
      },
      redirectUri: 'https://app.example/callback',
    })
    const keyAuthorization = JSON.parse(
      Base64.toString(new URL(url).searchParams.get('key_authorization')!),
    )

    expect(keyAuthorization.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": "0x1e8480",
          "period": 2592000,
          "token": "0x20c000000000000000000000f37de3740ADec032",
        },
      ]
    `)
  })

  test("requests a merchant's access key by its address, with its witness, and keeps no material", async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })
    const token = '0x20c0000000000000000000000000000000000000'
    const recipient = '0x00000000000000000000000000000000000000aa'

    const { pending, url } = await Request.authorizeUrl(auth, {
      accessKey: {
        access: '0x00000000000000000000000000000000000000bb',
        address: '0x00000000000000000000000000000000000000cc',
        expiry: 4_102_444_800,
        limits: [{ limit: 10_000_000n, period: 2_592_000, token }],
        scopes: [
          { address: token, recipients: [recipient], selector: '0x95777d59' },
        ],
        witness: `0x${'11'.repeat(32)}`,
      },
      redirectUri: 'https://app.example/callback',
    })
    const keyAuthorization = JSON.parse(
      Base64.toString(new URL(url).searchParams.get('key_authorization')!),
    )

    expect(keyAuthorization).toMatchInlineSnapshot(`
      {
        "account": "0x00000000000000000000000000000000000000bb",
        "address": "0x00000000000000000000000000000000000000cc",
        "chainId": "0xa5bf",
        "expiry": 4102444800,
        "keyType": "secp256k1",
        "limits": [
          {
            "limit": "0x989680",
            "period": 2592000,
            "token": "0x20C0000000000000000000000000000000000000",
          },
        ],
        "scopes": [
          {
            "address": "0x20c0000000000000000000000000000000000000",
            "recipients": [
              "0x00000000000000000000000000000000000000aa",
            ],
            "selector": "0x95777d59",
          },
        ],
        "witness": "0x1111111111111111111111111111111111111111111111111111111111111111",
      }
    `)
    expect(Object.keys(pending).sort()).toMatchInlineSnapshot(`
      [
        "accessKey",
        "chainId",
        "clientId",
        "issuer",
        "redirectUri",
        "state",
        "verifier",
      ]
    `)
    expect(pending.accessKey).toMatchInlineSnapshot(`"address"`)
  })

  test('throws invalid_field, and builds no request, for a negative limit as a decimal string or in base units', async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })

    const errors = await Promise.all(
      (['-1', -1n] as const).map((limit) =>
        Request.authorizeUrl(auth, {
          accessKey: { expiry: '1d', limits: [{ limit, token: 'ousd' }] },
          redirectUri: 'https://app.example/callback',
        }).catch((error: unknown) => error),
      ),
    )

    expect(
      errors.map((error) => ({
        field: (error as Accounts.RequestError).field,
        message: (error as Accounts.RequestError).message,
        name: (error as Error).name,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "field": "accessKey.limits.0.limit",
          "message": "Invalid limit on 0x20c0000000000000000000006a37DA5C996874BE: the limit is negative. Use a limit of 0 or more.",
          "name": "Accounts.RequestError",
          "reason": "invalid_field",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.limit",
          "message": "Invalid limit on 0x20c0000000000000000000006a37DA5C996874BE: the limit is negative. Use a limit of 0 or more.",
          "name": "Accounts.RequestError",
          "reason": "invalid_field",
          "status": 0,
        },
      ]
    `)
  })

  test('throws duplicate_limit, and builds no request, for two limits on one token by its symbol and its address', async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })

    const error = await Request.authorizeUrl(auth, {
      accessKey: {
        expiry: '1d',
        limits: [
          { limit: '100', token: 'ousd' },
          { limit: '5', token: '0x20c0000000000000000000006a37da5c996874be' },
        ],
      },
      redirectUri: 'https://app.example/callback',
    }).catch((error: unknown) => error)

    expect({
      field: (error as Accounts.RequestError).field,
      message: (error as Accounts.RequestError).message,
      reason: (error as Accounts.RequestError).reason,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "field": "accessKey.limits.1.token",
        "message": "Duplicate limit for 0x20c0000000000000000000006a37DA5C996874BE. Limit each token once.",
        "reason": "duplicate_limit",
        "status": 0,
      }
    `)
  })
  test('throws duplicate_scope and invalid_recipients, and builds no request, for a repeated scope, a scope of any call beside another on a token, a zero or repeated spender, and a repeated recipient', async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })
    const ousd = '0x20c0000000000000000000006a37da5c996874be'
    const contract = '0x2222222222222222222222222222222222222222'
    const spender = '0x1111111111111111111111111111111111111111'

    const errors = await Promise.all(
      (
        [
          {
            expiry: '1d',
            limits: [{ limit: '10', token: 'ousd' }],
            scopes: [
              Scopes.tip20(ousd).transfer(),
              Scopes.tip20(ousd).transfer(),
            ],
          },
          {
            expiry: '1d',
            limits: [{ limit: '10', token: 'ousd' }],
            scopes: [
              Scopes.tip20(ousd).transfer(),
              { address: contract, selector: '0x12345678' },
              { address: contract },
            ],
          },
          {
            expiry: '1d',
            limits: [{ limit: '10', token: 'ousd' }],
            scopes: [Scopes.tip20(ousd).transfer(), { address: ousd }],
          },
          {
            expiry: '1d',
            limits: [{ limit: '10', token: 'ousd' }],
            scopes: [
              Scopes.tip20(ousd).transfer(),
              { address: ousd, selector: 'transfer(address, uint256)' },
            ],
          },
          {
            expiry: '1d',
            limits: [{ limit: '10', spenders: [zeroAddress], token: 'ousd' }],
          },
          {
            expiry: '1d',
            limits: [
              { limit: '10', spenders: [spender, spender], token: 'ousd' },
            ],
          },
          {
            expiry: '1d',
            limits: [{ limit: '10', token: 'ousd' }],
            scopes: [
              Scopes.tip20(ousd).transfer(),
              Scopes.tip20(ousd).approve({ recipients: [spender, spender] }),
            ],
          },
        ] satisfies readonly Permissions.Permissions[]
      ).map((accessKey) =>
        Request.authorizeUrl(auth, {
          accessKey,
          redirectUri: 'https://app.example/callback',
        }).catch((error: unknown) => error),
      ),
    )

    expect(
      errors.map((error) => ({
        field: (error as Accounts.RequestError).field,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "field": "accessKey.scopes.1.selector",
          "reason": "duplicate_scope",
          "status": 0,
        },
        {
          "field": "accessKey.scopes.2.selector",
          "reason": "duplicate_scope",
          "status": 0,
        },
        {
          "field": "accessKey.scopes.1.selector",
          "reason": "duplicate_scope",
          "status": 0,
        },
        {
          "field": "accessKey.scopes.1.selector",
          "reason": "duplicate_scope",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.spenders.0",
          "reason": "invalid_recipients",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.spenders.1",
          "reason": "invalid_recipients",
          "status": 0,
        },
        {
          "field": "accessKey.scopes.1.recipients.1",
          "reason": "invalid_recipients",
          "status": 0,
        },
      ]
    `)
  })
  test('leaves a malformed spender or recipient to Tempo ID, and throws no error of its own', async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })

    const results = await Promise.all(
      (
        [
          {
            expiry: '1d',
            limits: [{ limit: '10', spenders: ['0x1234'], token: 'ousd' }],
          },
          {
            expiry: '1d',
            limits: [{ limit: '10', token: 'ousd' }],
            scopes: [
              Scopes.tip20(
                '0x20c0000000000000000000006a37da5c996874be',
              ).transfer(),
              Scopes.tip20(
                '0x20c0000000000000000000006a37da5c996874be',
              ).approve({
                recipients: ['0x1234', '0x1234'],
              }),
            ],
          },
        ] satisfies readonly Permissions.Permissions[]
      ).map((accessKey) =>
        Request.authorizeUrl(auth, {
          accessKey,
          redirectUri: 'https://app.example/callback',
        }).then(
          (value) => typeof value.url,
          (error: unknown) => (error as Error).name,
        ),
      ),
    )

    expect(results).toMatchInlineSnapshot(`
      [
        "string",
        "string",
      ]
    `)
  })
  test('throws empty_limits for empty limits, and empty_scopes for empty scopes, and builds no request', async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })

    const errors = await Promise.all(
      [
        { expiry: '1d', limits: [] },
        { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }], scopes: [] },
      ].map((accessKey) =>
        Request.authorizeUrl(auth, {
          accessKey: accessKey as Permissions.Permissions,
          redirectUri: 'https://app.example/callback',
        }).catch((error: unknown) => error),
      ),
    )

    expect(
      errors.map((error) => ({
        field: (error as Accounts.RequestError).field,
        name: (error as Error).name,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "field": "accessKey.limits",
          "name": "Accounts.RequestError",
          "reason": "empty_limits",
          "status": 0,
        },
        {
          "field": "accessKey.scopes",
          "name": "Accounts.RequestError",
          "reason": "empty_scopes",
          "status": 0,
        },
      ]
    `)
  })
  test('throws invalid_expiry for an expiry of fractional seconds, and invalid_period for a fractional, negative, or NaN period, and builds no request', async () => {
    const auth = Accounts.from({ chain: 42431, clientId: 'client_1' })
    const expiry = Math.floor(Date.now() / 1000) + 3600.5

    const errors = await Promise.all(
      [
        { expiry, limits: [{ limit: '10', token: 'ousd' }] },
        { expiry: '1d', limits: [{ limit: '10', period: 1.5, token: 'ousd' }] },
        { expiry: '1d', limits: [{ limit: '10', period: -60, token: 'ousd' }] },
        { expiry: '1d', limits: [{ limit: '10', period: NaN, token: 'ousd' }] },
      ].map((accessKey) =>
        Request.authorizeUrl(auth, {
          accessKey: accessKey as Permissions.Permissions,
          redirectUri: 'https://app.example/callback',
        }).catch((error: unknown) => error),
      ),
    )

    expect(
      errors.map((error) => ({
        field: (error as Accounts.RequestError).field,
        name: (error as Error).name,
        reason: (error as Accounts.RequestError).reason,
        status: (error as Accounts.RequestError).status,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "field": "accessKey.expiry",
          "name": "Accounts.RequestError",
          "reason": "invalid_expiry",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.period",
          "name": "Accounts.RequestError",
          "reason": "invalid_period",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.period",
          "name": "Accounts.RequestError",
          "reason": "invalid_period",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.period",
          "name": "Accounts.RequestError",
          "reason": "invalid_period",
          "status": 0,
        },
      ]
    `)
  })
})

describe('challenge', () => {
  test("names the instance's chain beside a challenge without an access key, in the authorization URL and the headless request", async () => {
    const auth = Accounts.from({ chain: 4217, clientId: 'client_1' })

    const { url } = await Request.authorizeUrl(auth, {
      challenge: 'Sign in to app.example',
      redirectUri: 'https://app.example/callback',
    })
    const json = Request.request(auth, { challenge: 'Sign in to app.example' })

    expect([
      new URL(url).searchParams.get('chain_id'),
      new URL(url).searchParams.get('challenge'),
    ]).toMatchInlineSnapshot(`
      [
        "4217",
        "Sign in to app.example",
      ]
    `)
    expect([json.chain_id, json.challenge]).toMatchInlineSnapshot(`
      [
        4217,
        "Sign in to app.example",
      ]
    `)
  })
})

describe('permissions', () => {
  test('throws `expiry_passed` with status 0 for an expiry that has passed', () => {
    const error = (() => {
      try {
        Request.permissions({ chainId: 4217 }, { accessKey: { expiry: 1 } })
      } catch (error) {
        return error
      }
    })()

    expect(error).toBeInstanceOf(Accounts.RequestError)
    expect({
      field: (error as Accounts.RequestError).field,
      reason: (error as Accounts.RequestError).reason,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "field": "accessKey.expiry",
        "reason": "expiry_passed",
        "status": 0,
      }
    `)
  })

  test('throws `invalid_expiry` with status 0 for an expiry in milliseconds, such as `Date.now()` plus an hour, on a local chain', () => {
    const error = (() => {
      try {
        Request.permissions(
          { chainId: 1337 },
          {
            accessKey: {
              expiry: Date.now() + 3_600_000,
              limits: [{ limit: '5', token: 'ousd' }],
            },
          },
        )
      } catch (error) {
        return error
      }
    })()

    expect({
      field: (error as Accounts.RequestError).field,
      name: (error as Error).name,
      reason: (error as Accounts.RequestError).reason,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "field": "accessKey.expiry",
        "name": "Accounts.RequestError",
        "reason": "invalid_expiry",
        "status": 0,
      }
    `)
  })

  test('resolves a future expiry, and an expiry of 0, which never expires', () => {
    const future = Math.floor(Date.now() / 1000) + 3600

    const resolved = [
      Request.permissions({ chainId: 4217 }, { accessKey: { expiry: future } })
        .expiry === future,
      Request.permissions({ chainId: 4217 }, { accessKey: { expiry: 0 } })
        .expiry,
    ]

    expect(resolved).toMatchInlineSnapshot(`
      [
        true,
        0,
      ]
    `)
  })

  test('throws `invalid_period` with status 0 for a duration period above 9007199254740991 seconds, and resolves that period', () => {
    const periods = [
      '9007199254740991s',
      '9007199254740993s',
      `1${'0'.repeat(309)}s`,
      '99999999999999999999w',
    ]

    const outcomes = periods.map((period) => {
      try {
        return Request.permissions(
          { chainId: 42431 },
          {
            accessKey: {
              expiry: '1d',
              limits: [
                {
                  limit: 10_000_000n,
                  period: period as Permissions.Duration,
                  token: 'ousd',
                },
              ],
            },
          },
        ).limits?.[0]?.period
      } catch (error) {
        return {
          field: (error as Accounts.RequestError).field,
          name: (error as Error).name,
          reason: (error as Accounts.RequestError).reason,
          status: (error as Accounts.RequestError).status,
        }
      }
    })

    expect(outcomes).toMatchInlineSnapshot(`
      [
        9007199254740991,
        {
          "field": "accessKey.limits.0.period",
          "name": "Accounts.RequestError",
          "reason": "invalid_period",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.period",
          "name": "Accounts.RequestError",
          "reason": "invalid_period",
          "status": 0,
        },
        {
          "field": "accessKey.limits.0.period",
          "name": "Accounts.RequestError",
          "reason": "invalid_period",
          "status": 0,
        },
      ]
    `)
  })
})
