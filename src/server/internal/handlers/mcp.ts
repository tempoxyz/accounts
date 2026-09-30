import { Hex } from 'ox'
import * as z from 'zod/mini'

import { type Handler, from } from '../../Handler.js'
import * as DeviceCodeClient from '../deviceCodeClient.js'
import * as Sealed from '../sealed.js'
import { type Grant, resolveGrant } from './oauth.js'

/** Wallet JSON-RPC methods exposed as approval-backed MCP tools by default. */
export const approvalMethods = [
  'eth_sendTransaction',
  'eth_sendTransactionSync',
  'personal_sign',
  'eth_signTypedData_v4',
  'wallet_transfer',
  'wallet_swap',
  'wallet_deposit',
  'wallet_authorizeAccessKey',
  'wallet_updateAccessKey',
  'wallet_revokeAccessKey',
] as const

const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26']
const requestTool = 'wallet_getRequest'

type PendingRequest = {
  address: string
  code: string
  method: string
  url: string
  user_code: string
  verifier: string
}

/**
 * Instantiates a Streamable HTTP MCP server that mirrors the wallet JSON-RPC
 * interface. Every tool is named after its JSON-RPC method and accepts the
 * method's `params` array unchanged.
 *
 * - `eth_accounts` and `eth_chainId` answer from the OAuth grant.
 * - Approval methods register the exact JSON-RPC request with the host's
 *   device-code endpoints and return a standalone approval URL. Call
 *   `wallet_getRequest` with the returned `request_id` for the result.
 *
 * Requests require an access token from {@link oauth} with the same `secret`.
 * The server holds no wallet keys; the user approves every action on the
 * approval page.
 *
 * @param options - Options.
 * @returns Request handler.
 */
export function mcp(options: mcp.Options): Handler {
  const {
    baseUrl,
    deviceCode,
    methods = approvalMethods,
    name = 'tempo-wallet',
    path = '/mcp',
    schemas = {},
    secret,
    title = 'Tempo Wallet',
    version = '0.1.0',
    ...rest
  } = options

  const router = from({
    cors: {
      exposeHeaders: 'WWW-Authenticate, Mcp-Session-Id',
      headers: 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
      methods: 'GET, POST, DELETE, OPTIONS',
    },
    ...rest,
  })
  const origin = (request: Request) =>
    typeof baseUrl === 'function' ? baseUrl(request) : (baseUrl ?? new URL(request.url).origin)
  const device = (request: Request) => ({
    ...(deviceCode.fetch ? { fetch: deviceCode.fetch } : {}),
    url: typeof deviceCode.url === 'function' ? deviceCode.url(request) : deviceCode.url,
  })
  const tools = [
    tool('eth_accounts', 'Use to read the connected account address. Free; no approval.'),
    tool('eth_chainId', 'Use to read the chain ID applied to wallet requests. Free; no approval.'),
    ...methods.map((method) =>
      tool(
        method,
        `Use to send a \`${method}\` wallet JSON-RPC request. Pass the method's JSON-RPC params array unchanged as \`params\`. Nothing executes until the user approves on the returned approval page: show \`approval_url\` and \`user_code\` to the user, then call ${requestTool} with \`request_id\`.`,
        schemas[method]?.params ?? null,
      ),
    ),
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        'Use after an approval-backed wallet tool to read its status and JSON-RPC result. Free. Poll with bounded backoff while status is pending; stop on approved, error, rejected, or expired.',
      inputSchema: {
        properties: { request_id: { type: 'string' } },
        required: ['request_id'],
        type: 'object',
      },
      name: requestTool,
      title: 'Get wallet request',
    },
  ]

  router.get('/.well-known/oauth-protected-resource', (c) => c.json(metadata(c.req.raw)))
  router.get(`/.well-known/oauth-protected-resource${path}`, (c) => c.json(metadata(c.req.raw)))

  function metadata(request: Request) {
    const issuer = origin(request)
    return {
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      resource: `${issuer}${path}`,
      scopes_supported: ['wallet'],
    }
  }

  router.on(['GET', 'DELETE'], path, () =>
    Response.json({ error: 'Method not allowed' }, { headers: { allow: 'POST' }, status: 405 }),
  )

  router.post(path, async (c) => {
    const request = c.req.raw
    const grant = await resolveGrant({ request, secret })
    if (!grant)
      return Response.json(
        { error: 'invalid_token', error_description: 'Missing or invalid access token.' },
        {
          headers: {
            'www-authenticate': `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource${path}", scope="wallet"`,
          },
          status: 401,
        },
      )

    const message = (await request.json().catch(() => undefined)) as
      | { id?: string | number | null; method?: string; params?: Record<string, unknown> }
      | undefined
    if (!message || typeof message.method !== 'string' || Array.isArray(message))
      return rpc(null, undefined, { code: -32600, message: 'Invalid request.' })
    const { id, method, params = {} } = message
    if (id === undefined || id === null) return new Response(null, { status: 202 })

    if (method === 'initialize') {
      const requested = params.protocolVersion
      return rpc(id, {
        capabilities: { tools: {} },
        instructions:
          'Tools mirror the Tempo Wallet JSON-RPC interface. Approval-backed tools return an approval URL; show it to the user, then poll wallet_getRequest. Never ask for private keys.',
        protocolVersion:
          typeof requested === 'string' && protocolVersions.includes(requested)
            ? requested
            : protocolVersions[0],
        serverInfo: { name, title, version },
      })
    }
    if (method === 'ping') return rpc(id, {})
    if (method === 'tools/list') return rpc(id, { tools })
    if (method === 'tools/call')
      return rpc(id, await call(request, grant, params.name, params.arguments))
    return rpc(id, undefined, { code: -32601, message: `Method not found: ${method}` })
  })

  async function call(
    request: Request,
    grant: Grant,
    tool_name: unknown,
    args: unknown,
  ): Promise<ToolResult> {
    const input = (args ?? {}) as { params?: unknown; request_id?: unknown }
    if (tool_name === 'eth_accounts') return result({ result: [grant.address] })
    if (tool_name === 'eth_chainId')
      return grant.chainId === undefined
        ? error('chain_unavailable', 'This connection has no configured chain.')
        : result({ result: Hex.fromNumber(grant.chainId) })

    if (tool_name === requestTool) {
      const pending = await Sealed.unseal<PendingRequest>({
        kind: 'mcp-request',
        secret,
        value: typeof input.request_id === 'string' ? input.request_id : '',
      })
      if (!pending || pending.address !== grant.address)
        return error('unknown_request', 'Unknown or expired request_id.')
      const state = await DeviceCodeClient.poll({
        ...device(request),
        deviceCode: pending.code,
        verifier: pending.verifier,
      })
      if (state.status === 'pending')
        return result({
          approval_url: pending.url,
          method: pending.method,
          status: 'pending',
          user_code: pending.user_code,
        })
      return result({ method: pending.method, ...state })
    }

    if (typeof tool_name !== 'string' || !methods.includes(tool_name))
      return error('unknown_tool', `Unknown tool: ${String(tool_name)}`)
    if (input.params !== undefined && !Array.isArray(input.params))
      return error('invalid_params', '`params` must be the JSON-RPC params array.')
    const schema = schemas[tool_name]?.params
    if (schema) {
      const parsed = z.safeParse(schema, input.params ?? [])
      if (!parsed.success)
        return error(
          'invalid_params',
          parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
            .join('; '),
        )
    }

    const registered = await DeviceCodeClient.register({
      ...device(request),
      context: {
        account: grant.address,
        ...(grant.chainId !== undefined ? { chainId: grant.chainId } : {}),
      },
      meta: { name: title },
      method: tool_name,
      params: input.params ?? [],
    })
    const request_id = await Sealed.seal({
      kind: 'mcp-request',
      payload: {
        address: grant.address,
        code: registered.deviceCode,
        method: tool_name,
        url: registered.url,
        user_code: registered.userCode,
        verifier: registered.verifier,
      } satisfies PendingRequest,
      secret,
      ttl: registered.expiresAt - Math.floor(Date.now() / 1000),
    })
    return result({
      approval_url: registered.url,
      expires_at: new Date(registered.expiresAt * 1000).toISOString(),
      method: tool_name,
      request_id,
      status: 'approval_required',
      user_code: registered.userCode,
    })
  }

  return router
}

