/**
 * The chains page of the web test app, at `/chains/`: an instance that serves two chains, the
 * suite's first node and its second node, and signs in through the dialog. Each "Switch" control
 * selects a chain with `accounts.switchChain`, and returns the chain that the instance then holds.
 * The `viem` plugin takes a function, which returns the chain and the transport of each node.
 *
 * The build reads the second node's RPC URL from `VITE_TEMPO_SECOND_RPC_URL`, which `test/Apps.ts`
 * sets. With `chains` in the page's query, the instance serves only the chains of those IDs, as a
 * list with commas. Without it, the instance serves its default chains, which hold both nodes'.
 * @module
 */
import { Accounts } from 'accounts'
import { dialog, viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { http } from 'viem'
import { tempoDevnet, tempoLocalnet } from 'viem/tempo/chains'
import * as App from '../App.js'

/** Creates the page's instance, and renders the page. */
export async function start() {
  const chains = App.query.get('chains')
  const accounts = Accounts.create({
    ...(await App.options()),
    ...(chains ? { chains: chains.split(',').map(Number) } : {}),
    plugins: [
      dialog(),
      react(),
      viem((chainId) =>
        chainId === tempoDevnet.id
          ? {
              chain: tempoDevnet,
              transport: http(import.meta.env.VITE_TEMPO_SECOND_RPC_URL),
            }
          : {
              chain: tempoLocalnet,
              transport: http(import.meta.env.VITE_TEMPO_RPC_URL),
            },
      ),
    ],
  })

  /** Selects the chain of `chainId`, and returns the chain that the instance then holds. */
  const select = async (chainId: number) => {
    await accounts.switchChain({ chainId })
    return { chainId: accounts.chain.get() }
  }

  App.mount(accounts, {
    actions: {
      'Sign in': async () => App.describe(await accounts.dialog.signIn()),
      // Chain 1 is no chain of Tempo, so no instance serves it.
      'Switch to chain 1': () => select(1),
      'Switch to the first chain': () => select(tempoLocalnet.id),
      'Switch to the second chain': () => select(tempoDevnet.id),
    },
  })
}
