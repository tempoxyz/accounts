import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAccount, useConnect, useDisconnect, WagmiProvider } from 'wagmi'

import { config } from './config.js'

const queryClient = new QueryClient()

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Account />
        <Connect />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function Account() {
  const { address, chainId, status } = useAccount()
  const { disconnect } = useDisconnect()

  return (
    <div>
      <h2>Account</h2>
      <div>
        address: {address}
        <br />
        chainId: {chainId}
        <br />
        status: {status}
      </div>
      {status !== 'disconnected' && (
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      )}
    </div>
  )
}

function Connect() {
  const { connectors, connect, status, error } = useConnect()
  const connector = connectors[0]

  if (!connector) return null

  return (
    <div>
      <h2>Connect</h2>
      <button
        type="button"
        onClick={() =>
          connect({
            connector,
            capabilities: { method: 'register', name: 'Wagmi Example' },
          })
        }
      >
        Register
      </button>
      <button
        type="button"
        onClick={() => connect({ connector })}
      >
        Login
      </button>
      <div>{status}</div>
      {error && <div>{error.message}</div>}
    </div>
  )
}

export default App
