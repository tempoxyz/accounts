#!/usr/bin/env node
/**
 * A CLI that signs in with Tempo ID's device grant, and sends OUSD with the access key of the
 * sign-in. It sends `cli:tempo-example` as its client ID, so it needs no registration. The session
 * saves to a file that only the user can read.
 *
 * ```sh
 * node --import tsx index.ts login
 * node --import tsx index.ts whoami
 * node --import tsx index.ts send 0x000000000000000000000000000000000000dEaD 0.01
 * node --import tsx index.ts logout
 * ```
 * @module
 */
import { Accounts, Store } from 'accounts'
import { device, viem } from 'accounts/plugins'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'

/** The instance, on Tempo testnet. An unregistered CLI's key names its limits and scopes. */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '7d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  clientId: 'cli:tempo-example',
  dev: true,
  plugins: [
    device({
      onCode: (code) =>
        console.log(
          `Open ${code.verificationUriComplete} and confirm the code ${code.userCode}.`,
        ),
    }),
    viem(),
  ],
  store: Store.file('~/.config/tempo-example/session.json'),
  url: process.env.TEMPO_ID_URL ?? 'http://localhost:5173',
})

const [command, ...args] = process.argv.slice(2)
const session = await accounts.session.get()

if (command === 'login') {
  const { user } = await accounts.device.signIn()
  console.log(`Signed in as ${user.email}.`)
} else if (command === 'logout') {
  await accounts.signOut()
  console.log('Signed out.')
} else if (!session?.key) {
  console.log('Not signed in. Run `login`.')
  process.exitCode = 1
} else if (command === 'whoami') {
  console.log(`${session.user.email} ${session.key.account}`)
} else if (command === 'send') {
  const [to, amount] = args as [`0x${string}`, string]
  const { receipt } = await accounts.token.transferSync({
    amount: parseUnits(amount, 6),
    to,
    token: Addresses.ousd,
  })
  console.log(`Sent in ${receipt.transactionHash}.`)
} else {
  console.log('Commands: login, whoami, send <to> <amount>, logout.')
}
