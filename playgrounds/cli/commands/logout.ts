/** Signs out, which revokes the saved refresh token and forgets the session. @module */
import { Cli } from 'incur'
import { accounts } from '../TempoId.ts'

export default Cli.command({
  description: 'Sign out on this machine',
  async run() {
    await accounts.signOut()
    return { signedOut: true }
  },
})
