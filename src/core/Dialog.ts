import * as IO from './IntersectionObserver.js'
import * as Messenger from './Messenger.js'
import type * as Remote from './Remote.js'
import type * as Store from './Store.js'
import * as TrustedHosts from './TrustedHosts.js'

/** Dialog interface — manages the iframe/popup lifecycle for cross-origin auth. */
export type Dialog = SetupFn & Meta

/** Safe transport diagnostics. Never includes request data or a URL path/query. */
export class TransportError extends Error {
  /** JSON-RPC server error code. */
  code = -32000
  /** Safe diagnostics suitable for a caller's error UI. */
  data: { origin: string; stage: 'dialog_ready' | 'dispatch' | 'closed' }

  constructor(host: string, stage: TransportError['data']['stage']) {
    const origin = new URL(host).origin
    const message = {
      dialog_ready: `Wallet startup did not complete at ${origin}. Check that the wallet is running and reachable, then try again.`,
      dispatch: `Could not send the request to the wallet at ${origin}. Check the wallet connection before trying again.`,
      closed: `The wallet connection at ${origin} was closed. Start a new request to continue.`,
    }[stage]
    super(message)
    this.name = 'Dialog.TransportError'
    this.data = { origin, stage }
  }
}

/** Static metadata attached to a dialog function. */
export type Meta = {
  /** Identifier for the dialog type (e.g. `'iframe'`, `'popup'`). */
  name?: string | undefined
}

export type Instance = {
  /** Close the dialog (hide iframe / close popup). */
  close: () => void
  /** Destroy the dialog (remove DOM elements, clean up). */
  destroy: () => void
  /** Open the dialog (show iframe / open popup). */
  open: () => void
  /** Sync the pending request queue to the remote auth app. */
  syncRequests: (sync: Remote.Sync) => Promise<void>
  /** Update the visual theme at runtime. */
  syncTheme: (theme: Theme | undefined) => void
}

/** The setup function a dialog must implement. */
export type SetupFn = (parameters: SetupFn.Parameters) => Instance

export declare namespace SetupFn {
  type Parameters = {
    /** URL of the Tempo Wallet app. */
    host: string
    /** Reactive state store. */
    store: Store.Store
    /** Called when an asynchronous transport handoff fails. */
    onError?: ((error: TransportError, ids: readonly number[]) => void) | undefined
    /** Called when the user rejects the currently displayed requests. */
    onReject: (ids: readonly number[]) => void
    /** Called when the remote UI responds to a request. */
    onResponse: (response: {
      id: number
      result?: unknown
      error?: { code: number; message: string } | undefined
    }) => void
    /** Visual theme overrides applied to the embed. */
    theme?: Theme | undefined
  }
}

/** Visual theme configuration for the dialog embed. */
export type Theme = {
  /** Accent color — a theme preset name or a CSS color value (e.g. `'#6366f1'`). */
  accent?: 'neutral' | 'blue' | 'red' | 'amber' | 'green' | 'purple' | (string & {}) | undefined
  /** Border radius preset. */
  radius?: 'none' | 'small' | 'medium' | 'large' | 'full' | undefined
  /** Color scheme — controls light/dark appearance. Defaults to `'light dark'` (follows OS). */
  scheme?: 'light' | 'dark' | undefined
}

/** Serializes theme options onto a URL's search params. */
function applyThemeParams(url: URL, theme: Theme | undefined) {
  if (!theme) return
  if (theme.accent) url.searchParams.set('accent', theme.accent)
  if (theme.radius) url.searchParams.set('radius', theme.radius)
  if (theme.scheme) url.searchParams.set('scheme', theme.scheme)
}

export const defaultSize = { height: 600, width: 404 }

/** Creates a dialog from metadata and a setup function. */
export function define(meta: Meta, fn: SetupFn): Dialog {
  const { name, ...rest } = meta
  Object.defineProperty(fn, 'name', { value: name, configurable: true })
  return Object.assign(fn, rest) as Dialog
}

/** Detects an insecure context (e.g. HTTP) where iframes lack WebAuthn support. */
export function isInsecureContext(): boolean {
  if (typeof window === 'undefined') return false
  // `http://localhost` is a secure context but WebAuthn still requires HTTPS.
  if (window.location.protocol === 'http:') return true
  return !window.isSecureContext
}

