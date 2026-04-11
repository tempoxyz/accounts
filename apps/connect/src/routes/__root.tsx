import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { reconnect } from '@wagmi/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Remote } from 'accounts/react'

import { remote, wagmiConfig } from '../lib/config.js'
import * as Mode from '../lib/mode.js'
import { router } from '../router.js'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> })
  // Mode is derived once on mount from search params + window hierarchy.
  const [mode] = useState<Mode.Mode>(() => Mode.get(search))
  const ready = Remote.useState(remote, (s) => s.ready)

  // Wire up parent messaging for iframe/popup modes only.
  // Standalone mode (e.g. payment links) has no parent to message.
  useEffect(() => {
    if (mode === 'standalone') return

    const unsubscribe = remote.onUserRequest(async ({ account, request }) => {
      if (!request) return
      await reconnect(wagmiConfig as never)
      const existing = router.state.location.search as Record<string, unknown>
      router.navigate({
        to: `/rpc/${request.method}`,
        search: { ...existing, ...request, account } as never,
      })
    })
    remote.ready()
    return unsubscribe
  }, [mode])

  // Standalone renders immediately; iframe/popup waits for parent handshake.
  if (mode !== 'standalone' && !ready) return null

  return (
    <Page mode={mode}>
      <Frame mode={mode}>
        <Outlet />
      </Frame>
    </Page>
  )
}

function Page(props: { children: ReactNode; mode: Mode.Mode }) {
  const { children, mode } = props
  const framed = Mode.ensureFramed(mode)
  // Wait for origin before enabling occlusion detection — avoids a flash
  // when IO v2 isn't supported and the trusted-host check hasn't resolved yet.
  const origin = Remote.useState(remote, (s) => s.origin)
  const rejectAll = useCallback(() => remote.rejectAll(), [])

  // Escape key dismisses the dialog in iframe/popup modes.
  useEffect(() => {
    if (!framed && mode !== 'popup') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') rejectAll()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [framed, mode, rejectAll])

  // Iframe: fixed overlay with semi-transparent backdrop.
  if (framed)
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 16,
          background: 'rgba(0, 0, 0, 0.5)',
        }}
        onClick={rejectAll}
      >
        <EnsureVisibility enabled={framed && !!origin}>{children}</EnsureVisibility>
      </div>
    )

  // Popup: auto-resizes the browser window to fit content.
  if (mode === 'popup') return <PopupPage>{children}</PopupPage>

  // Standalone: full-page centered layout (e.g. payment link).
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 48,
        paddingBottom: 48,
      }}
    >
      {children}
    </div>
  )
}

function PopupPage(props: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chromeWidth = window.outerWidth - window.innerWidth
    window.resizeTo(360 + chromeWidth, window.outerHeight)
    const observer = new ResizeObserver(() => {
      const height = el.scrollHeight + 2
      const chromeHeight = window.outerHeight - window.innerHeight
      window.resizeTo(360 + chromeWidth, height + chromeHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} style={{ overflow: 'hidden' }}>
      {props.children}
    </div>
  )
}

function Frame(props: { children: ReactNode; mode: Mode.Mode }) {
  const { children, mode } = props

  // Popup: no card chrome — the OS window is the chrome.
  if (mode === 'popup')
    return <div>{children}</div>

  // Iframe + standalone: bordered card.
  return (
    <div
      style={{
        background: 'white',
        color: 'black',
        border: '1px solid #ddd',
        borderRadius: 8,
        width: 360,
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function EnsureVisibility(props: { children: ReactNode; enabled: boolean }) {
  const { children, enabled } = props
  const { invokePopup, ref, visible } = Remote.useEnsureVisibility(remote, {
    enabled,
  })

  // Skip occlusion detection in tests — IO v2 isn't available in JSDOM/Playwright.
  if (import.meta.env.MODE === 'test') return children

  return (
    <div ref={ref}>
      {visible ? (
        children
      ) : (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <p>Continue in new window</p>
          <p style={{ fontSize: 14, color: '#666' }}>
            The dialog may be occluded. The request will open in a new window.
          </p>
          <button type="button" onClick={invokePopup} style={{ marginTop: 8 }}>
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
