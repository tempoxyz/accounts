import { useCallback, useEffect, useMemo, useRef, useState as react_useState } from 'react'
import { useStore } from 'zustand'

import * as IO from '../core/IntersectionObserver.js'
import type * as CoreRemote from '../core/Remote.js'

/** Monitors element visibility using IntersectionObserver v2. */
export function useEnsureVisibility(
  remote: CoreRemote.Remote,
  options: useEnsureVisibility.Options = {},
): useEnsureVisibility.ReturnType {
  const { enabled = true } = options

  const origin = useState(remote, (s) => s.origin)

  const trusted = useMemo(() => {
    if (!origin) return false
    try {
      const hostname = new URL(origin).hostname
      return remote.trustedHosts.includes(hostname)
    } catch {
      return false
    }
  }, [origin, remote.trustedHosts])

  const active = enabled && !trusted

  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = react_useState(true)

  useEffect(() => {
    if (!active) return
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
  }, [active])

  const invokePopup = useCallback(
    () => remote.messenger.send('switch-mode', { mode: 'popup' }),
    [remote],
  )

  return { invokePopup, ref, visible }
}

/** React hook to select state from a remote context's store. */
export function useState(remote: CoreRemote.Remote): CoreRemote.State
export function useState<selected>(
  remote: CoreRemote.Remote,
  selector: (state: CoreRemote.State) => selected,
): selected
export function useState(
  remote: CoreRemote.Remote,
  selector?: (state: CoreRemote.State) => unknown,
) {
  return useStore(remote.store, selector as never)
}

export declare namespace useEnsureVisibility {
  type Options = {
    /** Whether visibility monitoring is enabled. @default true */
    enabled?: boolean | undefined
  }

  type ReturnType = {
    /** Requests the host switch to a popup dialog. */
    invokePopup: () => void
    /** Ref to attach to the element being monitored. */
    ref: React.RefObject<HTMLDivElement | null>
    /** Whether the element is currently visible. */
    visible: boolean
  }
}
