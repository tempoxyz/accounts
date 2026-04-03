import { Cli, z } from 'incur'
import { Hex } from 'ox'
import { parseUnits } from 'viem'
import { connect } from 'viem/experimental/erc7846'
import { Actions } from 'viem/tempo'

import { Provider } from '../../src/cli/index.js'

const provider = Provider.create({ testnet: true })

Cli.create('cli-example', {
  description: 'Minimal CLI example for Tempo Accounts',
  args: z.object({
    to: z.templateLiteral(['0x', z.string()]).describe('Recipient address'),
    amount: z.string().default('1').describe('Amount to transfer'),
  }),
  options: z.object({
    token: z
      .templateLiteral(['0x', z.string()])
      .default('0x20c0000000000000000000000000000000000001')
      .describe('TIP-20 token address'),
    expiry: z.coerce.number().default(3600).describe('Access key expiry in seconds'),
    limit: z.coerce.number().default(10_000_000).describe('Spending limit (in token units)'),
  }),
  async run(c) {
    const client = provider.getClient()

    // 1. Connect wallet and authorize an access key with limits + expiry.
    await connect(client, {
      capabilities: {
        authorizeAccessKey: {
          expiry: Math.floor(Date.now() / 1000) + c.options.expiry,
          limits: [
            {
              limit: Hex.fromNumber(c.options.limit),
              token: c.options.token,
            },
          ],
        },
      },
    })

    // 2. Perform a TIP-20 transfer.
    const account = provider.getAccount()
    const { receipt } = await Actions.token.transferSync(client, {
      account,
      amount: parseUnits(c.args.amount, 6),
      to: c.args.to,
      token: c.options.token,
    })

    return receipt
  },
}).serve()
