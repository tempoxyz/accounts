import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import * as Rpc from './rpc.js'

const account = '0x0000000000000000000000000000000000000001'
const accessKey = '0x0000000000000000000000000000000000000002'
const token = '0x20c0000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000003'
const contract = '0x0000000000000000000000000000000000000004'

describe('transactionRequest.keyAuthorization', () => {
  test('decodes rpc key authorizations into ox key authorizations', () => {
    const authorization = KeyAuthorization.from(
      {
        address: accessKey,
        chainId: 1n,
        expiry: 123,
        limits: [{ token, limit: 100n, period: 60 }],
        scopes: [
          { address: contract },
          { address: token, selector: 'transfer(address,uint256)', recipients: [recipient] },
        ],
        type: 'p256',
      },
      { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
    )
    const rpc = KeyAuthorization.toRpc(authorization)

    expect(
      z.decode(Rpc.transactionRequest, {
        from: account,
        keyAuthorization: { ...rpc, address: rpc.keyId },
      }).keyAuthorization,
    ).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000002",
        "chainId": 1n,
        "expiry": 123,
        "limits": [
          {
            "limit": 100n,
            "period": 60,
            "token": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "scopes": [
          {
            "address": "0x0000000000000000000000000000000000000004",
          },
          {
            "address": "0x20c0000000000000000000000000000000000001",
            "recipients": [
              "0x0000000000000000000000000000000000000003",
            ],
            "selector": "0xa9059cbb",
          },
        ],
        "signature": {
          "signature": {
            "r": 0n,
            "s": 0n,
            "yParity": 0,
          },
          "type": "secp256k1",
        },
        "type": "p256",
      }
    `)
  })

  test('encodes ox key authorizations into rpc key authorizations', () => {
    const authorization = KeyAuthorization.from(
      {
        address: accessKey,
        chainId: 1n,
        expiry: 123,
        limits: [{ token, limit: 100n, period: 60 }],
        scopes: [
          { address: contract },
          { address: token, selector: 'transfer(address,uint256)', recipients: [recipient] },
        ],
        type: 'p256',
      },
      { signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`) },
    )

    expect(
      z.encode(Rpc.transactionRequest, {
        from: account,
        keyAuthorization: authorization,
      }).keyAuthorization,
    ).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000002",
        "allowedCalls": [
          {
            "target": "0x0000000000000000000000000000000000000004",
          },
          {
            "selectorRules": [
              {
                "recipients": [
                  "0x0000000000000000000000000000000000000003",
                ],
                "selector": "0xa9059cbb",
              },
            ],
            "target": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "chainId": "0x1",
        "expiry": "0x7b",
        "keyId": "0x0000000000000000000000000000000000000002",
        "keyType": "p256",
        "limits": [
          {
            "limit": "0x64",
            "period": "0x3c",
            "token": "0x20c0000000000000000000000000000000000001",
          },
        ],
        "signature": {
          "r": "0x0000000000000000000000000000000000000000000000000000000000000000",
          "s": "0x0000000000000000000000000000000000000000000000000000000000000000",
          "type": "secp256k1",
          "yParity": "0x0",
        },
      }
    `)
  })
})

describe('wallet_connect.capabilities.request: auth', () => {
  test('accepts string shorthand', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: '/api/auth',
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": "/api/auth",
        "method": "login",
      }
    `)
  })

  test('accepts object with `url`', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { url: '/api/auth' },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "url": "/api/auth",
        },
        "method": "login",
      }
    `)
  })

  test('accepts object with `url` and `returnToken`', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { url: '/api/auth', returnToken: true },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "returnToken": true,
          "url": "/api/auth",
        },
        "method": "login",
      }
    `)
  })

  test('accepts object with `resources`', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: {
          url: '/api/auth',
          resources: ['urn:tempo:api-signing-key:test'],
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "resources": [
            "urn:tempo:api-signing-key:test",
          ],
          "url": "/api/auth",
        },
        "method": "login",
      }
    `)
  })

  test('accepts explicit endpoints (challenge + verify + logout)', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { challenge: '/c', verify: '/v', logout: '/l' },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "challenge": "/c",
          "logout": "/l",
          "verify": "/v",
        },
        "method": "login",
      }
    `)
  })

  test('accepts explicit endpoints with `returnToken` and no `logout`', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { challenge: '/c', verify: '/v', returnToken: true },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "challenge": "/c",
          "returnToken": true,
          "verify": "/v",
        },
        "method": "login",
      }
    `)
  })

  test('accepts explicit endpoints without `logout`', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { challenge: '/c', verify: '/v' },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "challenge": "/c",
          "verify": "/v",
        },
        "method": "login",
      }
    `)
  })

  test('accepts logout-only object (cross-field validation lives outside zod)', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { logout: '/l' },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "logout": "/l",
        },
        "method": "login",
      }
    `)
  })

  test('rejects auth as number', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: 42,
      }),
    ).toThrow()
  })

  test('rejects auth.url as number', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { url: 1 },
      }),
    ).toThrow()
  })

  test('rejects auth.returnToken as string', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { returnToken: 'yes' },
      }),
    ).toThrow()
  })

  test('rejects auth.resources as string', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        auth: { resources: 'urn:tempo:api-signing-key:test' },
      }),
    ).toThrow()
  })

  test('accepts auth alongside register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        auth: '/api/auth',
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": "/api/auth",
        "method": "register",
      }
    `)
  })
})

