/**
 * The wagmi page of the web test app, at `/wagmi/`: a wagmi app whose wallet is Tempo ID. Each
 * control runs one hook of wagmi, and shows its outcome as the other pages do. "Connect" signs in
 * through the dialog, the "Send OUSD" form sends a transfer with the hook of `wagmi/tempo`, and
 * "Disconnect" signs out. "Sign out of the instance" signs out with the instance's own action, with
 * no call to wagmi.
 *
 * The config holds the `tempoId` connector, which creates its own instance. With `plugin=1` in the
 * page's query, the config is `accounts.wagmi` of the page's own instance, which the `wagmi` plugin
 * adds. With `second=1`, the config of the connector also holds the chain of the suite's second node,
 * "Switch to the second chain" selects it with wagmi's `useSwitchChain`, and the page shows the
 * chain of wagmi's `useChainId`.
 * @module
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { tempoId, wagmi } from 'accounts/wagmi'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { http, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoDevnet, tempoLocalnet } from 'viem/tempo/chains'
import {
  createConfig,
  useChainId,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
  WagmiProvider,
} from 'wagmi'
import { Hooks } from 'wagmi/tempo'
import * as App from '../App.js'

/** The members of the instance that the page calls with no hook of wagmi. */
type Instance = Pick<Accounts.Accounts<[]>, 'session' | 'signOut'>

/** Creates the page's config, and renders the page. */
export async function start() {
  const { config, instance } = await (App.query.get('plugin') === '1'
    ? own()
    : connector())

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={new QueryClient()}>
          <Page instance={instance} />
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>,
  )
}

/**
 * Returns a config of wagmi's own `createConfig`, whose one connector is `tempoId`. The config holds
 * the chain of the suite's first node, and with `second=1` in the page's query, the second node's.
 */
async function connector() {
  const { chain: _chain, ...options } = await App.options()
  const config =
    App.query.get('second') === '1'
      ? createConfig({
          chains: [tempoLocalnet, tempoDevnet],
          connectors: [tempoId(options)],
          transports: {
            [tempoDevnet.id]: http(import.meta.env.VITE_TEMPO_SECOND_RPC_URL),
            [tempoLocalnet.id]: http(import.meta.env.VITE_TEMPO_RPC_URL),
          },
        })
      : createConfig({
          chains: [tempoLocalnet],
          connectors: [tempoId(options)],
          transports: {
            [tempoLocalnet.id]: http(import.meta.env.VITE_TEMPO_RPC_URL),
          },
        })

  // wagmi's `Connector` type holds no member that a connector adds.
  const properties = config.connectors[0] as unknown as tempoId.Properties
  return {
    config,
    // The page signs in through the dialog alone, so its session is Tempo ID's.
    instance: (): Promise<Instance> =>
      properties.getInstance() as Promise<unknown> as Promise<Instance>,
  }
}

/** Returns `accounts.wagmi` of the page's own instance, which signs in through the dialog. */
async function own() {
  const accounts = Accounts.create({
    ...(await App.options()),
    plugins: [dialog(), ...App.plugins(), wagmi()],
  })
  return {
    config: accounts.wagmi,
    instance: (): Promise<Instance> => Promise.resolve(accounts),
  }
}

function Page(props: Page.Props) {
  const { instance } = props

  const chainId = useChainId()
  const connection = useConnection()
  const [connector] = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const send = Hooks.token.useTransferSync()
  const sign = useSignMessage()
  const switchChain = useSwitchChain()
  const { outcomes, run } = App.useOutcomes()

  const actions: App.Actions = {
    Connect: () => connect.mutateAsync({ connector: connector! }),
    Disconnect: () => disconnect.mutateAsync(),
    // A spec verifies in its own process, as an app's backend does, so the page hands it the access
    // token. The output is hidden, so no screenshot of the proof holds the token.
    Proof: async () => {
      const { session } = await instance()
      return { accessToken: await session.accessToken() }
    },
    Session: async () => {
      const { session } = await instance()
      return App.describe(await session.get())
    },
    'Sign a message': async () => {
      const message = App.message()
      const signature = await sign.mutateAsync({ message })
      return { address: connection.address ?? null, message, signature }
    },
    'Sign out of the instance': async () => {
      const { signOut } = await instance()
      await signOut()
    },
    'Switch to the second chain': async () => {
      const chain = await switchChain.mutateAsync({ chainId: tempoDevnet.id })
      return { chainId: chain.id }
    },
  }

  return (
    <main>
      <p>
        Status <span id="status">{connection.status}</span>
      </p>
      <p>
        Chain <span id="chain">{chainId}</span>
      </p>
      {connection.address && (
        <p>
          Tempo Account <span id="account">{connection.address}</span>
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          run('Send OUSD', async () => {
            const { receipt } = await send.mutateAsync({
              amount: parseUnits(String(form.get('amount')), 6),
              to: String(form.get('to')) as `0x${string}`,
              token: Addresses.ousd,
            })
            return { transactionHash: receipt.transactionHash }
          })
        }}
      >
        <input aria-label="Recipient" name="to" required />
        <input aria-label="Amount" name="amount" required />
        <button type="submit">Send OUSD</button>
        <App.Result name="Send OUSD" outcome={outcomes['Send OUSD']} />
      </form>
      <ul>
        {Object.entries(actions).map(([name, fn]) => (
          <li key={name}>
            <button onClick={() => run(name, () => fn({}))} type="button">
              {name}
            </button>
            <App.Result name={name} outcome={outcomes[name]} />
          </li>
        ))}
      </ul>
    </main>
  )
}

declare namespace Page {
  type Props = {
    /** Returns the instance behind the config: the connector's, or the page's own. */
    instance: () => Promise<Instance>
  }
}
