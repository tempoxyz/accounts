import { Cli, z } from 'incur'
import { Hex } from 'ox'
import { parseUnits } from 'viem'
import { Actions } from 'viem/tempo'

import { Provider } from '../../src/cli/index.js'

const provider = Provider.create({ testnet: true })

Cli.create('cli-example', {
  description: 'Minimal CLI example for Tempo Accounts',
  args: z.object({
    to: z.string().describe('Recipient address'),
    amount: z.string().default('1').describe('Amount to transfer'),
  }),
  options: z.object({
    token: z
      .string()
      .default('0x20c0000000000000000000000000000000000001')
      .describe('TIP-20 token address'),
    expiry: z.coerce.number().default(3600).describe('Access key expiry in seconds'),
    limit: z.coerce.number().default(1000).describe('Spending limit'),
  }),
  async run(c) {
    // 1. Connect wallet and authorize an access key with limits + expiry.
    const connectResult = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: {
              expiry: Math.floor(Date.now() / 1000) + c.options.expiry,
              limits: [
                {
                  limit: Hex.fromNumber(c.options.limit),
                  token: c.options.token as `0x${string}`,
                },
              ],
            },
          },
        },
      ],
    })

    const address = connectResult.accounts[0]!.address

    // 2. Use the Viem client to do a TIP-20 transfer.
    const client = provider.getClient()
    const account = provider.getAccount()
    const { receipt } = await Actions.token.transferSync(client, {
      account,
      amount: parseUnits(c.args.amount, 6),
      to: c.args.to as `0x${string}`,
      token: c.options.token as `0x${string}`,
    })

    return {
      from: address,
      to: c.args.to,
      amount: c.args.amount,
      hash: receipt.transactionHash,
    }
  },
}).serve()
