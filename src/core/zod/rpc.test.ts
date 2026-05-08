import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import * as Rpc from './rpc.js'

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

  test('accepts result without auth/personalSign', () => {
    expect(z.parse(Rpc.wallet_connect.capabilities.result, {})).toMatchInlineSnapshot(`{}`)
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