/** Detects Safari (which does not support WebAuthn in cross-origin iframes). */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('safari') && !ua.includes('chrome')
}

type Cached = {
  host: string
  instance: Instance
  refs: {
    fallback: Instance
    store: Store.Store
  }
}

/** Cached iframe singleton — keyed by host, reused across setup calls. */
let cached: Cached | undefined

/** Creates an iframe dialog that embeds the auth app in a `<dialog>` element. */
export function iframe(): Dialog {
  if (typeof window === 'undefined') return noop()

  return define({ name: 'iframe' }, (parameters) => {
    const { host } = parameters

    // Reuse existing iframe if the host matches — just swap the store/fallback refs.
    if (cached && cached.host === host) {
      cached.refs.store = parameters.store

      cached.refs.fallback.destroy()
      cached.refs.fallback = popup()(parameters)
      cached.instance.syncTheme(parameters.theme)
      return cached.instance
    }

    // Different host — tear down old iframe and create fresh.
    cached?.instance.destroy()

    const refs = {
      fallback: popup()(parameters),
      store: parameters.store,
    }

    let open = false
    let destroyed = false
    let startup: AbortController | undefined
    let retry = false

    const referrer = getReferrer()

    const hostUrl = new URL(host)
    hostUrl.searchParams.set('chainId', String(refs.store.getState().chainId))
    hostUrl.searchParams.set('mode', 'iframe')
    if (referrer.icon) {
      if (typeof referrer.icon === 'string') hostUrl.searchParams.set('icon', referrer.icon)
      else {
        hostUrl.searchParams.set('icon', referrer.icon.light)
        hostUrl.searchParams.set('iconDark', referrer.icon.dark)
      }
    }
    applyThemeParams(hostUrl, parameters.theme)

    const root = document.createElement('dialog')
    root.dataset.tempoWallet = ''

    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-closed', 'true')
    root.setAttribute('aria-label', 'Tempo Wallet')
    root.setAttribute('hidden', 'until-found')

    Object.assign(root.style, {
      background: 'transparent',
      border: '0',
      outline: '0',
      padding: '0',
      position: 'fixed',
    })

    const frame = document.createElement('iframe')
    frame.dataset.testid = 'tempo-wallet'
    frame.setAttribute(
      'allow',
      [
        `publickey-credentials-get ${hostUrl.origin}`,
        `publickey-credentials-create ${hostUrl.origin}`,
        'clipboard-write',
        'payment',
      ].join('; '),
    )
    frame.setAttribute('allowtransparency', 'true')
    frame.setAttribute('tabindex', '0')
    frame.setAttribute('title', 'Tempo Wallet')
    frame.src = hostUrl.toString()

    Object.assign(frame.style, {
      backgroundColor: 'transparent',
      border: '0',
      colorScheme: parameters.theme?.scheme ?? 'light dark',
      height: '100%',
      left: '0',
      position: 'fixed',
      top: '0',
      width: '100%',
    })

    const style = document.createElement('style')
    style.innerHTML = `
        dialog[data-tempo-wallet]::backdrop {
          background: transparent!important;
        }
      `

    root.appendChild(style)
    root.appendChild(frame)

    let readyResult: Messenger.ReadyOptions | undefined
    let sync_displayed: Remote.Sync | undefined
    let requests_displayed: readonly Remote.Request[] = []
    let switchedToPopup = false

    function rejectDisplayedRequests() {
      const ids = requests_displayed.map((x) => x.request.id)
      instance.close()
      parameters.onReject(ids)
    }

    function createMessenger() {
      readyResult = undefined

      const m = Messenger.bridge({
        from: Messenger.fromWindow(window, { targetOrigin: hostUrl.origin }),
        to: Messenger.fromWindow(frame.contentWindow!, {
          targetOrigin: hostUrl.origin,
        }),
        waitForReady: true,
      })
      m.on('rpc-response', (response) => parameters.onResponse(response))
      void m
        .waitForReady()
        .then((result) => {
          if (destroyed || m !== messenger) return
          readyResult = result
          if (result.colorScheme) frame.style.colorScheme = result.colorScheme
          // Ask the wallet to verify the SDK's stored accounts are still valid.
          syncAccounts(m, refs.store)
        })
        .catch(() => {})
      m.on('sync', ({ valid }) => {
        if (valid === false) refs.store.disconnect()
      })
      m.on('switch-mode', () => {
        hideDialog()
        activatePage()
        open = false
        switchedToPopup = true

        if (sync_displayed && requests_displayed.length > 0) {
          const sync = sync_displayed
          const ids = requests_displayed.map((x) => x.request.id)
          void refs.fallback.syncRequests(sync).catch((error) => {
            if (sync_displayed !== sync) return
            parameters.onError?.(
              error instanceof TransportError ? error : new TransportError(host, 'dispatch'),
              ids,
            )
          })
        }
      })
      return m
    }

    document.body.appendChild(root)
    let messenger = createMessenger()

    // Re-mount if removed (e.g. React hydration clears non-server-rendered elements).
    // The iframe reloads on re-append, so the messenger must be re-established.
    const mountObserver = new MutationObserver((mutations) => {
      if (destroyed) return
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node !== root) continue
          document.body.appendChild(root)
          messenger.destroy()
          messenger = createMessenger()
          return
        }
      }
    })
    mountObserver.observe(document.body, { childList: true })

    let savedOverflow = ''
    let opener: HTMLElement | null = null

    const onBlur = () => rejectDisplayedRequests()

    // 1Password extension adds `inert` attribute to `dialog` rendering it unusable.
    const inertObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes') continue
        if (mutation.attributeName !== 'inert') continue
        root.removeAttribute('inert')
      }
    })
    inertObserver.observe(root, { attributeOldValue: true, attributes: true })

    // dialog/page interactivity (no visibility change)
    let dialogActive = false
    const activatePage = () => {
      if (!dialogActive) return
      dialogActive = false

      root.removeEventListener('cancel', onBlur)
      root.removeEventListener('click', onBlur)
      root.style.pointerEvents = 'none'
      opener?.focus()
      opener = null

      document.body.style.overflow = savedOverflow
    }
    const activateDialog = () => {
      if (dialogActive) return
      dialogActive = true

      root.addEventListener('cancel', onBlur)
      root.addEventListener('click', onBlur)
      frame.focus()
      root.style.pointerEvents = 'auto'

      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    // dialog visibility
    let visible = false
    const showDialog = () => {
      if (visible) return
      visible = true

      if (document.activeElement instanceof HTMLElement) opener = document.activeElement

      root.removeAttribute('hidden')
      root.removeAttribute('aria-closed')
      root.showModal()
    }
    const hideDialog = () => {
      if (!visible) return
      visible = false
      root.setAttribute('hidden', 'true')
      root.setAttribute('aria-closed', 'true')
      root.close()

      // 1Password extension sometimes adds `inert` to dialog siblings
      // and does not clean up when dialog closes.
      for (const sibling of root.parentNode ? Array.from(root.parentNode.children) : []) {
        if (sibling === root) continue
        if (!sibling.hasAttribute('inert')) continue
        sibling.removeAttribute('inert')
      }
    }

    const instance: Instance = {
      close() {
        startup?.abort()
        sync_displayed = undefined
        requests_displayed = []
        refs.fallback.close()
        open = false

        hideDialog()
        activatePage()
      },
      destroy() {
        if (destroyed) return
        destroyed = true
        const ids = requests_displayed.map((x) => x.request.id)
        startup?.abort()
        mountObserver.disconnect()
        if (cached?.instance === instance) cached = undefined

        refs.fallback.close()
        open = false

        activatePage()
        hideDialog()

        refs.fallback.destroy()
        messenger.destroy()
        root.remove()
        inertObserver.disconnect()
        if (ids.length > 0) parameters.onError?.(new TransportError(host, 'closed'), ids)
      },
      open() {
        if (destroyed) throw new TransportError(host, 'closed')
        if (open) return
        open = true

        showDialog()
        activateDialog()
      },
      async syncRequests(sync) {
        if (destroyed) throw new TransportError(host, 'closed')
        startup?.abort()
        const controller = new AbortController()
        startup = controller
        // Reload a failed document only for a fresh caller request, never replay an old one.
        if (retry && !readyResult) {
          messenger.destroy()
          frame.src = hostUrl.toString()
          messenger = createMessenger()
        }
        retry = false
        let stage: TransportError['data']['stage'] = 'dialog_ready'
        try {
          const { requests } = sync
          sync_displayed = sync
          requests_displayed = requests
          if (switchedToPopup) {
            return await refs.fallback.syncRequests(sync)
          }

          const { trustedHosts } =
            readyResult ??
            (await messenger.waitForReady({
              signal: controller.signal,
              timeout: 15_000,
            }))
          if (controller.signal.aborted || destroyed) throw new TransportError(host, 'closed')
          stage = 'dispatch'

          // Safari does not support WebAuthn credential creation in iframes.
          if (
            isSafari() &&
            requests.some((x) =>
              ['wallet_connect', 'eth_requestAccounts'].includes(x.request.method),
            )
          ) {
            return await refs.fallback.syncRequests(sync)
          }

          const ioSupported = IO.supported()
          const hostname = window.location.hostname.replace(/^www\./, '')
          const trusted = Boolean(
            trustedHosts && TrustedHosts.match(trustedHosts, hostname, hostUrl.hostname),
          )
          const secure = ioSupported || trusted

          if (!secure) {
            console.warn(
              [
                `[accounts] Browser does not support IntersectionObserver v2 and "${window.location.hostname}" is not a trusted host.`,
                'Falling back to popup dialog.',
                '',
                'To enable the iframe dialog, add your hostname to the trusted hosts list.',
              ].join('\n'),
            )
            await refs.fallback.syncRequests(sync)
          } else {
            const requiresConfirm = requests.some((x) => x.status === 'pending')
            if (!open && requiresConfirm) this.open()
            await messenger.send('rpc-requests', {
              account: sync.account,
              chainId: sync.chainId,
              requests,
            })
          }
        } catch (error) {
          const cancelled = controller.signal.aborted
          if (startup === controller) {
            retry = !cancelled && stage === 'dialog_ready'
            this.close()
          }
          if (error instanceof TransportError) throw error
          throw new TransportError(host, cancelled ? 'closed' : stage)
        }
      },
      syncTheme(theme) {
        frame.style.colorScheme = theme?.scheme ?? 'light dark'
        void messenger.send('theme', theme ?? {}).catch(() => {})
      },
    }

    cached = { host, instance, refs }
    return instance
  })
}

/** Opens the auth app in a new browser window. */
export function popup(options: popup.Options = {}): Dialog {
  if (typeof window === 'undefined') return noop()

  const { size = defaultSize } = options

  return define({ name: 'popup' }, (parameters) => {
    const { host, store } = parameters

    let win: Window | null = null
    let requests_displayed: readonly Remote.Request[] = []

    function rejectDisplayedRequests() {
      parameters.onReject(requests_displayed.map((x) => x.request.id))
    }

    const offDetectClosed = (() => {
      const timer = setInterval(() => {
        if (win?.closed) rejectDisplayedRequests()
      }, 100)
      return () => clearInterval(timer)
    })()

    let messenger: Messenger.Bridge | undefined

    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      alignItems: 'center',
      background: 'rgba(0, 0, 0, 0.5)',
      color: 'white',
      display: 'none',
      flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      gap: '12px',
      inset: '0',
      justifyContent: 'center',
      position: 'fixed',
      zIndex: '2147483647',
    })
    const overlayMessage = document.createElement('p')
    Object.assign(overlayMessage.style, { margin: '0' })
    overlayMessage.textContent = 'Continue in the popup window'
    const overlayClose = document.createElement('button')
    Object.assign(overlayClose.style, {
      background: 'none',
      border: 'none',
      color: 'white',
      cursor: 'pointer',
      font: 'inherit',
      padding: '0',
      textDecoration: 'underline',
    })
    overlayClose.textContent = 'Close'
    overlayClose.addEventListener('click', () => rejectDisplayedRequests())
    overlay.appendChild(overlayMessage)
    overlay.appendChild(overlayClose)
    document.body.appendChild(overlay)

    return {
      close() {
        overlay.style.display = 'none'
        messenger?.destroy()
        messenger = undefined
        if (!win) return
        win.close()
        win = null
      },
      destroy() {
        this.close()
        messenger?.destroy()
        offDetectClosed()
        overlay.remove()
      },
      open() {
        messenger?.destroy()
        win?.close()

        const referrer = getReferrer()

        const hostUrl = new URL(host)
        hostUrl.searchParams.set('chainId', String(store.getState().chainId))
        hostUrl.searchParams.set('mode', 'popup')
        if (referrer.icon) {
          if (typeof referrer.icon === 'string') hostUrl.searchParams.set('icon', referrer.icon)
          else {
            hostUrl.searchParams.set('icon', referrer.icon.light)
            hostUrl.searchParams.set('iconDark', referrer.icon.dark)
          }
        }
        applyThemeParams(hostUrl, parameters.theme)

        const left = (window.innerWidth - size.width) / 2 + window.screenX
        const top = (window.innerHeight - size.height) / 2 + window.screenY

        win = window.open(
          hostUrl.toString(),
          '_blank',
          `width=${size.width},height=${size.height},left=${left},top=${top}`,
        )
        if (!win) throw new TransportError(host, 'dispatch')

        messenger = Messenger.bridge({
          from: Messenger.fromWindow(window, { targetOrigin: hostUrl.origin }),
          to: Messenger.fromWindow(win, { targetOrigin: hostUrl.origin }),
          waitForReady: true,
        })

        messenger.on('rpc-response', (response) => parameters.onResponse(response))

        overlay.style.display = 'flex'
      },
      async syncRequests(sync) {
        let stage: TransportError['data']['stage'] = 'dispatch'
        try {
          const { requests } = sync
          requests_displayed = requests
          const requiresConfirm = requests.some((x) => x.status === 'pending')
          if (requiresConfirm) {
            if (!win || win.closed) this.open()
            else win.focus()
          }
          const current = messenger
          if (!current) return
          stage = 'dialog_ready'
          await current.waitForReady({ timeout: 15_000 })
          if (current !== messenger) throw new TransportError(host, 'closed')
          stage = 'dispatch'
          await current.send('rpc-requests', {
            account: sync.account,
            chainId: sync.chainId,
            requests,
          })
        } catch (error) {
          if (error instanceof TransportError) throw error
          throw new TransportError(host, stage)
        }
      },
      syncTheme() {},
    }
  })
}

