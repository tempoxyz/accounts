/** Funds the Tempo Account from the testnet faucet. @module */
import { Cli } from 'incur'
import { accounts } from '../TempoId.ts'

export default Cli.command({
  description: 'Fund your Tempo Account with testnet tokens',
  async run(c) {
    const session = await accounts.session.get()
    if (!session?.key)
      return c.error({
        code: 'SIGNED_OUT',
        message: 'Not signed in. Run `login`.',
      })

    await accounts.faucet.fundSync({ account: session.key.account })
    return { account: session.key.account, funded: true }
  },
})
