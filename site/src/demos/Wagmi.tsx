/**
 * Demonstrates a wagmi app whose config comes from its Tempo ID instance: a connection through
 * Tempo ID's dialog, a transfer that a `wagmi/tempo` hook sends, and a disconnection. It runs the
 * calls of `examples/wagmi`.
 * @module
 */
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { wagmi } from 'accounts/wagmi'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  WagmiProvider,
} from 'wagmi'
import { Hooks } from 'wagmi/tempo'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Recipient of the demo's transfer, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each connection requests an access key that sends up to 100 OUSD for a day, and
 * `accounts.wagmi` is its wagmi config.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [viem(), wagmi()],
})

/** Cache of the mutations of wagmi's hooks. */
const queryClient = new QueryClient()

/** Provides the instance's wagmi config to the steps of the demo. */
export default function Wagmi() {
  return (
    <WagmiProvider config={accounts.wagmi}>
      <QueryClientProvider client={queryClient}>
        <Steps />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

/** Connects through Tempo ID's dialog, sends 1 OUSD with the access key, and disconnects. */
function Steps() {
  const connection = useConnection()
  const [connector] = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const send = Hooks.token.useTransferSync()

  // The provider restores the connection of a saved session as the demo mounts.
  if (connection.status === 'reconnecting')
    return <span aria-label="Loading" data-demo-spinner="" />

  const connected = connection.status === 'connected'
  const explorer = connection.chain?.blockExplorers?.default.url

  const connectDetail = (() => {
    if (connected) return `Connected as ${connection.address}.`
    if (connect.error) return <span role="alert">{message(connect.error)}</span>
    return undefined
  })()
  const sendDetail = (() => {
    if (send.data)
      return (
        <>
          Sent 1 OUSD.{' '}
          {explorer && (
            <a
              href={`${explorer}/tx/${send.data.receipt.transactionHash}`}
              rel="noreferrer"
              target="_blank"
            >
              See the receipt
            </a>
          )}
        </>
      )
    if (send.error) return <span role="alert">{message(send.error)}</span>
    return undefined
  })()
  const sendState = (() => {
    if (send.data) return 'done'
    if (connected) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={connectDetail}
        label="Connect with Tempo ID."
        number={1}
        state={connected ? 'done' : 'active'}
      >
        {!connected && (
          <DemoButton
            disabled={!connector}
            loading={connect.isPending}
            onClick={() => {
              if (connector) connect.mutate({ connector })
            }}
          >
            Connect
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={sendDetail}
        label="Send 1 OUSD with a wagmi hook."
        number={2}
        state={sendState}
      >
        <DemoButton
          disabled={!connected}
          loading={send.isPending}
          onClick={() =>
            send.mutate({
              amount: parseUnits('1', 6),
              to: recipient,
              token: Addresses.ousd,
            })
          }
        >
          {send.data ? 'Send again' : 'Send'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        label="Disconnect, which signs the user out."
        number={3}
        state={send.data ? 'active' : 'idle'}
      >
        <DemoButton
          disabled={!connected}
          loading={disconnect.isPending}
          onClick={() => {
            send.reset()
            disconnect.mutate()
          }}
        >
          Disconnect
        </DemoButton>
      </DemoStep>
    </>
  )
}

/** Returns the first line of `error`'s message, which holds the fault without Viem's details. */
function message(error: Error) {
  return 'shortMessage' in error && typeof error.shortMessage === 'string'
    ? error.shortMessage
    : error.message
}
