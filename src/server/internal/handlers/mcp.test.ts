import { Base64, Bytes, Hash } from 'ox'
import { describe, expect, test } from 'vp/test'

import * as Rpc from '../../../core/zod/rpc.js'
import { compose } from '../../Handler.js'
import { deviceCode } from './deviceCode.js'
import { mcp } from './mcp.js'
import { oauth } from './oauth.js'

const origin = 'https://wallet.example.com'
const secret = 'test-oauth-secret-0123456789abcdef'
const verifier = 'test-oauth-code-verifier-0123456789abcdefghij'
const redirect_uri = 'http://localhost:4567/callback'
const address = '0x1111111111111111111111111111111111111111'

function createApp() {
  const options = {
    deviceCode: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        await app.fetch(new Request(input, init)),
      url: `${origin}/auth/device`,
    },
    secret,
  }
  const pending: { request?: unknown } = {}
  const app = compose([
    deviceCode({
      html: {
        render: ({ record }) => {
          pending.request = (record?.message.payload as readonly unknown[] | undefined)?.[0]
          return new Response('verify')
        },
      },
      validate: () => undefined,
    }),
    oauth({
      ...options,
      chainId: 4217,
      html: {
        render: (options) =>
          Response.json(
            options.status === 'pending'
              ? { refreshUrl: options.refreshUrl, userCode: options.userCode }
              : {},
          ),
      },
    }),
    mcp({ ...options, schemas: { personal_sign: Rpc.personal_sign.schema } }),
  ])
  return { app, pending }
}

