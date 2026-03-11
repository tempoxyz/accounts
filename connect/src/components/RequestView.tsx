import { Schema, Store } from '@tempoxyz/accounts'
import { Actions } from '@tempoxyz/accounts/remote'
import { Json } from 'ox'
import { useState } from 'react'

import { remote } from '../lib/setup.js'

/** Generic confirm/reject UI for an RPC request. */
export function RequestView(props: RequestView.Props) {
  const { request } = props
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string>()

  async function confirm() {
    setStatus('loading')
    try {
      await Actions.respond(remote, request)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  function reject() {
    Actions.reject(remote, request)
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
      {'params' in request && request.params ? (
        <pre>{Json.stringify(request.params, null, 2)}</pre>
      ) : null}
      {status === 'error' && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}

export declare namespace RequestView {
  type Props = {
    request: Store.QueuedRequest['request']
  }
}
