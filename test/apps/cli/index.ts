#!/usr/bin/env node
/**
 * The CLI test app: a program without a browser, which signs in with Tempo ID's device grant, keeps
 * its session in a file, and sends OUSD with the access key of the sign-in. It sends a `cli:` client
 * ID, so Tempo ID holds no registration of it, and its instance receives no `store`. The session
 * saves to the file that every CLI of the user shares. Each command runs one action of the
 * instance, and ends its output with one line of JSON: what the action returned or threw, as the
 * pages of the other test apps show it. A command that throws exits with code 1.
 *
 * The program reads its client ID from `CLIENT_ID`, Tempo ID's URL from `TEMPO_ID_URL`, and the
 * node's RPC URL from `TEMPO_RPC_URL`, which `test/Cli.ts` sets. The instance reads the folder of
 * its session file, `id/store.json`, from `TEMPO_HOME`, which `test/Cli.ts` sets to the folder of
 * the test.
 *
 * | Command              | Effect                                                                     |
 * | -------------------- | -------------------------------------------------------------------------- |
 * | `authorize`          | Starts a grant for an access key of its own, and saves the device code     |
 * | `login`              | Signs in with `device.signIn`, and saves the session                       |
 * | `logout`             | Signs out                                                                  |
 * | `mcp <url> <tool>`   | Calls a tool of an MCP server, and pays its charge with the access key     |
 * | `pay <url>`          | Pays the charge of an MPP endpoint with the session's access key           |
 * | `poll [to amount]`   | Sends one poll of the saved device code, then a transfer with its key      |
 * | `proof`              | Prints the session's access token and key authorization, for a verifier    |
 * | `refresh`            | Refreshes the session's tokens                                             |
 * | `send <to> <amount>` | Sends OUSD with the session's access key                                   |
 * | `whoami`             | Prints the session                                                         |
 *
 * | Flag               | Effect                                                                       |
 * | ------------------ | ---------------------------------------------------------------------------- |
 * | `--challenge`      | A message that the sign-in signs                                             |
 * | `--expiry`         | The expiry of each access key, such as `15s`. Defaults to `1d`               |
 * | `--funding`        | The amount that the sign-in needs in the account, as JSON                    |
 * | `--limit`          | The OUSD that each access key may send. Defaults to `100`                    |
 * | `--max`            | The most that a charge of `mcp` or `pay` may cost, in OUSD. Defaults to none |
 * | `--no-access-key`  | The sign-in requests no access key                                           |
 * | `--polls`          | Prints a line for each poll of the sign-in                                   |
 * | `--resource`       | The registered resource that the sign-in's tokens are for                    |
 * | `--sign-out`       | Signs out at the first line of the input, while the sign-in waits            |
 *
 * ```sh
 * node --import tsx index.ts login
 * node --import tsx index.ts send 0x000000000000000000000000000000000000dEaD 0.01
 * ```
 * @module
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Accounts, type Permissions, type Session } from 'accounts'
import { Funding } from 'accounts/internal'
import { mpp } from 'accounts/mpp'
import { device, viem } from 'accounts/plugins'
import { Receipt } from 'mppx'
import * as Fs from 'node:fs/promises'
import * as Path from 'node:path'
import * as Readline from 'node:readline'
import { parseArgs } from 'node:util'
import { createClient, http, parseUnits } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Account, Actions, Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

/** What a command reads: the instance, the arguments after the command's name, and the flags. */
type Context = {
  /** The program's instance. */
  accounts: ReturnType<typeof create>
  /** The arguments after the command's name. */
  args: readonly string[]
  /** The flags, by name. */
  flags: Flags
}

/** The flags of the program, by name. */
type Flags = ReturnType<typeof parse>['values']

/** A grant that `authorize` started, as its file holds it until `poll` redeems it. */
type Grant = {
  /** The device code that `poll` sends. */
  deviceCode: string
  /** The private key of the program's own access key, which the grant requests. */
  privateKey: `0x${string}`
}

/** The path of the file that holds the grant of `authorize`, in the folder of the test. */
const grantFile = Path.join(process.env.TEMPO_HOME!, 'grant.json')

/** The node's RPC URL. */
const rpcUrl = process.env.TEMPO_RPC_URL!

