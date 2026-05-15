import { useEffect, useState } from 'react'
import { stringify } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'

export default function App() {
  const { address, chainId, status } = useConnection()
  return (
    <div>
      <h1>Wagmi + Tempo Wallet (with Server Auth)</h1>

      <h2>Connection</h2>
      <pre>
        {stringify({ address: address ?? null, chainId: chainId ?? null, status }, null, 2)}
      </pre>

      <h2>Connect</h2>
      <Connect />

      <h2>Server Authentication</h2>
      <ServerAuth />
    </div>
  )
}

function Connect() {
  const { mutate: connect, status, error } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { address } = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]

  if (!connector) return null

  return (
    <div>
      {address ? (
        <button type="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      ) : (
        <button type="button" onClick={() => connect({ connector })}>
          Login
        </button>
      )}
      <div>{status}</div>
      {error && <pre style={{ color: 'red' }}>{error.message}</pre>}
    </div>
  )
}

function ServerAuth() {
  type State =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: unknown }
    | { status: 'error'; status_code: number; error: string }

  const { address } = useConnection()
  const [me, setMe] = useState<State>({ status: 'idle' })

  async function fetchMe() {
    setMe({ status: 'loading' })
    try {
      const res = await fetch('/me', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok)
        return setMe({ status: 'error', status_code: res.status, error: stringify(data) })
      setMe({ status: 'success', data })
    } catch (error) {
      setMe({ status: 'error', status_code: 0, error: (error as Error).message })
    }
  }

  // Re-fetch the session whenever the connected address changes
  // (login → 200 with new address; disconnect → 401 because
  // `wallet_disconnect` already POSTed to `/auth/logout` for us).
  useEffect(() => {
    fetchMe()
  }, [address])

  return (
    <div>
      <p>
        The wallet signs a SIWE challenge during connect (because{' '}
        <code>
          tempoWallet({'{'} auth {'}'})
        </code>{' '}
        is set). The server issues an <code>accounts_auth</code> session cookie, which authenticates
        calls to <code>GET /me</code>. <strong>Disconnect</strong> calls{' '}
        <code>POST /auth/logout</code> automatically.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={fetchMe} disabled={me.status === 'loading'}>
          GET /me
        </button>
      </div>
      {me.status === 'success' && <pre>{stringify(me.data, null, 2)}</pre>}
      {me.status === 'error' && (
        <pre style={{ color: 'red' }}>
          {me.status_code} {me.error}
        </pre>
      )}
    </div>
  )
}
