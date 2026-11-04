/**
 * A wagmi app whose config comes from its Tempo ID instance: Connect signs in through the dialog and
 * requests a key, the `wagmi/tempo` token hook then sends OUSD with that key, and Disconnect signs
 * out.
 * Its client ID is its origin, so it needs no registration.
 * @module
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { wagmi } from 'accounts/wagmi'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoTestnet } from 'viem/tempo/chains'
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  WagmiProvider,
} from 'wagmi'
import { Hooks } from 'wagmi/tempo'

/**
 * The Tempo ID instance, on Tempo testnet. Each connection requests a key that sends up to 100 OUSD
 * for a day, and `accounts.wagmi` is its wagmi config.
 */
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chainId: tempoTestnet.id,
  plugins: [viem(), wagmi()],
  url: import.meta.env.VITE_TEMPO_ID_URL ?? 'http://localhost:5173',
})

const queryClient = new QueryClient()

function App() {
  const connection = useConnection()
  const [connector] = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const send = Hooks.token.useTransferSync()

  if (connection.status !== 'connected')
    return (
      <main>
        <button
          disabled={connect.isPending}
          onClick={() => connect.mutate({ connector: connector! })}
          type="button"
        >
          Connect with Tempo
        </button>
        <p role="status">{connect.error?.message}</p>
      </main>
    )

  return (
    <main>
      <p>Tempo Account {connection.address}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          send.mutate({
            amount: parseUnits(String(form.get('amount')), 6),
            to: String(form.get('to')) as `0x${string}`,
            token: Addresses.ousd,
          })
        }}
      >
        <input aria-label="Recipient" name="to" placeholder="0x…" required />
        <input aria-label="Amount" name="amount" placeholder="1.00" required />
        <button disabled={send.isPending} type="submit">
          Send OUSD
        </button>
      </form>
      <p role="status">
        {send.data
          ? `Sent in ${send.data.receipt.transactionHash}.`
          : send.error?.message}
      </p>
      <button onClick={() => disconnect.mutate()} type="button">
        Disconnect
      </button>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={accounts.wagmi}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
