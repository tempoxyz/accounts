import * as Http from 'node:http'
import * as Net from 'node:net'
import { expect, test } from 'vp/test'

import { createServer } from '../../../test/utils.js'
import { codeAuth } from './handlers/codeAuth.js'
import { deviceCode } from './handlers/deviceCode.js'
import { createRequest } from './requestListener.js'

test('cancellation removes body callbacks before later data and end events', async () => {
  const socket = new Net.Socket()
  const req = new Http.IncomingMessage(socket)
  req.method = 'POST'
  req.url = '/'
  const res = new Http.ServerResponse(req)
  const request = createRequest(req, res)
  const reader = request.body!.getReader()

  req.emit('data', Buffer.from('body'))
  expect(await reader.read()).toMatchInlineSnapshot(`
    {
      "done": false,
      "value": Uint8Array [
        98,
        111,
        100,
        121,
      ],
    }
  `)
  await reader.cancel()

  // These synchronous events threw outside the listener's handler try/catch.
  req.emit('data', Buffer.from('more'))
  req.emit('end')
  expect([req.listenerCount('data'), req.listenerCount('end')]).toMatchInlineSnapshot(`
    [
      0,
      0,
    ]
  `)
  expect(req.destroyed).toMatchInlineSnapshot(`false`)
  expect(res.shouldKeepAlive).toMatchInlineSnapshot(`false`)
  res.emit('finish')
  expect(req.destroyed).toMatchInlineSnapshot(`true`)
  reader.releaseLock()
  socket.destroy()
})

test('a completed body still reads normally and removes callbacks', async () => {
  const socket = new Net.Socket()
  const req = new Http.IncomingMessage(socket)
  req.method = 'POST'
  req.url = '/'
  const res = new Http.ServerResponse(req)
  const request = createRequest(req, res)

  req.emit('data', Buffer.from('{"ok":true}'))
  req.emit('end')
  expect(await request.json()).toMatchInlineSnapshot(`
    {
      "ok": true,
    }
  `)
  expect([req.listenerCount('data'), req.listenerCount('end')]).toMatchInlineSnapshot(`
    [
      0,
      0,
    ]
  `)
  socket.destroy()
})

test.each([
  ['codeAuth', '/auth/pkce/code', () => codeAuth()],
  [
    'deviceCode',
    '/auth/device/verify',
    () => deviceCode({ html: { render: () => new Response('verify') }, validate: () => undefined }),
  ],
] as const)(
  '%s rejects an oversized chunked upload and closes the unfinished connection',
  async (_, path, create) => {
    const handler = create()
    handler.get('/health', () => new Response('ok'))
    const server = await createServer(handler.listener)
    const socket = new Net.Socket()

    try {
      const response = await new Promise<string>((resolve, reject) => {
        let data = ''
        socket.setTimeout(2_000, () => {
          reject(new Error('Canceled upload connection stayed open.'))
          socket.destroy()
        })
        socket.on('data', (chunk) => (data += chunk))
        socket.on('error', (error: NodeJS.ErrnoException) => {
          // Closing a connection with unread upload bytes can reset it after the response.
          if (error.code !== 'ECONNRESET') reject(error)
        })
        socket.on('close', () => resolve(data))
        socket.connect(Number(new URL(server.url).port), 'localhost', () => {
          const body = 'x'.repeat(65_537)
          socket.write(
            `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n`,
          )
          // Deliberately omit the terminating chunk: the server must close it.
        })
      })
      expect(response.split('\r\n')[0]).toMatchInlineSnapshot(`"HTTP/1.1 400 Bad Request"`)
      expect(response.toLowerCase().includes('connection: close')).toMatchInlineSnapshot(`true`)
      const body = JSON.parse(response.slice(response.indexOf('{'), response.lastIndexOf('}') + 1))
      if (path === '/auth/pkce/code')
        expect(body).toMatchInlineSnapshot(`
          {
            "error": "Request body is too large.",
          }
        `)
      else
        expect(body).toMatchInlineSnapshot(`
          {
            "error": "invalid_request",
            "error_description": "Request body is too large.",
          }
        `)

      const health = await fetch(`${server.url}/health`)
      expect([health.status, await health.text()]).toMatchInlineSnapshot(`
      [
        200,
        "ok",
      ]
    `)
    } finally {
      socket.destroy()
      await server.closeAsync()
    }
  },
)
