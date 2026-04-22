import { useCallback, useEffect, useMemo, useRef, useState as react_useState } from 'react'
import { useStore } from 'zustand'

import * as IO from '../core/IntersectionObserver.js'
import type * as CoreRemote from '../core/Remote.js'
import * as TrustedHosts from '../core/TrustedHosts.js'

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
      const hostname = new URL(origin).hostname.replace(/^www\./, '')
      return TrustedHosts.match(remote.trustedHosts, hostname)
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
        if (document.visibilityState === 'hidden') return
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

const bundledFonts = new Set(['Pilat', 'TT Norms'])

/** Applies theme overrides from URL search params and live messenger updates. */
export function useTheme(remote?: CoreRemote.Remote | undefined) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    applyTheme({
      accent: params.get('accent') ?? undefined,
      radius: params.get('radius') ?? undefined,
      font: params.get('font') ?? undefined,
    })

    return () => clearTheme()
  }, [])

  useEffect(() => {
    if (!remote) return
    return remote.messenger.on('theme', (payload) => {
      clearTheme()
      applyTheme(payload)
    })
  }, [remote])
}

/** Applies theme values to the document root. */
function applyTheme(theme: { accent?: string | undefined; radius?: string | undefined; font?: string | undefined }) {
  const root = document.documentElement
  const { accent, radius, font } = theme

  if (accent) {
    const isHex = accent.startsWith('#')
    root.setAttribute('data-accent', isHex ? 'custom' : accent)
    if (isHex) root.style.setProperty('--accent-base', accent)
  }
  if (radius) root.setAttribute('data-radius', radius)
  if (font) {
    if (font === 'System') {
      root.style.setProperty('--font-body', 'ui-sans-serif, system-ui, sans-serif')
      return
    }
    if (!bundledFonts.has(font)) {
      const id = `gf-${font.replace(/\s/g, '-')}`
      if (!document.getElementById(id)) {
        const link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600&display=swap`
        document.head.appendChild(link)
      }
    }
    root.style.setProperty('--font-body', `'${font}', sans-serif`)
  }
}

/** Removes all theme overrides from the document root. */
function clearTheme() {
  const root = document.documentElement
  root.removeAttribute('data-accent')
  root.removeAttribute('data-radius')
  root.style.removeProperty('--accent-base')
  root.style.removeProperty('--font-body')
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
