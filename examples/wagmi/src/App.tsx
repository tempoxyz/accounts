import { useState } from 'react'
import { Expiry } from 'tempox'
import { formatUnits, parseUnits, stringify, type Hex } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSendTransactionSync,
  useSignMessage,
  useSignTypedData,
} from 'wagmi'
import { Hooks } from 'wagmi/tempo'

export default function App() {
  const { address, chainId, status } = useConnection()
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>wagmi example</h1>

      <h2>Connection</h2>
      <pre>
        {stringify({ address: address ?? null, chainId: chainId ?? null, status }, null, 2)}
      </pre>

      <h2>Connect</h2>
      <Connect />

      {status === 'connected' && (
        <>
          <h2>Balance</h2>
          <Balance />
          <Faucet />

          <h2>Transactions</h2>
          <SendTransaction />

          <h2>Sign Message</h2>
          <SignMessage />

          <h2>Sign Typed Data</h2>
          <SignTypedData />
        </>
      )}
    </div>
  )
}

function Connect() {
  const { mutate: connect, status, error } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { address } = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]
  const [accessKey, setAccessKey] = useState(false)

  if (!connector) return null

  return (
    <div>
      {address ? (
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() =>
              connect({
                connector,
                ...(accessKey
                  ? {
                      capabilities: {
                        authorizeAccessKey: {
                          expiry: Expiry.minutes(5),
                          limits: [
                            {
                              token: Addresses.pathUsd,
                              limit: parseUnits('5', 6),
                            },
                          ],
                        },
                      },
                    }
                  : {}),
              })
            }
          >
            Login
          </button>
          <div>
            <label>
              <input
                type="checkbox"
                checked={accessKey}
                onChange={(e) => setAccessKey(e.target.checked)}
              />{' '}
              Authorize Access Key ($5 aUSD, 5 minutes)
            </label>
          </div>
        </>
      )}
      <div>{status}</div>
      {error && <pre style={{ color: 'red' }}>{error.message}</pre>}
    </div>
  )
}

function Balance() {
  const { address } = useConnection()
  const { data, isLoading } = Hooks.token.useGetBalance({
    account: address,
    token: Addresses.pathUsd,
    query: {
      refetchInterval: 1_000,
    },
  })
  return <div>{isLoading ? 'Loading...' : data !== undefined ? formatUnits(data, 6) : '—'}</div>
}

function Faucet() {
  const { address } = useConnection()
  const { mutate, data, error, isPending } = Hooks.faucet.useFundSync()
  return (
    <div>
      <button disabled={!address || isPending} onClick={() => mutate({ account: address! })}>
        Fund
      </button>
      {error && <pre style={{ color: 'red' }}>{error.message}</pre>}
      {data !== undefined && <pre>{stringify(data, null, 2)}</pre>}
    </div>
  )
}

function SendTransaction() {
  const { mutate: sendTransactionSync, data, error, isPending } = useSendTransactionSync()
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          sendTransactionSync({
            calls: [
              Actions.token.transfer.call({
                to: form.get('to') as string as Hex,
                token: Addresses.pathUsd,
                amount: parseUnits((form.get('amount') as string) || '0', 6),
              }),
            ],
          } as any)
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="to"
          defaultValue="0x0000000000000000000000000000000000000001"
          placeholder="To (0x...)"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
        <input name="amount" defaultValue="1" placeholder="Amount" style={{ width: 80 }} />
        <button type="submit" disabled={isPending}>
          Send
        </button>
      </form>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{stringify(data, null, 2)}</pre>}
    </div>
  )
}

function SignMessage() {
  const { mutate: signMessage, data, error, isPending } = useSignMessage()
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const message = new FormData(e.currentTarget).get('message') as string
          if (!message) return
          signMessage({ message })
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          name="message"
          defaultValue="hello world"
          placeholder="Message"
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={isPending}>
          Sign
        </button>
      </form>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{data}</pre>}
    </div>
  )
}

function SignTypedData() {
  const { mutate: signTypedData, data, error, isPending } = useSignTypedData()
  return (
    <div>
      <button
        disabled={isPending}
        onClick={() =>
          signTypedData({
            types: {
              Person: [
                { name: 'name', type: 'string' },
                { name: 'wallet', type: 'address' },
              ],
              Mail: [
                { name: 'from', type: 'Person' },
                { name: 'to', type: 'Person' },
                { name: 'contents', type: 'string' },
              ],
            },
            primaryType: 'Mail',
            message: {
              from: { name: 'Alice', wallet: '0x0000000000000000000000000000000000000001' },
              to: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000002' },
              contents: 'Hello, Bob!',
            },
          })
        }
      >
        Sign
      </button>
      {error && <pre style={{ color: 'red' }}>{`${error.name}: ${error.message}`}</pre>}
      {data !== undefined && <pre>{data}</pre>}
    </div>
  )
}
