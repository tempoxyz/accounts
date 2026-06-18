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
  const { enabled = true, ignoreTrusted = false } = options

  const origin_store = useState(remote, (s) => s.origin)
  const origin = options.origin ?? origin_store

  const trusted = useMemo(() => {
    if (!origin) return false
    try {
      const hostname = new URL(origin).hostname.replace(/^www\./, '')
      return TrustedHosts.match(remote.trustedHosts, hostname, window.location.hostname)
    } catch {
      return false
    }
  }, [origin, remote.trustedHosts])

  const active = enabled && (ignoreTrusted || !trusted)

  const ref = useRef<HTMLDivElement>(null)
  const [observed, setObserved] = react_useState(false)
  const [visible, setVisible] = react_useState(true)

  useEffect(() => {
    if (!active) {
      setObserved(true)
      setVisible(true)
      return
    }

    setObserved(false)

    if (!ref.current) return

    if (!IO.supported()) {
      setObserved(true)
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
        setObserved(true)
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

  const { invokePopup: invokePopup_options } = options
  const invokePopup = useCallback(() => {
    if (invokePopup_options) return invokePopup_options()
    remote.messenger.send('switch-mode', { mode: 'popup' })
  }, [remote, invokePopup_options])

  return { invokePopup, observed, ref, visible }
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

/** Applies theme overrides from URL search params and live messenger updates. */
export function useTheme(remote?: CoreRemote.Remote | undefined) {
  const snapshot = useRef<ThemeSnapshot | undefined>(undefined)

  useEffect(() => {
    if (typeof window === 'undefined') return

    snapshot.current = captureTheme()
    const params = new URLSearchParams(window.location.search)
    restoreTheme(snapshot.current)
    applyTheme({
      accent: params.get('accent') ?? undefined,
      radius: params.get('radius') ?? undefined,
      scheme: params.get('scheme') ?? undefined,
    })

    return () => {
      if (snapshot.current) restoreTheme(snapshot.current)
      snapshot.current = undefined
    }
  }, [])

  useEffect(() => {
    if (!remote) return
    return remote.messenger.on('theme', (payload) => {
      if (snapshot.current) restoreTheme(snapshot.current)
      applyTheme(payload)
    })
  }, [remote])
}

/** Applies theme values to the document root. */
function applyTheme(theme: {
  accent?: string | undefined
  radius?: string | undefined
  scheme?: string | undefined
}) {
  const root = document.documentElement
  const { accent, radius, scheme } = theme

  if (accent) {
    root.style.removeProperty('--theme-accent')
    root.setAttribute('data-theme-accent', getAccentName(accent))
    if (!isAccentPreset(accent)) root.style.setProperty('--theme-accent', accent)
  }
  if (scheme) root.style.colorScheme = scheme
  if (radius) root.setAttribute('data-theme-radius', radius)
}

function captureTheme(): ThemeSnapshot {
  const root = document.documentElement
  return {
    accentPreset: root.getAttribute('data-theme-accent'),
    accentValue: root.style.getPropertyValue('--theme-accent'),
    colorScheme: root.style.colorScheme,
    radius: root.getAttribute('data-theme-radius'),
  }
}

function restoreTheme(snapshot: ThemeSnapshot) {
  const root = document.documentElement
  restoreAttribute(root, 'data-theme-accent', snapshot.accentPreset)
  restoreAttribute(root, 'data-theme-radius', snapshot.radius)
  if (snapshot.accentValue) root.style.setProperty('--theme-accent', snapshot.accentValue)
  else root.style.removeProperty('--theme-accent')
  root.style.colorScheme = snapshot.colorScheme
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

function getAccentName(accent: string) {
  if (isAccentPreset(accent)) return accent
  return 'custom'
}

function isAccentPreset(accent: string) {
  return (
    accent === 'neutral' ||
    accent === 'blue' ||
    accent === 'red' ||
    accent === 'amber' ||
    accent === 'green' ||
    accent === 'purple'
  )
}

type ThemeSnapshot = {
  accentPreset: string | null
  accentValue: string
  colorScheme: string
  radius: string | null
}

export declare namespace useEnsureVisibility {
  type Options = {
    /** Whether visibility monitoring is enabled. @default true */
    enabled?: boolean | undefined
    /**
     * Monitor visibility even when the consumer origin is trusted. Useful for
     * transports that can safely remount in a popup without treating occlusion
     * as a trust failure. @default false
     */
    ignoreTrusted?: boolean | undefined
    /**
     * Override how the popup switch is requested when the element is
     * occluded (e.g. a wata session notification). @default Sends the
     * bespoke `switch-mode` message through the remote messenger.
     */
    invokePopup?: (() => void) | undefined
    /**
     * Override the consumer origin used for the trusted-host check (e.g.
     * a wata session's pinned origin). @default The remote store origin.
     */
    origin?: string | undefined
  }

  type ReturnType = {
    /** Requests the host switch to a popup dialog. */
    invokePopup: () => void
    /** Whether visibility monitoring has produced its first real result. */
    observed: boolean
    /** Ref to attach to the element being monitored. */
    ref: React.RefObject<HTMLDivElement | null>
    /** Whether the element is currently visible. */
    visible: boolean
  }
}
