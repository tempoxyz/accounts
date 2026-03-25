import { useMutation } from '@tanstack/react-query'
import { Json } from 'ox'
import type { Store } from 'tempodk'

import { remote } from '../lib/config.js'

/** Generic confirm/reject UI for an RPC request. */
export function RequestView(props: RequestView.Props) {
  const { request } = props

  const confirm = useMutation({
    mutationFn: () => remote.respond(request),
  })

  return (
    <div>
      <h2>{request.method}</h2>
      <div>
        <button onClick={() => confirm.mutate()} disabled={confirm.isPending} data-testid="confirm">
          {confirm.isPending ? 'Confirming...' : 'Confirm'}
        </button>{' '}
        <button
          onClick={() => remote.reject(request)}
          disabled={confirm.isPending}
          data-testid="reject"
        >
          Reject
        </button>
      </div>
      {confirm.isError && <p style={{ color: 'red' }}>{confirm.error.message}</p>}
      {'params' in request && request.params ? (
        <details>
          <summary>Params</summary>
          <pre style={{ maxHeight: 200, overflow: 'auto' }}>
            {Json.stringify(request.params, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

export declare namespace RequestView {
  type Props = {
    request: Store.QueuedRequest['request']
  }
}