describe('wallet_connect.capabilities.request: identity', () => {
  test('accepts identity.email on login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        identity: { email: true },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": true,
        },
        "method": "login",
      }
    `)
  })

  test('accepts identity.email on register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        identity: { email: true },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": true,
        },
        "method": "register",
      }
    `)
  })

  test('accepts empty identity object', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        identity: {},
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {},
        "method": "login",
      }
    `)
  })

  test('accepts identity.email as { nonce } object', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        identity: { email: { nonce: 'abc123' } },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": {
            "nonce": "abc123",
          },
        },
        "method": "login",
      }
    `)
  })

  test('accepts identity.email as empty { } object (no nonce)', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        identity: { email: {} },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": {},
        },
        "method": "login",
      }
    `)
  })

  test('rejects identity.email as string', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        identity: { email: 'yes' },
      }),
    ).toThrow()
  })
})

describe('wallet_connect.capabilities.result: auth + personalSign', () => {
  test('accepts auth with token + personalSign echo + root signature', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.result, {
        auth: { token: 'sess_abc' },
        personalSign: { message: 'hello' },
        signature: '0xdeadbeef',
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "token": "sess_abc",
        },
        "personalSign": {
          "message": "hello",
        },
        "signature": "0xdeadbeef",
      }
    `)
  })

  test('accepts cookie-mode auth (empty object, no token)', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.result, {
        auth: {},
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {},
      }
    `)
  })

  test('accepts extra auth JSON fields', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.result, {
        auth: {
          apiSigningKey: { id: 'key_1' },
          token: 'sess_abc',
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "auth": {
          "apiSigningKey": {
            "id": "key_1",
          },
          "token": "sess_abc",
        },
      }
    `)
  })

  test('accepts result without auth/personalSign', () => {
    expect(z.parse(Rpc.wallet_connect.capabilities.result, {})).toMatchInlineSnapshot(`{}`)
  })
})

