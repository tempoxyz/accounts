/**
 * Layout for "remote" pages — the other end of the SDK adapters.
 * For example, when a dapp uses `dialog()`, it opens this app in an
 * iframe or popup. This layout handles the cross-window messaging,
 * mode detection, and UI chrome for those embedded contexts.
 * Also supports standalone visits (e.g. payment links, cli auth, etc) without a parent.
 */

import { remote, wagmiConfig } from '#/lib/config.js'
import * as Mode from '#/lib/mode.js'
import { router } from '#/router.js'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { reconnect } from '@wagmi/core'
import { Remote } from 'accounts/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export const Route = createFileRoute('/_remote')({
  component: RemoteLayout,
})

function RemoteLayout() {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> })
  // Mode is derived once on mount from search params + window hierarchy.
  const [mode] = useState<Mode.Mode>(() => Mode.get(search))
  const ready = Remote.useState(remote, (s) => s.ready)
  const origin = Remote.useState(remote, (s) => s.origin)
  const framed = Mode.ensureFramed(mode)

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
        <EnsureVisibility enabled={framed && !!origin}>
          <Outlet />
        </EnsureVisibility>
      </Frame>
    </Page>
  )
}

function Page(props: { children: ReactNode; mode: Mode.Mode }) {
  const { children, mode } = props
  const framed = Mode.ensureFramed(mode)
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

  // Iframe: make html transparent so the backdrop shows through.
  useEffect(() => {
    if (!framed) return
    document.documentElement.style.backgroundColor = 'transparent'
    return () => {
      document.documentElement.style.backgroundColor = ''
    }
  }, [framed])

  if (framed)
    return (
      <div
        className="fixed inset-0 flex items-start justify-center pt-4 max-dialog:items-end max-dialog:pt-0 bg-black/50"
        onClick={rejectAll}
      >
        {children}
      </div>
    )

  // Popup: auto-resizes the browser window to fit content.
  if (mode === 'popup') return <PopupPage>{children}</PopupPage>

  // Standalone: full-page centered layout (e.g. payment link).
  return <div className="min-h-screen flex items-start justify-center py-12">{children}</div>
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
    <div ref={ref} className="overflow-hidden">
      {props.children}
    </div>
  )
}

function Frame(props: { children: ReactNode; mode: Mode.Mode }) {
  const { children, mode } = props

  // Popup: no card chrome — the OS window is the chrome.
  if (mode === 'popup') return <div>{children}</div>

  // Iframe + standalone: bordered card.
  return (
    <div
      className="bg-primary text-foreground border border-border rounded-lg w-[360px] max-w-full flex flex-col max-dialog:w-full max-dialog:rounded-b-none max-dialog:border-b-0 max-dialog:max-h-[90dvh] max-dialog:overflow-y-auto"
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
        <div className="p-6 text-center">
          <p>Continue in new window</p>
          <p className="text-label-14 text-foreground-secondary">
            The dialog may be occluded. The request will open in a new window.
          </p>
          <button type="button" onClick={invokePopup} className="mt-2">
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