export declare namespace popup {
  type Options = {
    /** Popup window dimensions. @default `{ width: 360, height: 440 }` */
    size?: { width: number; height: number } | undefined
  }
}

/** Returns a no-op dialog for SSR environments. */
export function noop(): Dialog {
  return define({ name: 'noop' }, () => ({
    open() {},
    close() {},
    destroy() {},
    async syncRequests() {},
    syncTheme() {},
  }))
}

/** Sends stored account addresses to the wallet for session validation. */
function syncAccounts(messenger: Messenger.Bridge, store: Store.Store) {
  const { accounts } = store.getState()
  if (accounts.length === 0) return
  void messenger.send('sync', { addresses: accounts.map((a) => a.address) }).catch(() => {})
}

/**
 * Extracts referrer metadata from the host page.
 * Must be called in the host page context (where `document` is accessible).
 */
function getReferrer(): getReferrer.ReturnType {
  const icon = (() => {
    const dark = document.querySelector(
      'link[rel~="icon"][media="(prefers-color-scheme: dark)"]',
    ) as HTMLLinkElement | null
    const light = (document.querySelector(
      'link[rel~="icon"][media="(prefers-color-scheme: light)"]',
    ) ?? document.querySelector('link[rel~="icon"]')) as HTMLLinkElement | null

    if (dark?.href && light?.href && dark.href !== light.href)
      return { dark: dark.href, light: light.href }

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    return (isDark ? dark?.href : light?.href) ?? light?.href
  })()

  return { icon, title: document.title }
}

declare namespace getReferrer {
  type ReturnType = {
    /** Favicon URL, or separate light/dark URLs. */
    icon: string | { light: string; dark: string } | undefined
    /** Document title of the host page. */
    title: string
  }
}
