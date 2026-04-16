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
  const icon = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>).icon as string | undefined,
  })
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
  return (
    <div className="min-h-dvh flex items-center justify-center bg-secondary max-dialog:items-stretch">
      <div className="fixed top-5 left-5 flex items-center gap-3 text-foreground max-dialog:hidden">
        <TempoLogo className="h-4 w-auto" />
        {icon && (
          <>
            <div className="h-4 w-px bg-border" />
            <img alt="" className="h-5 w-5" src={icon} />
          </>
        )}
      </div>
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
    <div ref={ref} className="overflow-hidden">
      {props.children}
    </div>
  )
}

function Frame(props: { children: ReactNode; mode: Mode.Mode }) {
  const { children, mode } = props

  // Popup: no card chrome — the OS window is the chrome.
  if (mode === 'popup') return <div>{children}</div>

  // Iframe: bottom-sheet on mobile, centered card on desktop.
  if (mode !== 'standalone')
    return (
      <div
        className="bg-primary text-foreground border border-border rounded-2xl w-[360px] max-w-full flex flex-col max-dialog:w-full max-dialog:rounded-b-none max-dialog:border-b-0 max-dialog:max-h-[90dvh] max-dialog:overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    )

  // Standalone: bordered card, full-page on mobile.
  return (
    <div className="bg-primary text-foreground border border-border rounded-2xl w-[360px] max-w-full flex flex-col max-dialog:w-full max-dialog:flex-1 max-dialog:rounded-none max-dialog:border-0">
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
    <div ref={ref} className="flex flex-1 flex-col">
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

function TempoLogo(props: { className?: string | undefined }) {
  return (
    <svg
      aria-label="Tempo"
      className={props.className}
      fill="none"
      height="24"
      role="img"
      viewBox="0 0 107 24"
      width="107"
    >
      <title>Tempo</title>
      <path
        fill="currentColor"
        d="M7.903 23.516h-6.28L7.445 5.593H0L1.624.34h20.739l-1.624 5.253h-7.046zM31.273 23.516H16.385L23.859.34h14.827l-1.409 4.419h-8.608l-1.562 4.975h8.332l-1.41 4.357h-8.362l-1.562 5.006h8.546zM38.011 23.516h-4.993L40.523.34h8.333l-.276 12.484L56.698.34h9.129l-7.475 23.176h-6.25l5.055-15.852-10.384 15.852h-3.707l.153-15.914zM72.856 4.635l-2.42 7.478h.674q2.297 0 3.829-1.081Q76.47 9.919 76.93 7.88q.398-1.761-.429-2.503-.826-.742-2.757-.742zm-6.066 18.88h-6.28L67.985.34h7.628q2.634 0 4.534.865 1.93.835 2.818 2.41.919 1.546.612 3.616-.398 2.72-2.082 4.79-1.686 2.07-4.381 3.213-2.665 1.113-5.974 1.113h-2.052zM98.546 22.033q-3.124 1.854-6.648 1.854h-.06q-3.126 0-5.27-1.39-2.114-1.422-3.033-3.833-.888-2.41-.428-5.284a16.3 16.3 0 0 1 2.665-6.674q2.082-3.06 5.207-4.883T97.658 0h.06q3.248 0 5.362 1.39 2.144 1.392 2.971 3.801.858 2.38.368 5.346-.582 3.492-2.665 6.582a16.3 16.3 0 0 1-5.208 4.914m-8.67-3.987q.828 1.576 2.88 1.576h.061q1.686 0 3.125-1.267 1.47-1.297 2.481-3.46 1.042-2.164 1.532-4.821.46-2.595-.368-4.172-.826-1.607-2.849-1.607h-.06q-1.563 0-3.034 1.298-1.44 1.298-2.511 3.492a18.8 18.8 0 0 0-1.563 4.759q-.49 2.595.307 4.202"
      />
    </svg>
  )
}
