import type * as React from 'react'
import { Remote } from 'accounts/react'

import { remote } from '../lib/config.js'

/**
 * Wraps children with IO v2 occlusion detection when rendered in an iframe.
 */
export function EnsureVisibility(props: { children: React.ReactNode }) {
  const { children } = props

  const mode = Remote.useState(remote, (s) => s.mode)

  const { invokePopup, ref, visible } = Remote.useEnsureVisibility(remote, {
    enabled: mode === 'iframe',
  })

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      }}
    >
      {visible ? (
        children
      ) : (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Continue in new window</p>
          <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
            The dialog may be occluded in this context. The request will be opened in a new window.
          </p>
          <button
            onClick={invokePopup}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #ddd',
              cursor: 'pointer',
            }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
