import { Provider as ox_Provider } from 'ox'

import * as IO from '../IntersectionObserver.js'
import * as TrustedHosts from '../TrustedHosts.js'
import * as channel from './channel.js'
import type { ReadyOptions, RequestContext, Theme } from './types.js'

export { attach } from './consumer.attach.js'
export type { AttachOptions, Attachment, RequestOptions } from './consumer.attach.js'

/** Dialog interface — manages the iframe/popup lifecycle for cross-origin auth. */
export type Dialog = SetupFn & Meta

/** Static metadata attached to a dialog function. */
export type Meta = {
  /** Identifier for the dialog type (e.g. `'iframe'`, `'popup'`). */
  name?: string | undefined
}

/** Active consumer-side dialog session returned by a dialog setup function. */
export type Session = {
  /** Close the dialog (hide iframe / close popup). */
  close: () => void
  /** Destroy the dialog (remove DOM elements, clean up). */
  destroy: () => void
  /** Open the dialog (show iframe / open popup). */
  open: () => void
  /** Send a request to the remote auth app. */
  request: (context: RequestContext) => Promise<unknown>
  /** Update the visual theme at runtime. */
  syncTheme: (theme: Theme | undefined) => void
}

/** The setup function a dialog must implement. */
export type SetupFn = (parameters: SetupFn.Parameters) => Session

export declare namespace SetupFn {
  type Parameters = {
    /** URL of the Tempo Wallet app. */
    host: string
    /** Returns locally known account addresses for host-side session validation. */
    getAccounts: () => readonly { address: string }[]
    /** Returns the active chain ID used to initialize the dialog host. */
    getChainId: () => number
    /** Called when the dialog host reports that locally stored accounts are invalid. */
    onAccountsInvalid: () => void
    /** Visual theme overrides applied to the embed. */
    theme?: Theme | undefined
  }
}

type Pending = {
  reject: (error: Error) => void
  resolve: (result: unknown) => void
  sync: RequestContext
  version: number
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

/** Creates an iframe dialog that embeds the auth app in a `<dialog>` element. */
export function iframe(): Dialog {
  if (typeof window === 'undefined') return noop()

  return define({ name: 'iframe' }, (parameters) => {
    const { host } = parameters

    let open = false
    const pending = new Map<channel.RequestId, Pending>()
    let switchedToPopup = false

    const referrer = getReferrer()

    const hostUrl = new URL(host)
    hostUrl.searchParams.set('chainId', String(parameters.getChainId()))
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

    function rejectDisplayedRequests() {
      const ids = [...pending.keys()]
      if (ids.length === 0) return
      void channel_.cancelRequests({ ids })
      for (const request of pending.values())
        request.reject(new ox_Provider.UserRejectedRequestError())
      pending.clear()
      closeSession()
    }

    const src = hostUrl.toString()

    function waitForFrameLoad() {
      return new Promise<void>((resolve) => {
        frame.addEventListener('load', () => resolve(), { once: true })
      })
    }

    function createChannel(loaded: Promise<void>) {
      readyResult = undefined

      const channel_ = channel.consumerPostMessage({
        host: src,
        open: loaded,
        target: () => frame.contentWindow!,
      })
      void channel_
        .waitForReady()
        .then((result) => {
          readyResult = result
          if (result.colorScheme) frame.style.colorScheme = result.colorScheme
        })
        .catch(() => {})
      channel_.onSwitchMode(() => {
        hideDialog()
        activatePage()
        open = false
        switchedToPopup = true

        for (const request of pending.values()) submitFallback(request)
      })
      void channel_.start().catch(() => {})
      return channel_
    }

    const fallback = popup()(parameters)
    let channel_ = channel.noopConsumer()

    function mountFrame() {
      const loaded = waitForFrameLoad()
      frame.src = src
      document.body.appendChild(root)
      channel_ = createChannel(loaded)
    }

    mountFrame()

    // Re-mount if removed (e.g. React hydration clears non-server-rendered elements).
    // The iframe reloads on re-append, so the channel must be re-established.
    const mountObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node !== root) continue
          channel_.close()
          mountFrame()
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

    function validateCachedAccounts() {
      const accounts = parameters.getAccounts()
      if (accounts.length === 0) return
      void channel_
        .validateCachedAccounts({ addresses: accounts.map((a) => a.address) })
        .then(({ valid }) => {
          if (valid === false) parameters.onAccountsInvalid()
        })
        .catch(() => {})
    }

    function closeSession() {
      fallback.close()
      open = false
      hideDialog()
      activatePage()
    }

    function finishRequest(id: channel.RequestId, version: number, fn: (request: Pending) => void) {
      const request = pending.get(id)
      if (!request) return
      if (request.version !== version) return
      pending.delete(id)
      fn(request)
      if (pending.size === 0) closeSession()
    }

    function submitIframe(request: Pending) {
      const id = request.sync.request.request.id
      const version = ++request.version
      void channel_
        .request(request.sync)
        .then((result) => finishRequest(id, version, (request) => request.resolve(result)))
        .catch((error) => finishRequest(id, version, (request) => request.reject(toError(error))))
    }

    function submitFallback(request: Pending) {
      const id = request.sync.request.request.id
      const version = ++request.version
      void fallback
        .request(request.sync)
        .then((result) => finishRequest(id, version, (request) => request.resolve(result)))
        .catch((error) => finishRequest(id, version, (request) => request.reject(toError(error))))
    }

    function createPending(sync: RequestContext) {
      const id = sync.request.request.id
      let request: Pending | undefined
      const promise = new Promise<unknown>((resolve, reject) => {
        request = { reject, resolve, sync, version: 0 }
        pending.set(id, request)
      })
      return { promise, request: request! }
    }

    async function prepareRequest(request: Pending) {
      const id = request.sync.request.request.id
      try {
        if (!pending.has(id)) return
        if (switchedToPopup) {
          submitFallback(request)
          return
        }

        const ready = readyResult ?? channel_.waitForReady()
        const { trustedHosts } = readyResult ?? (await ready)
        if (!pending.has(id)) return
        if (request.version > 0) return
        if (switchedToPopup) {
          submitFallback(request)
          return
        }

        validateCachedAccounts()

        // Safari does not support WebAuthn credential creation in iframes.
        if (
          isSafari() &&
          ['wallet_connect', 'eth_requestAccounts'].includes(request.sync.request.request.method)
        ) {
          submitFallback(request)
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
          submitFallback(request)
          return
        }

        if (!open) show()
        submitIframe(request)
      } catch (error) {
        finishRequest(id, request.version, (request) => request.reject(toError(error)))
      }
    }

    function show() {
      open = true
      showDialog()
      activateDialog()
    }

    function sendRequest(sync: RequestContext) {
      const { promise, request } = createPending(sync)
      void prepareRequest(request)
      return promise
    }

    return {
      close() {
        closeSession()
      },
      destroy() {
        rejectDisplayedRequests()
        closeSession()

        fallback.destroy()
        channel_.close()
        root.remove()
        mountObserver.disconnect()
        inertObserver.disconnect()
      },
      open() {
        if (open) return
        show()
      },
      request(sync) {
        return sendRequest(sync)
      },
      syncTheme(theme) {
        frame.style.colorScheme = theme?.scheme ?? 'light dark'
        void channel_.sendTheme(theme ?? {})
      },
    }
  })
}

