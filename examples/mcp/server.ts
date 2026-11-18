/**
 * A paid MCP server, in a Worker. An MCP client signs in through Tempo ID for the server's
 * registered resource, and sends the access token with each request. Each paid tool charges its
 * call over MPP, in the JSON-RPC messages of the call, and the client pays with the access key of
 * its sign-in. mppx verifies each credential and broadcasts its transfer, so the server needs no
 * key of its own.
 *
 * An admin of Tempo ID registers the server's resource, whose identifier `RESOURCE` names: the
 * `https` URL of `/mcp` on the deployment. The agent signs in only for the URL that it calls, so it
 * calls the deployment at that URL. `MPP_SECRET_KEY` is a secret of the deployment.
 *
 * | Route                                           | Serves                                                     |
 * | ----------------------------------------------- | ---------------------------------------------------------- |
 * | `GET /.well-known/oauth-protected-resource/mcp` | The protected resource metadata, which names Tempo ID      |
 * | `/mcp`                                          | The MCP server, for a request with a valid access token    |
 *
 * | Tool      | Price                                                    |
 * | --------- | -------------------------------------------------------- |
 * | `whoami`  | Free. Returns the user and the app of the access token   |
 * | `fortune` | 0.01 OUSD                                                |
 * | `report`  | 5 OUSD, above the limit of the agent's access key        |
 * @module
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { type AccessToken, Accounts } from 'accounts'
import { tokens } from 'accounts/plugins'
import { Hono } from 'hono'
import { Transport } from 'mppx/mcp-sdk/server'
import { Mppx, tempo } from 'mppx/server'
import type { Address } from 'viem'
import { Addresses } from 'viem/tempo'

/**
 * The identifier of the server's registered resource, the `https` URL of `/mcp` on the deployment.
 * Each access token that the server accepts names it as `aud`.
 */
const resource = process.env.RESOURCE!

/** The path of the protected resource metadata (RFC 9728 §3.1): the well-known path, then the resource's path. */
const metadataPath = `/.well-known/oauth-protected-resource${new URL(resource).pathname}`

/**
 * The instance of Tempo ID, at `TEMPO_ID_URL` or `https://id.tempo.xyz`. Its `tokens` verify the
 * access token of each request. Any MCP client may call the server, so they accept the token of
 * every app, and only for the resource. The server's origin is its client ID, which needs no
 * registration.
 */
const accounts = Accounts.create({
  clientId: new URL(resource).origin,
  plugins: [tokens({ audience: resource, clientIds: 'any' })],
  url: process.env.TEMPO_ID_URL,
})

/**
 * The charges of the tools, in OUSD on Tempo testnet, over the MCP SDK's messages. Each isolate holds
 * one, and with it the in-memory store of the credentials that it accepted. A deployment with more
 * than one isolate passes a shared atomic `store`, so no credential pays twice.
 */
const mppx = Mppx.create({
  methods: [
    tempo.charge({
      currencies: [Addresses.ousd],
      recipient: process.env.RECIPIENT as Address,
      testnet: true,
    }),
  ],
  // An MCP request carries no URL of its own, so the realm of each challenge is the resource's host.
  realm: new URL(resource).host,
  secretKey: process.env.MPP_SECRET_KEY,
  transport: Transport.mcpSdk(),
})

/** The fortunes, of which each paid call returns one. */
const fortunes = [
  'A small payment opens a large door.',
  'The access key that spends little spends well.',
  'Today a payment required error turns into a result.',
] as const

/** Returns the MCP server of one request, whose tools read the caller's verified `token`. */
function create(token: AccessToken.create.Token) {
  const server = new McpServer({
    name: 'tempo-id-example-mcp',
    version: '1.0.0',
  })

  server.registerTool(
    'whoami',
    { description: 'Returns the user and the app of the access token. Free.' },
    () => text(JSON.stringify({ app: token.clientId, user: token.userId })),
  )

  server.registerTool(
    'fortune',
    { description: 'Returns a fortune. Costs 0.01 OUSD.' },
    async (extra) => {
      const result = await mppx.charge({ amount: '0.01' })(extra)
      // The error carries the challenge, which the client pays, then calls the tool again.
      if (result.status === 402) throw result.challenge

      const index = crypto.getRandomValues(new Uint32Array(1))[0]!
      return result.withReceipt(text(fortunes[index % fortunes.length]!))
    },
  )

  // The charge is above the access key's limit of 1 OUSD, so the agent's access key cannot pay it.
  server.registerTool(
    'report',
    { description: 'Returns the full report. Costs 5 OUSD.' },
    async (extra) => {
      const result = await mppx.charge({ amount: '5' })(extra)
      if (result.status === 402) throw result.challenge

      return result.withReceipt(text('The full report, which costs 5 OUSD.'))
    },
  )

  return server
}

/** Returns a tool result of one text item. */
function text(value: string) {
  return { content: [{ text: value, type: 'text' as const }] }
}

export default new Hono()
  // An MCP client reads the metadata after a 401, and signs in at the authorization server that it
  // names.
  .get(metadataPath, (c) =>
    c.json({
      authorization_servers: [new URL(accounts.config.url).origin],
      bearer_methods_supported: ['header'],
      resource,
      resource_name: 'Tempo ID example MCP server',
      scopes_supported: ['openid', 'email', 'offline_access'],
    }),
  )
  .all('/mcp', async (c) => {
    const token = await accounts.tokens
      .verifyAccessToken(c.req.raw)
      .catch((error: unknown) => {
        // The token can still be valid, so the client keeps its session.
        if (error instanceof Accounts.RequestError && error.status === 0)
          return error
        throw error
      })
    if (token instanceof Accounts.RequestError)
      return c.json({ error: 'temporarily_unavailable' }, 503)
    // The server records no DPoP proof, which can repeat within its window, so it accepts only Bearer
    // tokens.
    // RFC 9728 §5.1: the challenge names the metadata, which names Tempo ID.
    if (!token || token.boundTo)
      return c.json({ error: 'invalid_token' }, 401, {
        'WWW-Authenticate': `Bearer resource_metadata="${new URL(metadataPath, resource)}"`,
      })

    // Each request holds its own server and transport, so the Worker keeps no MCP session.
    const server = create(token)
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })
