#!/usr/bin/env node
/**
 * A CLI that signs in with Tempo ID's device grant, and sends OUSD with the access key of the
 * sign-in. It sends `cli:acme-example` as its client ID, so it needs no registration, and its
 * session saves with no `store` to the file that every CLI of the user shares,
 * `~/.tempo/id/store.json`, which only the user can read.
 *
 * ```sh
 * node --import tsx index.ts login
 * node --import tsx index.ts whoami
 * node --import tsx index.ts send 0x000000000000000000000000000000000000dEaD 0.01
 * node --import tsx index.ts logout
 * ```
 * @module
 */
import { Accounts } from 'accounts'
import { device, viem } from 'accounts/plugins'

/** The instance, on Tempo testnet. An unregistered CLI's access key names its limits and scopes. */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '7d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  clientId: 'cli:acme-example',
  plugins: [
    device({
      onCode: (code) =>
        console.log(
          `Open ${code.verificationUriComplete} and confirm the code ${code.userCode}.`,
        ),
    }),
    viem(),
  ],
})

const [command, ...args] = process.argv.slice(2)
const session = await accounts.session.get()

if (command === 'login') {
  const { user } = await accounts.device.signIn()
  console.log(`Signed in as ${user.email}.`)
} else if (command === 'logout') {
  await accounts.signOut()
  console.log('Signed out.')
} else if (!session?.accessKey) {
  console.log('Not signed in. Run `login`.')
  process.exitCode = 1
} else if (command === 'whoami') {
  console.log(`${session.user.email} ${session.accessKey.account}`)
} else if (command === 'send') {
  const [to, amount] = args as [`0x${string}`, string]
  const { transaction } = await accounts.pay({ amount, to, token: 'ousd' })
  console.log(`Sent in ${transaction}.`)
} else {
  console.log('Commands: login, whoami, send <to> <amount>, logout.')
}