/** The commands of the program, by name. Each one returns what the program prints as its result. */
const commands = {
  async authorize(context) {
    const { accounts, flags } = context
    const privateKey = generatePrivateKey()

    const grant = await accounts.device.authorize({
      accessKey: {
        ...permissions(flags),
        account: Account.fromSecp256k1(privateKey),
      },
      device: 'accounts-e2e',
      ...funding(flags),
    })
    // The device code redeems the grant, so only the user reads its file, as the session's.
    await Fs.writeFile(
      grantFile,
      JSON.stringify({
        deviceCode: grant.deviceCode,
        privateKey,
      } satisfies Grant),
      { mode: 0o600 },
    )

    prompt(grant)
    return { expiresIn: grant.expiresIn, interval: grant.interval }
  },
  async login(context) {
    const { accounts, flags } = context
    const request = {
      ...(flags['no-access-key'] ? { accessKey: false as const } : {}),
      ...(flags.challenge === undefined ? {} : { challenge: flags.challenge }),
      ...funding(flags),
    }
    if (!flags['sign-out'])
      return describe(await accounts.device.signIn(request))

    const lines = Readline.createInterface({ input: process.stdin })
    const signedOut = new Promise<void>((resolve, reject) =>
      lines.once('line', () => {
        // The promise settles through `resolve` and `reject`, which the `finally` below awaits.
        void accounts.signOut().then(resolve, reject)
      }),
    )
    try {
      return describe(await accounts.device.signIn(request))
    } finally {
      await signedOut
      // The program sets an exit code, and calls no `process.exit`. Node then ends the process once
      // no timer and no request remains, so a sign-in that polls after the sign-out holds it open.
      lines.close()
    }
  },
  async logout(context) {
    await context.accounts.signOut()
    return null
  },
  async mcp(context) {
    const { accounts, args, flags } = context
    const [url, name] = args as [string, string]
    // A new process reads its session from the file first, and the access key pays only with one.
    await signedIn(accounts)

    // Each request of the client carries the session's access token.
    const client = new Client({ name: 'accounts-e2e-cli', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        fetch: (input, init) => accounts.session.fetch({ init, url: input }),
      }),
    )
    try {
      const result = await accounts
        .mpp(flags.max === undefined ? {} : { maxAmount: flags.max })
        .mcp(client)
        .callTool({ arguments: {}, name })
      const content = (result.content as { text?: string }[]).map(
        (item) => item.text,
      )
      // A tool that fails, or that the server does not hold, returns a result with `isError`.
      if (result.isError) throw new Error(content.join('\n'))
      return { content, receipt: result.receipt ?? null }
    } finally {
      await client.close()
    }
  },
  async pay(context) {
    const { accounts, args, flags } = context
    const [url] = args as [string]
    // A new process reads its session from the file first, and the payer signs only with one.
    await signedIn(accounts)

    const response = await accounts
      .mpp(flags.max === undefined ? {} : { maxAmount: flags.max })
      .fetch(url)
    return {
      body: await response.json(),
      receipt: response.headers.has('payment-receipt')
        ? Receipt.fromResponse(response)
        : null,
      status: response.status,
    }
  },
  async poll(context) {
    const { accounts, args } = context
    const [to, amount] = args as [`0x${string}` | undefined, string | undefined]
    const grant = JSON.parse(await Fs.readFile(grantFile, 'utf8')) as Grant

    const result = await accounts.device.poll({
      accessKey: { account: Account.fromSecp256k1(grant.privateKey) },
      deviceCode: grant.deviceCode,
    })
    if (result.status === 'pending') return result

    const { authorization } = result
    // The poll sets no session, so the transfer signs with the authorization's own account.
    const client = createClient({
      account: authorization.signer,
      chain: tempoLocalnet,
      transport: http(rpcUrl),
    })
    const transfer =
      to && amount
        ? await Actions.token.transferSync(client, {
            amount: parseUnits(amount, 6),
            to,
            token: Addresses.ousd,
          })
        : undefined
    return {
      email: authorization.user.email,
      key: {
        account: authorization.accessKey.account,
        id: authorization.accessKey.keyAuthorization.keyId,
      },
      session: await describe(await accounts.session.get()),
      status: result.status,
      transfer: transfer
        ? {
            status: transfer.receipt.status,
            transactionHash: transfer.receipt.transactionHash,
          }
        : null,
    }
  },
  // The output holds the access token, so a spec shows none of it.
  async proof(context) {
    const session = await signedIn(context.accounts)
    return {
      accessToken: session.accessToken,
      keyAuthorization: session.accessKey?.keyAuthorization ?? null,
    }
  },
  async refresh(context) {
    return describe(await context.accounts.session.refresh())
  },
  async send(context) {
    const { accounts, args } = context
    const [to, amount] = args as [`0x${string}`, string]
    // A new process reads its session from the file first, and the client sends only with one.
    await signedIn(accounts)

    const { receipt } = await accounts.token.transferSync({
      amount: parseUnits(amount, 6),
      to,
      token: Addresses.ousd,
    })
    return { status: receipt.status, transactionHash: receipt.transactionHash }
  },
  async whoami(context) {
    return describe(await signedIn(context.accounts))
  },
} satisfies Record<string, (context: Context) => Promise<unknown>>

