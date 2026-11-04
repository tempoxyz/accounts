/** Signs in through the device grant, and saves the new access key. @module */
import { Permissions } from 'accounts'
import { Cli, z } from 'incur'
import { Json, Value } from 'ox'
import { Expiry, Scopes } from 'viem/tempo'
import { tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import * as Defaults from '../Defaults.ts'
import { ousd, accounts } from '../TempoId.ts'

export default Cli.command({
  description: 'Sign in by approving a code in any browser',
  options: z.object({
    expiry: z
      .string()
      .regex(/^\d+[smhdw]?$/)
      .optional()
      .describe(
        'How long the key lasts, such as 30m, 12h, 7d, or 2w, or a Unix time',
      ),
    funding: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional()
      .describe(
        'The amount that the account needs, such as 10. After the approval, an account that holds less opens the funding page',
      ),
    fundingCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .describe('The currency of --funding, such as EUR. Defaults to USD'),
    fundingToken: z
      .string()
      .optional()
      .describe('The only token that counts toward --funding, such as pathUSD'),
    limit: z
      .array(
        z
          .string()
          .regex(
            /^\d+(\.\d+)?:[^:,/]+(\/\d+[smhdw]?)?(,\d+(\.\d+)?:[^:,/]+(\/\d+[smhdw]?)?)*$/,
          ),
      )
      .optional()
      .describe(
        'Spending limits, such as 100:OUSD, 100:OUSD/1d to reset daily, or 100:OUSD,50:EURC.e. Repeat or comma-separate for more',
      ),
    scope: z
      .array(z.string().regex(/^\w+:[^:,]+(,\w+:[^:,]+)*$/))
      .optional()
      .describe(
        'Token calls the key may make, such as transfer:OUSD,approve:OUSD. Repeat or comma-separate for more',
      ),
  }),
  async *run(c) {
    // The approval page shows the key's limits beside the machine's hostname. `PERMISSIONS` is ox's `Json`, which encodes
    // bigints. Flags replace the fields they set.
    const base = Permissions.from(Json.parse(process.env.PERMISSIONS ?? '{}'))
    const { chainId } = accounts.config
    // `fund` and `send` use the instance's chain, so a key for another chain could not send.
    if (base.chainId !== undefined && base.chainId !== chainId)
      return c.error({
        code: 'CHAIN_MISMATCH',
        message: `PERMISSIONS names chain ${base.chainId}, but the CLI sends on chain ${chainId}. Remove chainId, or set it to ${chainId}.`,
      })
    // A new sign-in replaces the saved one, whose refresh token the sign-out revokes.
    if (await accounts.session.get()) await accounts.signOut()
    // `onCode` prints the link and the code. The CLI fills what the flags and `PERMISSIONS` leave
    // out, the expiry too, which Tempo ID otherwise fills.
    const session = await accounts.device
      .signIn({
        accessKey: Defaults.fill({
          ...base,
          ...(c.options.expiry ? { expiry: expiry(c.options.expiry) } : {}),
          ...(c.options.limit
            ? {
                limits: c.options.limit.flatMap(list).map((value) => {
                  const [amount, rest] = value.split(':') as [string, string]
                  const [symbol, period] = rest.split('/') as [string, string?]
                  const listing = token(symbol)
                  return {
                    limit: Value.from(amount, listing.decimals),
                    ...(period ? { period: seconds(period) } : {}),
                    token: listing.address,
                  }
                }),
              }
            : {}),
          ...(c.options.scope
            ? {
                scopes: c.options.scope.flatMap(list).map((value) => {
                  const [method, symbol] = value.split(':') as [string, string]
                  const calls = Scopes.tip20(token(symbol).address) as Record<
                    string,
                    unknown
                  >
                  const scope = calls[method]
                  if (typeof scope !== 'function')
                    throw new Error(`Unknown TIP-20 call: ${method}.`)
                  return scope() as Exclude<
                    Permissions.Permissions['scopes'],
                    'any' | undefined
                  >[number]
                }),
              }
            : {}),
        }),
        funding: c.options.funding
          ? {
              amount: c.options.funding,
              currency: c.options.fundingCurrency,
              token: c.options.fundingToken,
            }
          : undefined,
      })
      .catch((error: Error) => error)
    if (session instanceof Error)
      return c.error({ code: 'DENIED', message: session.message })

    // A streaming command prints what it yields, not what it returns.
    yield `Signed in as ${session.user.email}.`
    return c.ok({ email: session.user.email })
  },
})

/** A flag's comma-separated entries. */
function list(value: string) {
  return value.split(',')
}

/** A key's expiry from a duration such as `7d`, or a Unix time. */
function expiry(value: string) {
  return /\d$/.test(value) ? Number(value) : Expiry.seconds(seconds(value))
}

/** A duration such as `7d` in seconds. A bare number is seconds. */
function seconds(value: string) {
  const amount = Number.parseInt(value)
  if (value.endsWith('m')) return amount * 60
  if (value.endsWith('h')) return amount * 3_600
  if (value.endsWith('d')) return amount * 86_400
  if (value.endsWith('w')) return amount * 604_800
  return amount
}

/** A Tempo token on the instance's chain, by symbol or address. */
function token(value: string) {
  if (/^0x[0-9a-fA-F]{40}$/.test(value))
    return { address: value as `0x${string}`, decimals: 6 }

  const listing = Tokens.tokens.tempo.find(
    (token) => token.symbol?.toLowerCase() === value.toLowerCase(),
  )
  if (!listing) throw new Error(`Unknown Tempo token: ${value}.`)

  const addresses = listing.addresses as Record<number, `0x${string}`>
  // A local node predeploys the testnet's tokens, and OUSD has its mainnet address everywhere.
  const address =
    addresses[accounts.config.chainId] ??
    (accounts.config.chainId === tempoLocalnet.id
      ? addresses[tempoTestnet.id]
      : undefined) ??
    (listing.symbol === 'OUSD' ? ousd : undefined)
  if (!address)
    throw new Error(
      `${listing.symbol} is not on chain ${accounts.config.chainId}.`,
    )
  return { address, decimals: listing.decimals }
}