export declare namespace mcp {
  /** Options for {@link mcp}. */
  export type Options = from.Options & {
    /** Public origin or a request-based resolver. Defaults to the request origin. */
    baseUrl?: string | ((request: Request) => string) | undefined
    /** Device-code endpoints that host the standalone approval page. */
    deviceCode: {
      /** Fetch implementation, for example an in-process dispatcher. */
      fetch?: typeof globalThis.fetch | undefined
      /** Base URL of the device-code endpoints. */
      url: string | ((request: Request) => string)
    }
    /** Approval-backed JSON-RPC methods exposed as tools. @default approvalMethods */
    methods?: readonly string[] | undefined
    /**
     * Zod schemas keyed by method, for example `{ personal_sign: Rpc.personal_sign.schema }`
     * from `accounts`. Their `params` become each tool's JSON Schema input and
     * validate calls before a request is registered. Encoded params are forwarded unchanged.
     */
    schemas?: Partial<Record<string, { params: z.ZodMiniType }>> | undefined
    /** MCP server name. @default "tempo-wallet" */
    name?: string | undefined
    /** MCP endpoint path. @default "/mcp" */
    path?: string | undefined
    /** Secret shared with {@link oauth}. */
    secret: string
    /** Display title, also shown on the approval page. @default "Tempo Wallet" */
    title?: string | undefined
    /** MCP server version. @default "0.1.0" */
    version?: string | undefined
  }
}

type ToolResult = {
  content: { text: string; type: 'text' }[]
  isError?: boolean | undefined
  structuredContent: Record<string, unknown>
}

/**
 * Describes one tool. `params` is `undefined` for free reads, `null` for an
 * approval method without a schema, or the method's Zod params schema.
 */
function tool(name: string, description: string, params?: z.ZodMiniType | null) {
  if (params === undefined)
    return {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description,
      inputSchema: { properties: {}, type: 'object' },
      name,
    }
  const { $schema: _, ...schema } = params
    ? (z.toJSONSchema(params, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>)
    : { items: {}, type: 'array' }
  return {
    annotations: { destructiveHint: false, openWorldHint: true, readOnlyHint: false },
    description,
    inputSchema: {
      properties: {
        params: {
          ...schema,
          description: `JSON-RPC params for \`${name}\`, identical to the wallet provider interface.`,
        },
      },
      ...(params ? { required: ['params'] } : {}),
      type: 'object',
    },
    name,
  }
}

function result(value: Record<string, unknown>): ToolResult {
  return { content: [{ text: JSON.stringify(value), type: 'text' }], structuredContent: value }
}

function error(code: string, message: string): ToolResult {
  return { ...result({ error: { code, message } }), isError: true }
}

function rpc(
  id: string | number | null,
  value: unknown,
  failure?: { code: number; message: string },
) {
  return Response.json(
    failure ? { error: failure, id, jsonrpc: '2.0' } : { id, jsonrpc: '2.0', result: value },
  )
}