/**
 * Returns the program's instance, on the suite's node. Each sign-in requests an access key that
 * sends up to the limit of `flags` in OUSD, since the access key of an app without a registration
 * names its limits.
 */
function create(flags: Flags) {
  let polls = 0
  return Accounts.create({
    accessKey: () => permissions(flags),
    chain: tempoLocalnet.id,
    clientId: process.env.CLIENT_ID!,
    ...(flags.resource === undefined ? {} : { resource: flags.resource }),
    ...(flags.polls
      ? {
          fetch: ((input, init) => {
            if (new Request(input).url.endsWith('/oauth2/token'))
              console.log(`Poll ${++polls}.`)
            return fetch(input, init)
          }) satisfies typeof fetch,
        }
      : {}),
    plugins: [
      device({ onCode: prompt }),
      viem({ chain: tempoLocalnet, transport: http(rpcUrl) }),
      // The `mpp` plugin reads the chain and the transport of the `viem` plugin before it.
      mpp(),
    ],
    url: process.env.TEMPO_ID_URL!,
  })
}

/**
 * Returns what a spec reads of `session`: its user, its expiry, and its access key. Each token shows
 * as the first bytes of its SHA-256 hash, so a spec compares tokens, and the proof holds none.
 */
async function describe(session: Session.Session | undefined) {
  if (!session) return null
  const [accessToken, refreshToken] = await Promise.all([
    fingerprint(session.accessToken),
    session.refreshToken ? fingerprint(session.refreshToken) : null,
  ])
  return {
    accessToken,
    address: session.address ?? null,
    challengeSignature: session.challengeSignature ?? null,
    email: session.user.email,
    expiresAt: session.expiresAt,
    key: session.accessKey
      ? {
          account: session.accessKey.account,
          chainId: session.accessKey.chainId,
          expiry:
            Number(session.accessKey.keyAuthorization.expiry ?? 0) || null,
          id: session.accessKey.keyAuthorization.keyId,
        }
      : null,
    refreshToken,
  }
}

/** Returns the fields of `error` that a spec asserts: its name and message, and a refusal's fields. */
function failure(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error), name: null }
  const refusal = error as Error & {
    code?: string | undefined
    reason?: string | undefined
    status?: number | undefined
  }
  return {
    code: refusal.code ?? null,
    message: error.message,
    name: error.name,
    reason: refusal.reason ?? null,
    status: refusal.status ?? null,
  }
}

/** Returns the first 8 bytes of the SHA-256 hash of `value`, as hex. */
async function fingerprint(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(hash).subarray(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Returns the funding hint of `flags`: the amount that the program needs in the Tempo Account. */
function funding(flags: Flags) {
  return flags.funding
    ? { funding: Funding.from(JSON.parse(flags.funding)) }
    : {}
}

/** Returns the command's name, its arguments, and the flags of the program's arguments. */
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      challenge: { type: 'string' },
      expiry: { default: '1d', type: 'string' },
      funding: { type: 'string' },
      limit: { default: '100', type: 'string' },
      max: { type: 'string' },
      'no-access-key': { type: 'boolean' },
      polls: { type: 'boolean' },
      resource: { type: 'string' },
      'sign-out': { type: 'boolean' },
    },
  })
}

/** Returns the permissions of an access key that sends up to the limit of `flags` until its expiry. */
function permissions(flags: Flags): Permissions.Permissions {
  return {
    expiry: flags.expiry as Permissions.Duration,
    limits: [{ limit: flags.limit as `${number}`, token: 'ousd' }],
  }
}

/** Prints the page that approves a grant's code, and the code. */
function prompt(code: device.Code) {
  console.log(
    `Open ${code.verificationUriComplete} and confirm the code ${code.userCode}.`,
  )
}

/** Returns the session of `accounts`. Throws without one, with the command that signs in. */
async function signedIn(accounts: Context['accounts']) {
  const session = await accounts.session.get()
  if (!session) throw new Error('Not signed in. Run `login`.')
  return session
}

const { positionals, values: flags } = parse()
const [name, ...args] = positionals
const command = commands[name as keyof typeof commands] as
  | ((context: Context) => Promise<unknown>)
  | undefined

try {
  if (!command)
    throw new Error(
      `Unknown command. Run one of: ${Object.keys(commands).join(', ')}.`,
    )
  const value = await command({ accounts: create(flags), args, flags })
  console.log(JSON.stringify({ state: 'fulfilled', value }))
} catch (error) {
  console.log(JSON.stringify({ state: 'rejected', value: failure(error) }))
  process.exitCode = 1
}
