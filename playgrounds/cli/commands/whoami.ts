/** Prints the signed-in user's email and Tempo Account. @module */
import { Cli } from 'incur'
import { accounts } from '../TempoId.ts'

export default Cli.command({
  description: 'Show who is signed in',
  async run(c) {
    const session = await accounts.session.get()
    if (!session?.key)
      return c.error({
        code: 'SIGNED_OUT',
        message: 'Not signed in. Run `login`.',
      })

    return { account: session.key.account, email: session.user.email }
  },
})