/** Opens the auth app in a new browser window. */
export function popup(options: popup.Options = {}): Dialog {
  if (typeof window === 'undefined') return noop()

  const { size = defaultSize } = options

  return define({ name: 'popup' }, (parameters) => {
    const { host } = parameters

    let win: Window | null = null
    const pending = new Map<channel.RequestId, Pending>()

    function rejectDisplayedRequests() {
      const ids = [...pending.keys()]
      if (ids.length === 0) return
      void channel_?.cancelRequests({ ids })
      for (const request of pending.values())
        request.reject(new ox_Provider.UserRejectedRequestError())
      pending.clear()
      closeSession()
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

    function closeSession() {
      overlay.style.display = 'none'
      if (!win) return
      win.close()
      win = null
    }

    function finishRequest(id: channel.RequestId, version: number, fn: (request: Pending) => void) {
      const request = pending.get(id)
      if (!request) return
      if (request.version !== version) return
      pending.delete(id)
      fn(request)
      if (pending.size === 0) closeSession()
    }

    function submit(request: Pending) {
      const id = request.sync.request.request.id
      const version = ++request.version
      void channel_
        ?.request(request.sync)
        .then((result) => finishRequest(id, version, (request) => request.resolve(result)))
        .catch((error) => finishRequest(id, version, (request) => request.reject(toError(error))))
    }

    return {
      close() {
        closeSession()
      },
      destroy() {
        rejectDisplayedRequests()
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
        hostUrl.searchParams.set('chainId', String(parameters.getChainId()))
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
          target: () => win!,
        })
        void channel_.start().catch(() => {})

        overlay.style.display = 'flex'
      },
      async request(sync) {
        if (!win || win.closed) this.open()
        else win.focus()
        return new Promise<unknown>((resolve, reject) => {
          const request: Pending = { reject, resolve, sync, version: 0 }
          pending.set(sync.request.request.id, request)
          submit(request)
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
  return define({ name: 'noop' }, () => {
    return {
      open() {},
      close() {},
      destroy() {},
      async request() {
        return undefined
      },
      syncTheme() {},
    }
  })
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

function toError(error: unknown): Error {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error)
    return ox_Provider.parseError({
      code: Number(error.code),
      message: String(error.message),
    })
  if (error instanceof Error) return error
  return new Error(String(error))
}
