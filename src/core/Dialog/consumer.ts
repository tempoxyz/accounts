import * as IO from '../IntersectionObserver.js'
import type * as Store from '../Store.js'
import * as TrustedHosts from '../TrustedHosts.js'
import * as channel from './channel.js'
import type { ReadyOptions, Request, Sync, Theme } from './types.js'

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
  syncRequests: (sync: Sync) => Promise<void>
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

/** Serializes theme options onto a URL's search params. */
function applyThemeParams(url: URL, theme: Theme | undefined) {
  if (!theme) return
  if (theme.accent) url.searchParams.set('accent', theme.accent)
  if (theme.radius) url.searchParams.set('radius', theme.radius)
  if (theme.scheme) url.searchParams.set('scheme', theme.scheme)
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
      cached.instance.syncTheme(parameters.theme)
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

    let readyResult: ReadyOptions | undefined
    let sync_displayed: Sync | undefined
    let requests_displayed: readonly Request[] = []
    let switchedToPopup = false

    function rejectDisplayedRequests() {
      parameters.onReject(requests_displayed.map((x) => x.request.id))
    }

    function createChannel() {
      readyResult = undefined

      const loaded = new Promise<void>((resolve) => {
        frame.addEventListener('load', () => resolve(), { once: true })
      })
      const channel_ = channel.consumerPostMessage({
        host: hostUrl.toString(),
        open: loaded,
        target: frame.contentWindow!,
      })
      channel_.onResponse((response) => parameters.onResponse(response))
      void channel_
        .waitForReady()
        .then((result) => {
          readyResult = result
          if (result.colorScheme) frame.style.colorScheme = result.colorScheme
          // Ask the wallet to verify the SDK's stored accounts are still valid.
          syncAccounts(channel_)
        })
        .catch(() => {})
      channel_.onSync(({ valid }) => {
        if (valid === false) store?.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
      })
      channel_.onSwitchMode(() => {
        hideDialog()
        activatePage()
        open = false
        switchedToPopup = true

        if (sync_displayed && requests_displayed.length > 0) fallback?.syncRequests(sync_displayed)
      })
      void channel_.start().catch(() => {})
      return channel_
    }

    let channel_ = createChannel()
    frame.src = hostUrl.toString()
    document.body.appendChild(root)

    // Re-mount if removed (e.g. React hydration clears non-server-rendered elements).
    // The iframe reloads on re-append, so the channel must be re-established.
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node !== root) continue
          channel_.close()
          channel_ = createChannel()
          frame.src = hostUrl.toString()
          document.body.appendChild(root)
          return
        }
      }
    }).observe(document.body, { childList: true })

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
        channel_.close()
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
      async syncRequests(sync) {
        const { requests } = sync
        sync_displayed = sync
        requests_displayed = requests
        if (switchedToPopup) {
          fallback!.syncRequests(sync)
          return
        }

        const ready = readyResult ?? channel_.waitForReady()
        if (!readyResult) void channel_.sendSync({}).catch(() => {})
        const { trustedHosts } = readyResult ?? (await ready)

        // Safari does not support WebAuthn credential creation in iframes.
        if (
          isSafari() &&
          requests.some((x) => ['wallet_connect', 'eth_requestAccounts'].includes(x.request.method))
        ) {
          fallback!.syncRequests(sync)
          return
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
          fallback!.syncRequests(sync)
        } else {
          const requiresConfirm = requests.some((x) => x.status === 'pending')
          if (!open && requiresConfirm) this.open()
          await channel_.sendRequests({
            account: sync.account,
            chainId: sync.chainId,
            requests,
          })
        }
      },
      syncTheme(theme) {
        frame.style.colorScheme = theme?.scheme ?? 'light dark'
        void channel_.sendTheme(theme ?? {})
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
    let requests_displayed: readonly Request[] = []

    function rejectDisplayedRequests() {
      parameters.onReject(requests_displayed.map((x) => x.request.id))
    }

    const offDetectClosed = (() => {
      const timer = setInterval(() => {
        if (win?.closed) rejectDisplayedRequests()
      }, 100)
      return () => clearInterval(timer)
    })()

    let channel_: channel.Consumer | undefined

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
        if (!win) return
        win.close()
        win = null
      },
      destroy() {
        this.close()
        channel_?.close()
        offDetectClosed()
        overlay.remove()
      },
      open() {
        channel_?.close()
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
        const top = window.screenY + 100

        win = window.open(
          hostUrl.toString(),
          '_blank',
          `width=${size.width},height=${size.height},left=${left},top=${top}`,
        )
        if (!win) throw new Error('Failed to open popup')

        channel_ = channel.consumerPostMessage({
          host: hostUrl.toString(),
          target: win,
        })
        channel_.onResponse((response) => parameters.onResponse(response))
        void channel_.start().catch(() => {})

        overlay.style.display = 'flex'
      },
      async syncRequests(sync) {
        const { requests } = sync
        requests_displayed = requests
        const requiresConfirm = requests.some((x) => x.status === 'pending')
        if (requiresConfirm) {
          if (!win || win.closed) this.open()
          else win.focus()
        }
        await channel_?.sendRequests({
          account: sync.account,
          chainId: sync.chainId,
          requests,
        })
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
function syncAccounts(channel_: channel.Consumer) {
  if (!store) return
  const { accounts } = store.getState()
  if (accounts.length === 0) return
  channel_.sendSync({ addresses: accounts.map((a) => a.address) })
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
