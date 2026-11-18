#!/usr/bin/env node
/**
 * An agent that signs in once through Tempo ID for a paid MCP server, then calls its tools with no
 * other approval. It reads the server's protected resource metadata, and signs in with the device
 * grant for the server's resource, with an access key that may spend 1 OUSD a day. The access token
 * authenticates each MCP request, and the access key pays each charge of a tool, until its limit.
 * It sends `cli:mcp-example` as its client ID, so it needs no registration, and its session saves to
 * `~/.tempo/id/store.json`, which only the user can read.
 *
 * ```sh
 * export MCP_URL=https://mcp.example.com/mcp
 * node --import tsx agent.ts login
 * node --import tsx agent.ts tools
 * node --import tsx agent.ts call whoami
 * node --import tsx agent.ts call fortune
 * node --import tsx agent.ts call report
 * node --import tsx agent.ts logout
 * ```
 * @module
 */
import { discoverOAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { device } from 'accounts/plugins'

/** The URL of the MCP server. */
const url = new URL(process.env.MCP_URL ?? 'https://mcp.example.com/mcp')

/** Tempo ID's origin, the only authorization server where the agent signs in. */
const tempoId = new URL(process.env.TEMPO_ID_URL ?? 'https://id.tempo.xyz')
  .origin

/**
 * The most that the agent pays for one call, in OUSD. It covers `report`, so the access key's limit
 * refuses that one.
 */
const maxAmount = '5'

/**
 * Returns the server's resource, from its protected resource metadata (RFC 9728). A token for
 * another resource reaches another API, so the agent requests a token only for the server that it
 * calls (RFC 9728 §3.3), and only from Tempo ID.
 */
async function discover() {
  const metadata = await discoverOAuthProtectedResourceMetadata(url)
  if (metadata.resource !== url.href)
    throw new Error(
      `The server names the resource ${metadata.resource}, not its own URL ${url.href}.`,
    )
  if (!metadata.authorization_servers?.includes(tempoId))
    throw new Error(`The server names no authorization server at ${tempoId}.`)
  return metadata.resource
}

/**
 * The instance, on Tempo testnet. Each sign-in requests an access key that spends up to 1 OUSD for
 * a day. The instance names no resource, so `logout` needs no answer from the server.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'ousd' }],
  }),
  chain: 'testnet',
  clientId: 'cli:mcp-example',
  plugins: [
    device({
      onCode: (code) =>
        console.log(
          `Open ${code.verificationUriComplete} and confirm the code ${code.userCode}.`,
        ),
    }),
    mpp(),
  ],
  url: tempoId,
})

/**
 * Returns an MCP client of the server. Each request carries the session's access token, which the
 * call refreshes before it expires.
 */
async function connect() {
  // The agent sends the access token only to a server that still names Tempo ID and its own URL.
  const resource = await discover()
  // The store keeps one session for every server, so the agent sends the access token only to the
  // server whose resource it names. The token is the session's own, so its claims need no proof.
  const { accessToken } = (await accounts.session.get())!
  const { aud } = JSON.parse(
    Buffer.from(accessToken.split('.')[1]!, 'base64url').toString(),
  ) as { aud: string | string[] }
  if (![aud].flat().includes(resource))
    throw new Error(
      `The session is for another server than ${resource}. Run \`logout\`, then \`login\`.`,
    )

  const client = new Client({ name: 'tempo-id-mcp-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      fetch: (input, init) => accounts.session.fetch({ init, url: input }),
    }),
  )
  return client
}

const [command, ...args] = process.argv.slice(2)
const session = await accounts.session.get()

if (command === 'login') {
  // The sign-in names the server's resource, so each access token is for the server alone.
  const { user } = await accounts.device.signIn({ resource: await discover() })
  console.log(`Signed in as ${user.email}.`)
} else if (command === 'logout') {
  await accounts.signOut()
  console.log('Signed out.')
} else if (!session?.accessKey) {
  console.log('Not signed in. Run `login`.')
  process.exitCode = 1
} else if (command === 'tools') {
  const client = await connect()
  const { tools } = await client.listTools()
  for (const tool of tools) console.log(`${tool.name}: ${tool.description}`)
  await client.close()
} else if (command === 'call') {
  const [name] = args as [string]
  const client = await connect()
  try {
    // The session's access key pays each charge, up to `maxAmount` and the access key's limit.
    const result = await accounts
      .mpp({ maxAmount })
      .mcp(client)
      .callTool({ arguments: {}, name })
    for (const item of result.content as { text?: string }[])
      if (item.text) console.log(item.text)
    if (result.receipt) console.log(`Paid in ${result.receipt.reference}.`)
    // A tool that fails, or that the server does not hold, returns a result with `isError`.
    if (result.isError) process.exitCode = 1
  } catch (error) {
    // A charge above the access key's limit fails before the access key signs, so it pays nothing.
    console.log(`The call failed: ${(error as Error).message}`)
    process.exitCode = 1
  } finally {
    await client.close()
  }
} else {
  console.log('Commands: login, tools, call <tool>, logout.')
}