describe('wallet_connect.capabilities.result: identity', () => {
  test('accepts identity with verified email', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.result, {
        identity: { email: 'alice@example.com' },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": "alice@example.com",
        },
      }
    `)
  })

  test('accepts identity with null email', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.result, {
        identity: { email: null },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": null,
        },
      }
    `)
  })

  test('accepts empty identity object', () => {
    expect(z.parse(Rpc.wallet_connect.capabilities.result, { identity: {} }))
      .toMatchInlineSnapshot(`
      {
        "identity": {},
      }
    `)
  })

  test('accepts identity with email + idToken', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.result, {
        identity: { email: 'alice@example.com', idToken: 'eyJhbG.payload.sig' },
      }),
    ).toMatchInlineSnapshot(`
      {
        "identity": {
          "email": "alice@example.com",
          "idToken": "eyJhbG.payload.sig",
        },
      }
    `)
  })

  test('rejects identity.email as number', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.result, {
        identity: { email: 42 },
      }),
    ).toThrow()
  })

  test('rejects identity.idToken as number', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.result, {
        identity: { idToken: 42 },
      }),
    ).toThrow()
  })
})

describe('wallet_connect.capabilities.request: showDeposit', () => {
  test('accepts true on the register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        showDeposit: true,
      }),
    ).toEqual({
      method: 'register',
      showDeposit: true,
    })
  })

  test('accepts true on the login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        showDeposit: true,
      }),
    ).toEqual({
      method: 'login',
      showDeposit: true,
    })
  })

  test('accepts false on the register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        showDeposit: false,
      }),
    ).toEqual({
      method: 'register',
      showDeposit: false,
    })
  })

  test('accepts false on the login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        showDeposit: false,
      }),
    ).toEqual({
      method: 'login',
      showDeposit: false,
    })
  })

  test('accepts deposit parameters on the register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        showDeposit: {
          amount: '50',
          displayName: 'DoorDash',
          on: 'register',
          token: 'USDC',
        },
      }),
    ).toEqual({
      method: 'register',
      showDeposit: {
        amount: '50',
        displayName: 'DoorDash',
        on: 'register',
        token: 'USDC',
      },
    })
  })

  test('accepts deposit parameters on the login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'login',
        showDeposit: {
          amount: '25',
          on: 'login',
          token: 'USDC',
        },
      }),
    ).toEqual({
      method: 'login',
      showDeposit: {
        amount: '25',
        on: 'login',
        token: 'USDC',
      },
    })
  })

  test('rejects invalid deposit parameters', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        showDeposit: { amount: 50 },
      }),
    ).toThrow()
  })

  test('rejects invalid showDeposit event filters', () => {
    expect(() =>
      z.parse(Rpc.wallet_connect.capabilities.request, {
        method: 'register',
        showDeposit: { on: 'connect' },
      }),
    ).toThrow()
  })

  test('omits nested showDeposit from authorizeAccessKey', () => {
    expect(
      z.parse(Rpc.wallet_connect.capabilities.request, {
        authorizeAccessKey: {
          expiry: 123,
          showDeposit: true,
        },
        method: 'register',
      }),
    ).toMatchInlineSnapshot(`
      {
        "authorizeAccessKey": {
          "expiry": 123,
        },
        "method": "register",
      }
    `)
  })
})

