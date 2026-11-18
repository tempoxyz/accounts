/**
 * The MCP test app: a paid MCP server in Node, as `examples/mcp` serves it. A request without an
 * access token for the server's resource receives 401, whose challenge names the protected resource
 * metadata, which names the suite's Tempo ID. Each paid tool charges its call over MPP, in the
 * messages of the MCP SDK, for the server's payee on the suite's node.
 *
 * The program reads the amount of each tool from `MCP_AMOUNTS`, as the JSON of `Apps.mcp.amounts`,
 * the payee from `MCP_PAYEE`, its resource from `MCP_RESOURCE`, the key that binds each challenge
 * to it from `MCP_SECRET_KEY`, its port from `PORT`, Tempo ID's URL from `TEMPO_ID_URL`, and the
 * node's RPC URL from `TEMPO_RPC_URL`, which `test/Apps.ts` sets.
 *
 * | Route                                           | Effect                                                 |
 * | ----------------------------------------------- | ------------------------------------------------------ |
 * | `/`                                             | Responds with 200, so a run reads that the server listens |
 * | `GET /.well-known/oauth-protected-resource/mcp` | The protected resource metadata                        |
 * | `/mcp`                                          | The MCP server, for a request with a valid access token |
 *
 * | Tool      | Effect                                                         |
 * | --------- | -------------------------------------------------------------- |
 * | `whoami`  | Returns the user and the app of the access token. Free         |
 * | `fortune` | Charges 0.01 OUSD                                              |
 * | `report`  | Charges 5 OUSD, above the limit of 1 OUSD that a spec signs in with |
 *
 * ```sh
 * node --import tsx index.ts
 * ```
 * @module
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { type AccessToken, Accounts } from 'accounts'
import { tokens } from 'accounts/plugins'
import { Hono } from 'hono'
import { Transport } from 'mppx/mcp-sdk/server'
import { Mppx, Request as MppxRequest, Store, tempo } from 'mppx/server'
import * as Http from 'node:http'
import { createClient, http } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

/** The OUSD that each paid tool charges, as decimal strings. */
type Amounts = {
  /** The amount of `fortune`. */
  fortune: string
  /** The amount of `report`. */
  report: string
}

/** The amount of each tool, which the suite's specs read from the same source. */
const amounts: Amounts = JSON.parse(process.env.MCP_AMOUNTS!)

/** The identifier of the server's registered resource, an `https` URI that no request reaches. */
const resource = process.env.MCP_RESOURCE!

/** The path of the protected resource metadata: the well-known path, then the resource's path. */
const metadataPath = `/.well-known/oauth-protected-resource${new URL(resource).pathname}`

/**
 * The instance of the suite's Tempo ID, whose `tokens` verify the access tokens for the resource, of
 * every app. The resource's origin is its client ID, which needs no registration.
 */
const accounts = Accounts.create({
  clientId: new URL(resource).origin,
  plugins: [tokens({ audience: resource, clientIds: 'any' })],
  url: process.env.TEMPO_ID_URL!,
})

/** The node's client, which reads each payment and broadcasts its transaction. */
const client = createClient({
  chain: tempoLocalnet,
  transport: http(process.env.TEMPO_RPC_URL!),
})

/** The charges of the tools, over the messages of the MCP SDK. */
const payment = Mppx.create({
  methods: [
    tempo.charge({
      chainId: tempoLocalnet.id,
      currency: Addresses.ousd,
      getClient: () => client,
      recipient: process.env.MCP_PAYEE! as `0x${string}`,
      // The store records each spent transaction, so a credential pays one call.
      store: Store.memory(),
    }),
  ],
  realm: new URL(resource).host,
  secretKey: process.env.MCP_SECRET_KEY!,
  transport: Transport.mcpSdk(),
})

/** Returns the MCP server of one request, whose tools read the caller's verified `token`. */
function create(token: AccessToken.create.Token) {
  const server = new McpServer({ name: 'accounts-e2e-mcp', version: '1.0.0' })

  server.registerTool(
    'whoami',
    { description: 'Returns the user and the app of the access token.' },
    () => text(JSON.stringify({ app: token.clientId, user: token.userId })),
  )
  server.registerTool(
    'fortune',
    { description: `Returns a fortune for ${amounts.fortune} OUSD.` },
    async (extra) => {
      const result = await payment.charge({ amount: amounts.fortune })(extra)
      if (result.status === 402) throw result.challenge
      return result.withReceipt(text('Your code compiles on the first try.'))
    },
  )
  server.registerTool(
    'report',
    { description: `Returns the report for ${amounts.report} OUSD.` },
    async (extra) => {
      const result = await payment.charge({ amount: amounts.report })(extra)
      if (result.status === 402) throw result.challenge
      return result.withReceipt(text('The full report.'))
    },
  )
  return server
}

/** Returns a tool result of one text item. */
function text(value: string) {
  return { content: [{ text: value, type: 'text' as const }] }
}

const app = new Hono()
  .get('/', (c) => c.text('The MCP server listens.'))
  .get(metadataPath, (c) =>
    c.json({
      authorization_servers: [new URL(accounts.config.url).origin],
      bearer_methods_supported: ['header'],
      resource,
      scopes_supported: ['openid', 'email', 'offline_access'],
    }),
  )
  .all('/mcp', async (c) => {
    const token = await accounts.tokens.verifyAccessToken(c.req.raw)
    // The server records no DPoP proof, which can repeat within its window, so it accepts only Bearer
    // tokens.
    // The resource reaches no host, so the challenge names the metadata at the server's own origin.
    if (!token || token.boundTo)
      return c.json({ error: 'invalid_token' }, 401, {
        'WWW-Authenticate': `Bearer resource_metadata="${new URL(metadataPath, c.req.url)}"`,
      })

    // Each request holds its own server and transport, so the process keeps no MCP session.
    const server = create(token)
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })

Http.createServer(
  MppxRequest.toNodeListener((request) => app.fetch(request)),
).listen(Number(process.env.PORT))
