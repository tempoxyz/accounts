import { Elysia } from 'elysia'
import express from 'express'
import { Hono } from 'hono'
import type { RpcRequest } from 'ox'
import { sendTransactionSync } from 'viem/actions'
import { withFeePayer } from 'viem/tempo'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vp/test'

import { accounts, chain, getClient, http } from '../../test/config.js'
import { createServer, type Server } from '../../test/utils.js'
import * as Ceremony from '../core/Ceremony.js'
import * as Handler from './Handler.js'
import * as Kv from './Kv.js'

describe('from', () => {
  describe('cors', () => {
    test('default: adds CORS headers', async () => {
      const handler = Handler.from()
      handler.get('/test', () => new Response('test'))

      const response = await handler.fetch(new Request('http://localhost/test'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      )
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
    })

    test('behavior: cors = false disables CORS headers', async () => {
      const handler = Handler.from({ cors: false })
      handler.get('/test', () => new Response('test'))

      const response = await handler.fetch(new Request('http://localhost/test'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull()
    })

    test('behavior: custom cors config', async () => {
      const handler = Handler.from({
        cors: {
          origin: 'https://example.com',
          methods: 'GET, POST',
          headers: 'Content-Type, Authorization',
          credentials: true,
          maxAge: 86400,
        },
      })
      handler.get('/test', () => new Response('test'))

      const response = await handler.fetch(new Request('http://localhost/test'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST')
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization',
      )
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400')
    })

    test('behavior: cors with array of origins', async () => {
      const handler = Handler.from({
        cors: {
          origin: ['https://example.com', 'https://other.com'],
        },
      })
      handler.get('/test', () => new Response('test'))

      const response = await handler.fetch(new Request('http://localhost/test'))

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://example.com, https://other.com',
      )
    })

    test('behavior: OPTIONS preflight with default CORS', async () => {
      const handler = Handler.from()
      handler.get('/test', () => new Response('test'))

      const response = await handler.fetch(
        new Request('http://localhost/test', { method: 'OPTIONS' }),
      )

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      )
    })

    test('behavior: custom headers override CORS headers', async () => {
      const handler = Handler.from({
        cors: { origin: 'https://default.com' },
        headers: { 'Access-Control-Allow-Origin': 'https://override.com' },
      })
      handler.get('/test', () => new Response('test'))

      const response = await handler.fetch(new Request('http://localhost/test'))

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://override.com')
    })
  })
})

describe('compose', () => {
  test('default', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))
    const handler2 = Handler.from()
    handler2.get('/test2', () => new Response('test2'))

    const handler = Handler.compose([handler1, handler2])
    expect(handler).toBeDefined()

    {
      const response = await handler.fetch(new Request('http://localhost/test'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test')
    }

    {
      const response = await handler.fetch(new Request('http://localhost/test2'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test2')
    }
  })

  test('behavior: path', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))
    const handler2 = Handler.from()
    handler2.get('/test2', () => new Response('test2'))

    const handler = Handler.compose([handler1, handler2], {
      path: '/api',
    })
    expect(handler).toBeDefined()

    {
      const response = await handler.fetch(new Request('http://localhost/api/test'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test')
    }

    {
      const response = await handler.fetch(new Request('http://localhost/api/test2'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test2')
    }
  })

  test('behavior: headers', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))
    const handler2 = Handler.from()
    handler2.get('/test2', () => new Response('test2'))

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })

    const handler = Handler.compose([handler1, handler2], {
      headers,
    })

    {
      const response = await handler.fetch(new Request('http://localhost/test'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization',
      )
    }

    {
      const response = await handler.fetch(new Request('http://localhost/test2'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test2')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
  })

  test('behavior: headers + path', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))
    const handler2 = Handler.from()
    handler2.get('/test2', () => new Response('test2'))

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    })

    const handler = Handler.compose([handler1, handler2], {
      headers,
      path: '/api',
    })

    {
      const response = await handler.fetch(new Request('http://localhost/api/test'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    }

    {
      const response = await handler.fetch(new Request('http://localhost/api/test2'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('test2')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
  })

  test('behavior: headers + OPTIONS', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    })

    const handler = Handler.compose([handler1], {
      headers,
    })

    const response = await handler.fetch(
      new Request('http://localhost/test', {
        method: 'OPTIONS',
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  test('behavior: headers + 404', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
    })

    const handler = Handler.compose([handler1], {
      headers,
    })

    const response = await handler.fetch(new Request('http://localhost/nonexistent'))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('behavior: headers propagation from child handlers', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => {
      const response = new Response('test')
      response.headers.set('X-Custom-Header', 'custom-value')
      return response
    })

    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
    })

    const handler = Handler.compose([handler1], {
      headers,
    })

    const response = await handler.fetch(new Request('http://localhost/test'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('X-Custom-Header')).toBe('custom-value')
  })

  test('behavior: headers with child handler headers', async () => {
    const childHeaders = new Headers({
      'X-Child-Header': 'child-value',
    })
    const handler1 = Handler.from({ headers: childHeaders })
    handler1.get('/test', () => new Response('test'))

    const parentHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'X-Parent-Header': 'parent-value',
    })

    const handler = Handler.compose([handler1], {
      headers: parentHeaders,
    })

    const response = await handler.fetch(new Request('http://localhost/test'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
    // Both parent and child headers should be present
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('X-Parent-Header')).toBe('parent-value')
    expect(response.headers.get('X-Child-Header')).toBe('child-value')
  })

  test('behavior: headers as object', async () => {
    const handler1 = Handler.from()
    handler1.get('/test', () => new Response('test'))

    const handler = Handler.compose([handler1], {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })

    const response = await handler.fetch(new Request('http://localhost/test'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
  })

  describe('integration', () => {
    const handler1 = Handler.from()
    handler1.get('/foo', () => new Response('foo'))
    handler1.post('/bar', () => new Response('bar'))

    const handler2 = Handler.from()
    handler2.get('/baz', () => new Response('baz'))
    handler2.post('/qux', () => new Response('qux'))

    const handler = Handler.compose([handler1, handler2], {
      path: '/api',
    })

    test('hono', async () => {
      const app = new Hono()
      app.use((c) => handler.fetch(c.req.raw))

      {
        const response = await app.request('/api/foo')
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await app.request('/api/bar', {
          method: 'POST',
        })
        expect(await response.text()).toBe('bar')
      }

      {
        const response = await app.request('/api/baz', {
          method: 'GET',
        })
        expect(await response.text()).toBe('baz')
      }

      {
        const response = await app.request('/api/qux', {
          method: 'POST',
        })
        expect(await response.text()).toBe('qux')
      }
    })

    test('elysia', async () => {
      const app = new Elysia().all('*', ({ request }) => handler.fetch(request))

      {
        const response = await app.handle(new Request('http://localhost/api/foo'))
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await app.handle(
          new Request('http://localhost/api/bar', {
            method: 'POST',
          }),
        )
        expect(await response.text()).toBe('bar')
      }

      {
        const response = await app.handle(
          new Request('http://localhost/api/baz', {
            method: 'GET',
          }),
        )
        expect(await response.text()).toBe('baz')
      }

      {
        const response = await app.handle(
          new Request('http://localhost/api/qux', {
            method: 'POST',
          }),
        )
        expect(await response.text()).toBe('qux')
      }
    })

    test('node.js', async () => {
      const server = await createServer(handler.listener)

      {
        const response = await fetch(`${server.url}/api/foo`)
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await fetch(`${server.url}/api/bar`, {
          method: 'POST',
        })
        expect(await response.text()).toBe('bar')
      }

      {
        const response = await fetch(`${server.url}/api/baz`, {
          method: 'GET',
        })
        expect(await response.text()).toBe('baz')
      }

      {
        const response = await fetch(`${server.url}/api/qux`, {
          method: 'POST',
        })
        expect(await response.text()).toBe('qux')
      }

      await server.closeAsync()
    })

    test('express', async () => {
      const app = express()
      app.use(handler.listener)

      const server = await createServer(app)

      {
        const response = await fetch(`${server.url}/api/foo`)
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await fetch(`${server.url}/api/bar`, {
          method: 'POST',
        })
        expect(await response.text()).toBe('bar')
      }

      {
        const response = await fetch(`${server.url}/api/baz`, {
          method: 'GET',
        })
        expect(await response.text()).toBe('baz')
      }

      {
        const response = await fetch(`${server.url}/api/qux`, {
          method: 'POST',
        })
        expect(await response.text()).toBe('qux')
      }

      await server.closeAsync()
    })
  })
})

describe('from', () => {
  test('default', () => {
    const handler = Handler.from()
    expect(handler).toBeDefined()
  })

  test('.fetch', async () => {
    const handler = Handler.from()
    handler.get('/test', () => new Response('test'))

    const response = await handler.fetch(new Request('http://localhost/test'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
  })

  test('.listener', async () => {
    const handler = Handler.from()
    handler.get('/test', () => Response.json({ message: 'hello from listener' }))

    const server = await createServer(handler.listener)

    // Make a request to the server
    const response = await fetch(`${server.url}/test`)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toEqual({ message: 'hello from listener' })
  })

  test('behavior: headers', async () => {
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })

    const handler = Handler.from({ headers })
    handler.get('/test', () => new Response('test'))

    const response = await handler.fetch(new Request('http://localhost/test'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
  })

  test('behavior: headers + OPTIONS', async () => {
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    })

    const handler = Handler.from({ headers })
    handler.get('/test', () => new Response('test'))

    const response = await handler.fetch(
      new Request('http://localhost/test', {
        method: 'OPTIONS',
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  test('behavior: headers + 404', async () => {
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
    })

    const handler = Handler.from({ headers })
    handler.get('/test', () => new Response('test'))

    const response = await handler.fetch(new Request('http://localhost/nonexistent'))

    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('behavior: headers propagation from routes', async () => {
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
    })

    const handler = Handler.from({ headers })
    handler.get('/test', () => {
      const response = new Response('test')
      response.headers.set('X-Custom-Header', 'custom-value')
      response.headers.set('Content-Type', 'text/plain')
      return response
    })

    const response = await handler.fetch(new Request('http://localhost/test'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('X-Custom-Header')).toBe('custom-value')
    expect(response.headers.get('Content-Type')).toBe('text/plain')
  })

  test('behavior: headers as object', async () => {
    const handler = Handler.from({
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
    handler.get('/test', () => new Response('test'))

    const response = await handler.fetch(new Request('http://localhost/test'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('test')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
  })

  describe('integration', () => {
    const handler = Handler.from()
    handler.get('/foo', () => new Response('foo'))
    handler.post('/bar', () => new Response('bar'))

    test('hono', async () => {
      const app = new Hono()
      app.use((c) => handler.fetch(c.req.raw))

      {
        const response = await app.request('/foo')
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await app.request('/bar', {
          method: 'POST',
        })
        expect(await response.text()).toBe('bar')
      }
    })

    test('elysia', async () => {
      const app = new Elysia().all('*', ({ request }) => handler.fetch(request))

      {
        const response = await app.handle(new Request('http://localhost/foo'))
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await app.handle(
          new Request('http://localhost/bar', {
            method: 'POST',
          }),
        )
        expect(await response.text()).toBe('bar')
      }
    })

    test('node.js', async () => {
      const server = await createServer(handler.listener)

      {
        const response = await fetch(`${server.url}/foo`)
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await fetch(`${server.url}/bar`, {
          method: 'POST',
        })
        expect(await response.text()).toBe('bar')
      }

      await server.closeAsync()
    })

    test('express', async () => {
      const app = express()
      app.use(handler.listener)

      const server = await createServer(app)

      {
        const response = await fetch(`${server.url}/foo`)
        expect(await response.text()).toBe('foo')
      }

      {
        const response = await fetch(`${server.url}/bar`, {
          method: 'POST',
        })
        expect(await response.text()).toBe('bar')
      }

      await server.closeAsync()
    })
  })
})

describe('feePayer', () => {
  const userAccount = accounts[9]!
  const feePayerAccount = accounts[0]!

  let server: Server
  let requests: RpcRequest.RpcRequest[] = []

  beforeAll(async () => {
    server = await createServer(
      Handler.feePayer({
        account: feePayerAccount,
        chains: [chain],
        transports: { [chain.id]: http() },
        onRequest: async (request) => {
          requests.push(request)
        },
      }).listener,
    )
  })

  afterAll(() => {
    server.close()
    process.on('SIGINT', () => {
      server.close()
      process.exit(0)
    })
    process.on('SIGTERM', () => {
      server.close()
      process.exit(0)
    })
  })

  afterEach(() => {
    requests = []
  })

  describe('POST /', () => {
    test('behavior: eth_signRawTransaction', async () => {
      const client = getClient({
        account: userAccount,
        transport: withFeePayer(http(), http(server.url)),
      })

      const receipt = await sendTransactionSync(client, {
        feePayer: true,
        to: '0x0000000000000000000000000000000000000000',
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())

      expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
        [
          "eth_signRawTransaction",
        ]
      `)
    })

    test('behavior: eth_sendRawTransaction', async () => {
      const client = getClient({
        account: userAccount,
        transport: withFeePayer(http(), http(server.url), {
          policy: 'sign-and-broadcast',
        }),
      })

      const receipt = await sendTransactionSync(client, {
        feePayer: true,
        to: '0x0000000000000000000000000000000000000000',
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())

      expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
        [
          "eth_sendRawTransactionSync",
        ]
      `)
    })

    test('behavior: eth_sendRawTransactionSync', async () => {
      const client = getClient({
        account: userAccount,
        transport: withFeePayer(http(), http(server.url), {
          policy: 'sign-and-broadcast',
        }),
      })

      const receipt = await sendTransactionSync(client, {
        feePayer: true,
        to: '0x0000000000000000000000000000000000000000',
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())

      expect(requests.map(({ method }) => method)).toMatchInlineSnapshot(`
        [
          "eth_sendRawTransactionSync",
        ]
      `)
    })

    test('behavior: unsupported method', async () => {
      await expect(
        fetch(server.url, {
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_chainId',
          }),
        }).then((response) => response.json()),
      ).resolves.toMatchInlineSnapshot(`
        {
          "error": {
            "code": -32004,
            "name": "RpcResponse.MethodNotSupportedError",
            "stack": "",
          },
          "id": 1,
          "jsonrpc": "2.0",
        }
      `)
    })

    test('behavior: internal error', async () => {
      const response = await fetch(server.url, {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_signRawTransaction',
          params: ['0xinvalid'],
        }),
      })

      const data = await response.json()
      expect(data).toMatchInlineSnapshot(`
        {
          "error": {
            "code": -32603,
            "name": "RpcResponse.InternalError",
            "stack": "",
          },
          "id": 1,
          "jsonrpc": "2.0",
        }
      `)
    })
  })
})

describe('webauthn', () => {
  let server: Server
  let ceremony: Ceremony.Ceremony

  beforeAll(async () => {
    server = await createServer(
      Handler.webauthn({
        kv: Kv.memory(),
        origin: 'http://localhost',
        rpId: 'localhost',
      }).listener,
    )
    ceremony = Ceremony.server({ url: server.url })
  })

  afterAll(async () => {
    await server.closeAsync()
  })

  describe('POST /register/options', () => {
    test('default: returns registration options', async () => {
      const { options } = await ceremony.getRegistrationOptions({ name: 'Test' })
      expect(options.publicKey).toBeDefined()
      expect(options.publicKey!.rp.id).toMatchInlineSnapshot(`"localhost"`)
      expect(options.publicKey!.rp.name).toMatchInlineSnapshot(`"localhost"`)
      expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
    })

    test('behavior: each call generates a unique challenge', async () => {
      const { options: a } = await ceremony.getRegistrationOptions({ name: 'Test' })
      const { options: b } = await ceremony.getRegistrationOptions({ name: 'Test' })
      expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
    })
  })

  describe('POST /login/options', () => {
    test('default: returns authentication options', async () => {
      const { options } = await ceremony.getAuthenticationOptions()
      expect(options.publicKey).toBeDefined()
      expect(options.publicKey!.rpId).toMatchInlineSnapshot(`"localhost"`)
      expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
    })

    test('behavior: each call generates a unique challenge', async () => {
      const { options: a } = await ceremony.getAuthenticationOptions()
      const { options: b } = await ceremony.getAuthenticationOptions()
      expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
    })
  })

  describe('POST /register', () => {
    test('error: invalid credential → 400', async () => {
      const response = await fetch(`${server.url}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fake', clientDataJSON: 'bad', attestationObject: 'bad' }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBeTypeOf('string')
    })
  })

  describe('POST /login', () => {
    test('error: unknown credential → 400', async () => {
      const response = await fetch(`${server.url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'unknown',
          metadata: { authenticatorData: '0x00', clientDataJSON: '{"challenge":"0xdead"}' },
          raw: {
            id: 'unknown',
            type: 'public-key',
            authenticatorAttachment: null,
            rawId: 'unknown',
            response: { clientDataJSON: 'e30' },
          },
          signature: '0x00',
        }),
      })
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toMatchInlineSnapshot(`"Missing or expired challenge"`)
    })
  })

  describe('challenge replay', () => {
    test('behavior: challenge consumed after register/options → re-fetching is required', async () => {
      // Get options twice — each should have a unique challenge stored in KV
      const { options: a } = await ceremony.getRegistrationOptions({ name: 'Replay' })
      const { options: b } = await ceremony.getRegistrationOptions({ name: 'Replay' })
      expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
    })

    test('behavior: challenge consumed after login/options → re-fetching is required', async () => {
      const { options: a } = await ceremony.getAuthenticationOptions()
      const { options: b } = await ceremony.getAuthenticationOptions()
      expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
    })
  })

  describe('hooks', () => {
    test('behavior: onRegister error does not call hook', async () => {
      let called = false
      const hookServer = await createServer(
        Handler.webauthn({
          kv: Kv.memory(),
          origin: 'http://localhost',
          rpId: 'localhost',
          onRegister() {
            called = true
            return Response.json({ extra: true })
          },
        }).listener,
      )

      const response = await fetch(`${hookServer.url}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fake', clientDataJSON: 'bad', attestationObject: 'bad' }),
      })
      expect(response.status).toBe(400)
      expect(called).toBe(false)

      await hookServer.closeAsync()
    })

    test('behavior: onAuthenticate error does not call hook', async () => {
      let called = false
      const hookServer = await createServer(
        Handler.webauthn({
          kv: Kv.memory(),
          origin: 'http://localhost',
          rpId: 'localhost',
          onAuthenticate() {
            called = true
            return Response.json({ extra: true })
          },
        }).listener,
      )

      const response = await fetch(`${hookServer.url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'unknown',
          metadata: { authenticatorData: '0x00', clientDataJSON: '{"challenge":"0xdead"}' },
          raw: {
            id: 'unknown',
            type: 'public-key',
            authenticatorAttachment: null,
            rawId: 'unknown',
            response: { clientDataJSON: 'e30' },
          },
          signature: '0x00',
        }),
      })
      expect(response.status).toBe(400)
      expect(called).toBe(false)

      await hookServer.closeAsync()
    })
  })
})
