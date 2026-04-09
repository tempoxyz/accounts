import * as IO from './IntersectionObserver.js'
import * as Messenger from './Messenger.js'
import type * as Store from './Store.js'
import * as TrustedHosts from './TrustedHosts.js'

/** Dialog interface — manages the iframe/popup lifecycle for cross-origin auth. */
export type Dialog = SetupFn & Meta

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
  syncRequests: (requests: readonly Store.QueuedRequest[]) => Promise<void>
}

/** The setup function a dialog must implement. */
export type SetupFn = (parameters: SetupFn.Parameters) => Instance

export declare namespace SetupFn {
  type Parameters = {
    /** URL of the Tempo Auth app. */
    host: string
    /** Reactive state store. */
    store: Store.Store
  }
}

export const defaultSize = { height: 440, width: 360 }

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

/** Cached iframe singleton — keyed by host, reused across setup calls. */
let cached: { host: string; instance: Instance } | undefined

/** Mutable refs swapped on re-entry so the singleton always uses the latest caller's state. */
let store: Store.Store | undefined
let fallback: Instance | undefined

/** Creates an iframe dialog that embeds the auth app in a `<dialog>` element. */
export function iframe(): Dialog {
  if (typeof window === 'undefined') return noop()

  return define({ name: 'iframe' }, (parameters) => {
    const { host } = parameters

    // Reuse existing iframe if the host matches — just swap the store/fallback refs.
    if (cached && cached.host === host) {
      store = parameters.store
      fallback?.destroy()
      fallback = popup()(parameters)
      return cached.instance
    }

    // Different host — tear down old iframe and create fresh.
    cached?.instance.destroy()

    store = parameters.store
    fallback = popup()(parameters)

    let open = false

    const referrer = getReferrer()

    const hostUrl = new URL(host)
    hostUrl.searchParams.set('chainId', String(store.getState().chainId))
    hostUrl.searchParams.set('mode', 'iframe')
    if (referrer.icon) {
      if (typeof referrer.icon === 'string') hostUrl.searchParams.set('icon', referrer.icon)
      else {
        hostUrl.searchParams.set('icon', referrer.icon.light)
        hostUrl.searchParams.set('iconDark', referrer.icon.dark)
      }
    }

    const root = document.createElement('dialog')
    root.dataset.tempoWallet = ''

    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-closed', 'true')
    root.setAttribute('aria-label', 'Tempo Auth')
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
    frame.setAttribute('title', 'Tempo Auth')
    frame.src = hostUrl.toString()

    Object.assign(frame.style, {
      backgroundColor: 'transparent',
      border: '0',
      colorScheme: 'light dark',
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
    let switchedToPopup = false

    function createMessenger() {
      readyResult = undefined

      const m = Messenger.bridge({
        from: Messenger.fromWindow(window, { targetOrigin: hostUrl.origin }),
        to: Messenger.fromWindow(frame.contentWindow!, {
          targetOrigin: hostUrl.origin,
        }),
        waitForReady: true,
      })
      m.on('rpc-response', (response) => handleResponse(store!, response))
      m.waitForReady().then((result) => {
        readyResult = result
        if (result.colorScheme) frame.style.colorScheme = result.colorScheme
      })
      m.on('switch-mode', () => {
        hideDialog()
        activatePage()
        open = false
        switchedToPopup = true

        const pending = store
          ?.getState()
          .requestQueue.filter(
            (x): x is Store.QueuedRequest & { status: 'pending' } => x.status === 'pending',
          )
        if (pending && pending.length > 0) fallback?.syncRequests(pending)
      })
      return m
    }

    document.body.appendChild(root)
    let messenger = createMessenger()

    // Re-mount if removed (e.g. React hydration clears non-server-rendered elements).
    // The iframe reloads on re-append, so the messenger must be re-established.
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node !== root) continue
          document.body.appendChild(root)
          messenger.destroy()
          messenger = createMessenger()
          return
        }
      }
    }).observe(document.body, { childList: true })

    let savedOverflow = ''
    let opener: HTMLElement | null = null

    const onBlur = () => handleBlur(store!)

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
        fallback!.close()
        open = false

        hideDialog()
        activatePage()
      },
      destroy() {
        if (cached?.instance === instance) cached = undefined

        fallback?.close()
        open = false

        activatePage()
        hideDialog()

        fallback?.destroy()
        messenger.destroy()
        root.remove()
        inertObserver.disconnect()

        store = undefined
        fallback = undefined
      },
      open() {
        if (open) return
        open = true

        showDialog()
        activateDialog()
      },
      async syncRequests(requests) {
        if (switchedToPopup) {
          fallback!.syncRequests(requests)
          return
        }

        const { trustedHosts } = readyResult ?? (await messenger.waitForReady())

        // Safari does not support WebAuthn credential creation in iframes.
        if (
          isSafari() &&
          requests.some((x) => ['wallet_connect', 'eth_requestAccounts'].includes(x.request.method))
        ) {
          fallback!.syncRequests(requests)
          return
        }

        const ioSupported = IO.supported()
        const hostname = window.location.hostname.replace(/^www\./, '')
        const trusted = Boolean(trustedHosts && TrustedHosts.match(trustedHosts, hostname))
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
          fallback!.syncRequests(requests)
        } else {
          const requiresConfirm = requests.some((x) => x.status === 'pending')
          if (!open && requiresConfirm) this.open()
          messenger.send('rpc-requests', {
            account: getAccount(store!),
            chainId: store!.getState().chainId,
            requests,
          })
        }
      },
    }

    cached = { host, instance }
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

    const offDetectClosed = (() => {
      const timer = setInterval(() => {
        if (win?.closed) handleBlur(store)
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
    overlayClose.addEventListener('click', () => handleBlur(store))
    overlay.appendChild(overlayMessage)
    overlay.appendChild(overlayClose)
    document.body.appendChild(overlay)

    return {
      close() {
        overlay.style.display = 'none'
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

        const left = (window.innerWidth - size.width) / 2 + window.screenX
        const top = window.screenY + 100

        win = window.open(
          hostUrl.toString(),
          '_blank',
          `width=${size.width},height=${size.height},left=${left},top=${top}`,
        )
        if (!win) throw new Error('Failed to open popup')

        messenger = Messenger.bridge({
          from: Messenger.fromWindow(window, { targetOrigin: hostUrl.origin }),
          to: Messenger.fromWindow(win, { targetOrigin: hostUrl.origin }),
          waitForReady: true,
        })

        messenger.on('rpc-response', (response) => handleResponse(store, response))

        overlay.style.display = 'flex'
      },
      async syncRequests(requests) {
        const requiresConfirm = requests.some((x) => x.status === 'pending')
        if (requiresConfirm) {
          if (!win || win.closed) this.open()
          else win.focus()
        }
        messenger?.send('rpc-requests', {
          account: getAccount(store),
          chainId: store.getState().chainId,
          requests,
        })
      },
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
  }))
}

/** Updates the store with an RPC response from the remote auth app. */
function handleResponse(
  store: Store.Store,
  response: { id: number; result?: unknown; error?: { code: number; message: string } | undefined },
) {
  store.setState((x) => ({
    ...x,
    requestQueue: x.requestQueue.map((queued) => {
      if (queued.request.id !== response.id) return queued
      if (response.error)
        return {
          request: queued.request,
          error: response.error,
          status: 'error' as const,
        }
      return {
        request: queued.request,
        result: response.result,
        status: 'success' as const,
      }
    }),
  }))
}

/** Marks all pending requests as rejected (user closed the dialog). */
function handleBlur(store: Store.Store) {
  store.setState((x) => ({
    ...x,
    requestQueue: x.requestQueue.map((queued) =>
      queued.status === 'pending'
        ? {
            request: queued.request,
            error: { code: 4001, message: 'User rejected the request.' },
            status: 'error' as const,
          }
        : queued,
    ),
  }))
}

/** Returns the active account from the store, or `undefined` if none. */
function getAccount(store: Store.Store): { address: string } | undefined {
  const { accounts, activeAccount } = store.getState()
  const account = accounts[activeAccount]
  if (!account) return undefined
  return { address: account.address }
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
