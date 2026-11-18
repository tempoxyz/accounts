/**
 * The oracle of `cli` × `transfer`: the starter's CLI, with a device sign-in and a command that
 * sends a transfer.
 * @module
 */
import { Accounts } from 'accounts'
import { device, viem } from 'accounts/plugins'
import { http, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'

const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '7d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: tempoLocalnet.id,
  clientId: 'cli:acme',
  plugins: [
    device({
      onCode: (code) =>
        console.log(
          `Open ${code.verificationUriComplete} and confirm ${code.userCode}.`,
        ),
    }),
    viem({ chain: tempoLocalnet, transport: http('http://localhost:9545/1') }),
  ],
  url: 'http://localhost:8787',
})

const [command, ...args] = process.argv.slice(2)
if (command === 'login') {
  const { user } = await accounts.device.signIn()
  console.log(`Signed in as ${user.email}.`)
} else {
  const session = await accounts.session.get()
  if (!session?.accessKey) throw new Error('Not signed in.')
  if (command === 'whoami')
    console.log(session.user.email, session.accessKey.account)
  if (command === 'send') {
    const { receipt } = await accounts.token.transferSync({
      amount: parseUnits(args[1]!, 6),
      to: args[0] as `0x${string}`,
      token: Addresses.ousd,
    })
    console.log(receipt.transactionHash)
  }
  if (command === 'pay') {
    const response = await accounts.fetch(args[0]!)
    console.log(await response.text())
  }
}
