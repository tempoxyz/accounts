import { Store } from '@tempoxyz/accounts'
import { Json } from 'ox'
import { useState } from 'react'
import { useStore } from 'zustand'

import { remote } from '../lib/config.js'

/** Generic confirm/reject UI for an RPC request. */
export function RequestView(props: RequestView.Props) {
  const { request } = props
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const state = useStore(remote.provider.store)

  async function confirm() {
    setStatus('loading')
    try {
      await remote.respond(request)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  function reject() {
    remote.reject(request)
  }

  return (
    <div>
      <h2>{request.method}</h2>
      <div>
        <button onClick={confirm} disabled={status === 'loading'} data-testid="confirm">
          {status === 'loading' ? 'Confirming...' : 'Confirm'}
        </button>
        <button onClick={reject} disabled={status === 'loading'} data-testid="reject">
          Reject
        </button>
      </div>
      {status === 'error' && <p style={{ color: 'red' }}>{error}</p>}
      {'params' in request && request.params ? (
        <details>
          <summary>Request</summary>
          <pre>{Json.stringify(request.params, null, 2)}</pre>
        </details>
      ) : null}
      <details>
        <summary>Store</summary>
        <pre>{Json.stringify(state, null, 2)}</pre>
      </details>
    </div>
  )
}

export declare namespace RequestView {
  type Props = {
    request: Store.QueuedRequest['request']
  }
}
