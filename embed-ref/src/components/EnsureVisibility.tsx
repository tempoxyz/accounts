import { IntersectionObserver as IO, Remote } from 'accounts'
import * as React from 'react'

import { remote } from '../lib/config.js'
import trustedHosts from '../trusted-hosts.json'

/**
 * Wraps children with IO v2 occlusion detection when rendered in an iframe.
 */
export function EnsureVisibility(props: { children: React.ReactNode }) {
  const { children } = props

  const mode = Remote.useState(remote, (s) => s.mode)
  const origin = Remote.useState(remote, (s) => s.origin)

  const trusted = React.useMemo(() => {
    if (!origin) return false
    try {
      const hostname = new URL(origin).hostname
      return trustedHosts.includes(hostname)
    } catch {
      return false
    }
  }, [origin])

  const enabled = mode === 'iframe' && !trusted
  const { ref, visible } = useEnsureVisibility({ enabled })

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
            onClick={() => remote.messenger.send('switch-mode', { mode: 'popup' })}
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

/** Monitors element visibility using IntersectionObserver v2. */
function useEnsureVisibility(props: { enabled: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(true)

  React.useEffect(() => {
    if (!props.enabled) return
    if (!ref.current) return

    if (!IO.supported()) {
      setVisible(false)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        const isVisible =
          (entry as unknown as { isVisible: boolean | undefined }).isVisible || false
        setVisible(isVisible)
      },
      {
        delay: 100,
        threshold: [0.99],
        trackVisibility: true,
      } as IntersectionObserverInit,
    )

    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [props.enabled])

  return { ref, visible }
}
