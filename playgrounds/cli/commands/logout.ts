/** Signs out, which revokes the saved refresh token and forgets the session. @module */
import { Cli } from 'incur'
import { tempoId } from '../TempoId.ts'

export default Cli.command({
  description: 'Sign out on this machine',
  async run() {
    await tempoId.signOut()
    return { signedOut: true }
  },
})