async function approve(
  app: ReturnType<typeof createApp>['app'],
  user_code: string,
  result: unknown,
) {
  await app.fetch(
    new Request(`${origin}/auth/device/verify`, {
      body: JSON.stringify({ action: 'approve', results: [{ id: 1, result }], user_code }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
}

async function connect(app: ReturnType<typeof createApp>['app']) {
  const registered = await app.fetch(
    new Request(`${origin}/oauth/register`, {
      body: JSON.stringify({ client_name: 'Codex', redirect_uris: [redirect_uri] }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
  const { client_id } = (await registered.json()) as { client_id: string }
  const url = new URL(`${origin}/oauth/authorize`)
  url.search = new URLSearchParams({
    client_id,
    code_challenge: Base64.fromBytes(Hash.sha256(Bytes.fromString(verifier), { as: 'Bytes' }), {
      pad: false,
      url: true,
    }),
    code_challenge_method: 'S256',
    redirect_uri,
    response_type: 'code',
  }).toString()
  const page = (await (await app.fetch(new Request(url))).json()) as {
    refreshUrl: string
    userCode: string
  }
  await approve(app, page.userCode, { accounts: [{ address, capabilities: {} }] })
  const redirect = await app.fetch(new Request(page.refreshUrl))
  const code = new URL(redirect.headers.get('location')!).searchParams.get('code')!
  const tokens = await app.fetch(
    new Request(`${origin}/oauth/token`, {
      body: new URLSearchParams({
        client_id,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
      method: 'POST',
    }),
  )
  return ((await tokens.json()) as { access_token: string }).access_token
}

async function rpc(
  app: ReturnType<typeof createApp>['app'],
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await app.fetch(
    new Request(`${origin}/mcp`, {
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      method: 'POST',
    }),
  )
  return response
}

async function callTool(
  app: ReturnType<typeof createApp>['app'],
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await rpc(app, token, 'tools/call', { arguments: args, name })
  return ((await response.json()) as { result: { structuredContent: Record<string, unknown> } })
    .result.structuredContent
}

describe('mcp', () => {
  test('default: requires an OAuth bearer and advertises protected-resource metadata', async () => {
    const { app } = createApp()
    const response = await rpc(app, undefined, 'initialize')
    expect({
      authenticate: response.headers.get('www-authenticate'),
      status: response.status,
    }).toMatchInlineSnapshot(`
      {
        "authenticate": "Bearer resource_metadata="https://wallet.example.com/.well-known/oauth-protected-resource/mcp", scope="wallet"",
        "status": 401,
      }
    `)
    const metadata = await app.fetch(
      new Request(`${origin}/.well-known/oauth-protected-resource/mcp`),
    )
    expect(await metadata.json()).toMatchInlineSnapshot(`
      {
        "authorization_servers": [
          "https://wallet.example.com",
        ],
        "bearer_methods_supported": [
          "header",
        ],
        "resource": "https://wallet.example.com/mcp",
        "scopes_supported": [
          "wallet",
        ],
      }
    `)
  })

  test('default: mirrors wallet JSON-RPC methods as tools', async () => {
    const { app } = createApp()
    const token = await connect(app)
    const listed = await rpc(app, token, 'tools/list')
    const { tools } = ((await listed.json()) as { result: { tools: { name: string }[] } }).result
    expect(tools.map((tool) => tool.name)).toMatchInlineSnapshot(`
      [
        "eth_accounts",
        "eth_chainId",
        "eth_sendTransaction",
        "eth_sendTransactionSync",
        "personal_sign",
        "eth_signTypedData_v4",
        "wallet_transfer",
        "wallet_swap",
        "wallet_deposit",
        "wallet_authorizeAccessKey",
        "wallet_updateAccessKey",
        "wallet_revokeAccessKey",
        "wallet_getRequest",
      ]
    `)
    await expect(callTool(app, token, 'eth_accounts')).resolves.toMatchInlineSnapshot(`
      {
        "result": [
          "0x1111111111111111111111111111111111111111",
        ],
      }
    `)
    await expect(callTool(app, token, 'eth_chainId')).resolves.toMatchInlineSnapshot(`
      {
        "result": "0x1079",
      }
    `)
  })

  test('default: routes approval methods through the standalone approval page', async () => {
    const { app, pending } = createApp()
    const token = await connect(app)
    const { request_id, status, user_code, approval_url } = (await callTool(
      app,
      token,
      'personal_sign',
      { params: ['0x68656c6c6f', address] },
    )) as { approval_url: string; request_id: string; status: string; user_code: string }
    expect({ approval_url: approval_url.split('?')[0], status }).toMatchInlineSnapshot(`
      {
        "approval_url": "https://wallet.example.com/auth/device/verify",
        "status": "approval_required",
      }
    `)

    await app.fetch(new Request(approval_url))
    expect(pending.request).toMatchInlineSnapshot(`
      {
        "context": {
          "account": "0x1111111111111111111111111111111111111111",
          "chainId": 4217,
        },
        "id": 1,
        "jsonrpc": "2.0",
        "method": "personal_sign",
        "params": [
          "0x68656c6c6f",
          "0x1111111111111111111111111111111111111111",
        ],
      }
    `)

    const waiting = await callTool(app, token, 'wallet_getRequest', { request_id })
    expect(waiting.status).toMatchInlineSnapshot(`"pending"`)

    await approve(app, user_code, '0xsignature')
    await expect(callTool(app, token, 'wallet_getRequest', { request_id })).resolves
      .toMatchInlineSnapshot(`
      {
        "method": "personal_sign",
        "result": "0xsignature",
        "status": "approved",
      }
    `)
  })

  test('behavior: derives tool inputs from zod schemas and validates params', async () => {
    const { app } = createApp()
    const token = await connect(app)
    const listed = await rpc(app, token, 'tools/list')
    const { tools } = (
      (await listed.json()) as {
        result: { tools: { inputSchema: Record<string, unknown>; name: string }[] }
      }
    ).result
    expect(tools.find((tool) => tool.name === 'personal_sign')?.inputSchema).toMatchInlineSnapshot(`
      {
        "properties": {
          "params": {
            "description": "JSON-RPC params for \`personal_sign\`, identical to the wallet provider interface.",
            "prefixItems": [
              {
                "pattern": "^0x[\\s\\S]{0,}$",
                "type": "string",
              },
              {
                "pattern": "^0x[0-9a-fA-F]{40}$",
                "type": "string",
              },
            ],
            "readOnly": true,
            "type": "array",
          },
        },
        "required": [
          "params",
        ],
        "type": "object",
      }
    `)
    await expect(callTool(app, token, 'personal_sign', { params: ['hello', address] })).resolves
      .toMatchInlineSnapshot(`
      {
        "error": {
          "code": "invalid_params",
          "message": "0: Expected hex value",
        },
      }
    `)
  })

  test('behavior: rejects request IDs from another account', async () => {
    const { app } = createApp()
    const token = await connect(app)
    await expect(callTool(app, token, 'wallet_getRequest', { request_id: 'forged' })).resolves
      .toMatchInlineSnapshot(`
      {
        "error": {
          "code": "unknown_request",
          "message": "Unknown or expired request_id.",
        },
      }
    `)
  })
})