describe('wallet_authorizeAccessKey.parameters: showDeposit', () => {
  test('accepts true', () => {
    expect(
      z.parse(Rpc.wallet_authorizeAccessKey.parameters, {
        expiry: 123,
        showDeposit: true,
      }),
    ).toMatchInlineSnapshot(`
      {
        "expiry": 123,
        "showDeposit": true,
      }
    `)
  })

  test('accepts deposit parameters', () => {
    expect(
      z.parse(Rpc.wallet_authorizeAccessKey.parameters, {
        expiry: 123,
        showDeposit: {
          amount: '50',
          displayName: 'DoorDash',
          token: 'USDC',
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "expiry": 123,
        "showDeposit": {
          "amount": "50",
          "displayName": "DoorDash",
          "token": "USDC",
        },
      }
    `)
  })

  test('rejects invalid deposit parameters', () => {
    expect(() =>
      z.parse(Rpc.wallet_authorizeAccessKey.parameters, {
        expiry: 123,
        showDeposit: { amount: 50 },
      }),
    ).toThrow()
  })
})

describe('wallet_authorizeAccessKey_strict.parameters: showDeposit', () => {
  test('accepts showDeposit with required access-key policy', () => {
    expect(
      z.parse(Rpc.wallet_authorizeAccessKey_strict.parameters, {
        expiry: 123,
        limits: [{ limit: 1n, token: '0x0000000000000000000000000000000000000001' }],
        scopes: [{ address: '0x0000000000000000000000000000000000000001' }],
        showDeposit: true,
      }),
    ).toMatchInlineSnapshot(`
      {
        "expiry": 123,
        "limits": [
          {
            "limit": 1n,
            "token": "0x0000000000000000000000000000000000000001",
          },
        ],
        "scopes": [
          {
            "address": "0x0000000000000000000000000000000000000001",
          },
        ],
        "showDeposit": true,
      }
    `)
  })
})

describe('wallet_connect_strict.parameters: auth', () => {
  test('accepts string shorthand', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'login',
          auth: '/api/auth',
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "capabilities": {
          "auth": "/api/auth",
          "method": "login",
        },
      }
    `)
  })

  test('accepts object form with all fields', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'login',
          auth: { url: '/api/auth', returnToken: true },
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "capabilities": {
          "auth": {
            "returnToken": true,
            "url": "/api/auth",
          },
          "method": "login",
        },
      }
    `)
  })
})

describe('wallet_connect_strict.parameters: showDeposit', () => {
  test('accepts true on the register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'register',
          showDeposit: true,
        },
      }),
    ).toEqual({
      capabilities: {
        method: 'register',
        showDeposit: true,
      },
    })
  })

  test('accepts true on the login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'login',
          showDeposit: true,
        },
      }),
    ).toEqual({
      capabilities: {
        method: 'login',
        showDeposit: true,
      },
    })
  })

  test('accepts false on the register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'register',
          showDeposit: false,
        },
      }),
    ).toEqual({
      capabilities: {
        method: 'register',
        showDeposit: false,
      },
    })
  })

  test('accepts false on the login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'login',
          showDeposit: false,
        },
      }),
    ).toEqual({
      capabilities: {
        method: 'login',
        showDeposit: false,
      },
    })
  })

  test('accepts deposit parameters on the register branch', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'register',
          showDeposit: {
            amount: '100',
            displayName: 'DoorDash',
            on: 'register',
            token: 'USDC',
          },
        },
      }),
    ).toEqual({
      capabilities: {
        method: 'register',
        showDeposit: {
          amount: '100',
          displayName: 'DoorDash',
          on: 'register',
          token: 'USDC',
        },
      },
    })
  })

  test('accepts deposit parameters on the login branch', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          method: 'login',
          showDeposit: {
            amount: '25',
            on: 'login',
            token: 'USDC',
          },
        },
      }),
    ).toEqual({
      capabilities: {
        method: 'login',
        showDeposit: {
          amount: '25',
          on: 'login',
          token: 'USDC',
        },
      },
    })
  })

  test('omits nested showDeposit from authorizeAccessKey', () => {
    expect(
      z.parse(Rpc.wallet_connect_strict.parameters, {
        capabilities: {
          authorizeAccessKey: {
            expiry: 123,
            limits: [{ limit: 1n, token: '0x0000000000000000000000000000000000000001' }],
            scopes: [{ address: '0x0000000000000000000000000000000000000001' }],
            showDeposit: true,
          },
          method: 'register',
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "capabilities": {
          "authorizeAccessKey": {
            "expiry": 123,
            "limits": [
              {
                "limit": 1n,
                "token": "0x0000000000000000000000000000000000000001",
              },
            ],
            "scopes": [
              {
                "address": "0x0000000000000000000000000000000000000001",
              },
            ],
          },
          "method": "register",
        },
      }
    `)
  })
})
