import { Base64, Bytes, Hash } from 'ox'
import { describe, expect, test, vi } from 'vp/test'
import { Store } from 'wata/host'

import { deviceCode } from './deviceCode.js'

const verifier = 'test-device-code-verifier-0123456789'

function createHandler(options: { store?: Store.Store | undefined } = {}) {
  const validate = vi.fn(() => undefined)
  return {
    handler: deviceCode({
      html: { render: () => new Response('verify') },
      pollingInterval: 1,
      ...(options.store ? { store: options.store } : {}),
      validate,
    }),
    validate,
  }
}

async function register(handler: ReturnType<typeof deviceCode>) {
  const response = await handler.fetch(
    new Request('https://wallet.example.com/auth/device/register', {
      body: JSON.stringify({
        code_challenge: Base64.fromBytes(Hash.sha256(Bytes.fromString(verifier), { as: 'Bytes' }), {
          pad: false,
          url: true,
        }),
        code_challenge_method: 'S256',
        message: {
          payload: [{ id: 1, jsonrpc: '2.0', method: 'wallet_connect', params: [] }],
          type: 'rpc-requests',
        },
        meta: { name: 'Test CLI' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
  return (await response.json()) as { device_code: string; user_code: string }
}

async function verify(
  handler: ReturnType<typeof deviceCode>,
  userCode: string,
  response:
    | { error: { code: number; data?: unknown; message: string }; id: number }
    | {
        id: number
        result: unknown
      },
) {
  return await handler.fetch(
    new Request('https://wallet.example.com/auth/device/verify', {
      body: JSON.stringify({ action: 'approve', results: [response], user_code: userCode }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
}

async function token(handler: ReturnType<typeof deviceCode>, code: string) {
  const response = await handler.fetch(
    new Request('https://wallet.example.com/auth/device/token', {
      body: JSON.stringify({
        code_verifier: verifier,
        device_code: code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
  return { body: await response.json(), status: response.status }
}

describe('deviceCode', () => {
  test('default: validates approved results before relaying them', async () => {
    const { handler, validate } = createHandler()
    const registered = await register(handler)

    const approved = await verify(handler, registered.user_code, { id: 1, result: '0x1' })

    expect(approved.status).toMatchInlineSnapshot(`200`)
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ id: 1, method: 'wallet_connect' }),
        result: '0x1',
        userCode: registered.user_code,
      }),
    )
    await expect(token(handler, registered.device_code)).resolves.toMatchInlineSnapshot(`
      {
        "body": {
          "payload": [
            {
              "id": 1,
              "jsonrpc": "2.0",
              "result": "0x1",
            },
          ],
          "type": "rpc-responses",
        },
        "status": 200,
      }
    `)
  })

  test('behavior: relays submitted RPC errors', async () => {
    const { handler, validate } = createHandler()
    const registered = await register(handler)

    const approved = await verify(handler, registered.user_code, {
      error: { code: 4001, data: { reason: 'cancelled' }, message: 'Request rejected.' },
      id: 1,
    })

    expect(approved.status).toMatchInlineSnapshot(`200`)
    expect(validate).not.toHaveBeenCalled()
    await expect(token(handler, registered.device_code)).resolves.toMatchInlineSnapshot(`
      {
        "body": {
          "payload": [
            {
              "error": {
                "code": 4001,
                "data": {
                  "reason": "cancelled",
                },
                "message": "Request rejected.",
              },
              "id": 1,
              "jsonrpc": "2.0",
            },
          ],
          "type": "rpc-responses",
        },
        "status": 200,
      }
    `)
  })

  test('behavior: keeps polls pending while an approved response is being persisted', async () => {
    const backing = Store.memory()
    const responseWrite = Promise.withResolvers<void>()
    const resumeWrite = Promise.withResolvers<void>()
    const store = Store.from({
      delete: (key: string) => backing.delete(key),
      async get<value = unknown>(key: string) {
        const value = await backing.get<value>(key)
        return value === undefined ? undefined : structuredClone(value)
      },
      async set(key: string, value: unknown, options?: { ttl?: number | undefined }) {
        if (
          key.startsWith('device:') &&
          value !== null &&
          typeof value === 'object' &&
          'response' in value
        ) {
          responseWrite.resolve()
          await resumeWrite.promise
        }
        await backing.set(key, structuredClone(value), options)
      },
    })
    const { handler } = createHandler({ store })
    const registered = await register(handler)

    const verification = verify(handler, registered.user_code, { id: 1, result: '0x1' })
    await responseWrite.promise

    try {
      await expect(
        Promise.all([
          token(handler, registered.device_code),
          token(handler, registered.device_code),
          token(handler, registered.device_code),
        ]),
      ).resolves.toMatchInlineSnapshot(`
        [
          {
            "body": {
              "error": "authorization_pending",
            },
            "status": 400,
          },
          {
            "body": {
              "error": "authorization_pending",
            },
            "status": 400,
          },
          {
            "body": {
              "error": "authorization_pending",
            },
            "status": 400,
          },
        ]
      `)
    } finally {
      resumeWrite.resolve()
    }
    await expect(verification.then((response) => response.status)).resolves.toMatchInlineSnapshot(
      `200`,
    )
    await expect(token(handler, registered.device_code)).resolves.toMatchInlineSnapshot(`
      {
        "body": {
          "payload": [
            {
              "id": 1,
              "jsonrpc": "2.0",
              "result": "0x1",
            },
          ],
          "type": "rpc-responses",
        },
        "status": 200,
      }
    `)
  })
})
