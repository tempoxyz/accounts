/** Sends OUSD with the CLI's access key. @module */
import { Cli, z } from 'incur'
import { Value } from 'ox'
import { ousd, accounts } from '../TempoId.ts'

export default Cli.command({
  args: z.object({
    to: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .describe('Recipient address'),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,6})?$/)
      .describe('Amount of OUSD, such as 0.01'),
  }),
  description: 'Send OUSD from your Tempo Account',
  async run(c) {
    if (!(await accounts.session.get())?.key)
      return c.error({
        code: 'SIGNED_OUT',
        message: 'Not signed in. Run `login`.',
      })

    // The client's account is the session's access key.
    const { receipt } = await accounts.token.transferSync({
      amount: Value.from(c.args.amount, 6),
      to: c.args.to as `0x${string}`,
      token: ousd,
    })
    return { status: receipt.status, transactionHash: receipt.transactionHash }
  },
})
