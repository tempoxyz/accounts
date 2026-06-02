import { RpcRequest } from 'ox'

import * as IO from '../IntersectionObserver.js'
import * as TrustedHosts from '../TrustedHosts.js'
import * as channel from './channel.js'
import type { ReadyOptions, Request, Sync, Theme } from './types.js'

export { attach } from './consumer.attach.js'
export type { AttachOptions, Attachment, RequestOptions } from './consumer.attach.js'

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
  /** Prepare a provider RPC request with an id unique to this dialog surface. */
  prepareRequest: (request: unknown) => RpcRequest.RpcRequest
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
    /** Returns locally known account addresses for host-side session validation. */
    getAccounts: () => readonly { address: string }[]
    /** Returns the active chain ID used to initialize the dialog host. */
    getChainId: () => number
    /** Called when the dialog host reports that locally stored accounts are invalid. */
    onAccountsInvalid: () => void
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

type IframeSession = {
  fallback: Instance
  parameters: SetupFn.Parameters
  requests_displayed: readonly Request[]
  switchedToPopup: boolean
  sync_displayed: Sync | undefined
}

type IframeSurface = {
  createSession: (parameters: SetupFn.Parameters) => Instance
  destroy: () => void
}

/** Cached iframe surface — keyed by host, reused across setup calls. */
let cached: { host: string; surface: IframeSurface } | undefined

/** Creates an iframe dialog that embeds the auth app in a `<dialog>` element. */
export function iframe(): Dialog {
  if (typeof window === 'undefined') return noop()

  return define({ name: 'iframe' }, (parameters) => {
    const { host } = parameters

    if (cached && cached.host === host) return cached.surface.createSession(parameters)

    // Different host — tear down old iframe and create fresh.
    cached?.surface.destroy()
    const surface = createIframeSurface(parameters)
    cached = { host, surface }
    return surface.createSession(parameters)
  })
}

function createIframeSurface(parameters_initial: SetupFn.Parameters): IframeSurface {
  const { host } = parameters_initial

  let active: IframeSession | undefined
  let open = false
  let syncSession: IframeSession | undefined

  const sessions = new Set<IframeSession>()
  const sessionsByRequestId = new Map<string | number, IframeSession>()
  const ids = RpcRequest.createStore()

  const referrer = getReferrer()

  const hostUrl = new URL(host)
  hostUrl.searchParams.set('chainId', String(parameters_initial.getChainId()))
  hostUrl.searchParams.set('mode', 'iframe')
  if (referrer.icon) {
    if (typeof referrer.icon === 'string') hostUrl.searchParams.set('icon', referrer.icon)
    else {
      hostUrl.searchParams.set('icon', referrer.icon.light)
      hostUrl.searchParams.set('iconDark', referrer.icon.dark)
    }
  }
  applyThemeParams(hostUrl, parameters_initial.theme)

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
    colorScheme: parameters_initial.theme?.scheme ?? 'light dark',
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
    if (!active) return
    for (const request of active.requests_displayed)
      if (request.status === 'pending') sessionsByRequestId.delete(request.request.id)
    active.parameters.onReject(active.requests_displayed.map((x) => x.request.id))
  }

  function createChannel() {
    readyResult = undefined

    const { port1, port2 } = new MessageChannel()
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener(
        'load',
        () => {
          frame.contentWindow!.postMessage({ type: 'wata.port' }, hostUrl.origin, [port2])
          resolve()
        },
        { once: true },
      )
    })
    const channel_ = channel.consumerPostMessage({
      host: hostUrl.toString(),
      open: loaded,
      target: () => port1,
    })
    channel_.onResponse((response) => {
      const session = sessionsByRequestId.get(response.id)
      sessionsByRequestId.delete(response.id)
      session?.parameters.onResponse(response)
    })
    void channel_
      .waitForReady()
      .then((result) => {
        readyResult = result
        if (result.colorScheme) frame.style.colorScheme = result.colorScheme
      })
      .catch(() => {})
    channel_.onSync(({ valid }) => {
      if (valid === false) syncSession?.parameters.onAccountsInvalid()
      syncSession = undefined
    })
    channel_.onSwitchMode(() => {
      if (!active) return
      hideDialog()
      activatePage()
      open = false
      active.switchedToPopup = true

      if (active.sync_displayed && active.requests_displayed.length > 0)
        active.fallback.syncRequests(active.sync_displayed)
    })
    void channel_.start().catch(() => {})
    return channel_
  }

  let channel_ = createChannel()
  frame.src = hostUrl.toString()
  document.body.appendChild(root)

  // Re-mount if removed (e.g. React hydration clears non-server-rendered elements).
  // The iframe reloads on re-append, so the channel must be re-established.
  const mountObserver = new MutationObserver((mutations) => {
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

  const surface: IframeSurface = {
    createSession(parameters) {
      const session: IframeSession = {
        fallback: popup()(parameters),
        parameters,
        requests_displayed: [],
        switchedToPopup: false,
        sync_displayed: undefined,
      }
      sessions.add(session)

      const instance: Instance = {
        close() {
          session.fallback.close()
          if (active !== session) return
          open = false
          hideDialog()
          activatePage()
        },
        destroy() {
          session.fallback.close()
          session.fallback.destroy()
          sessions.delete(session)
          for (const [id, session_] of sessionsByRequestId)
            if (session_ === session) sessionsByRequestId.delete(id)
          if (active === session) {
            active = undefined
            open = false
            activatePage()
            hideDialog()
          }
          if (sessions.size === 0) surface.destroy()
        },
        open() {
          active = session
          if (open) return
          open = true
          showDialog()
          activateDialog()
        },
        prepareRequest(request) {
          return ids.prepare(request as never)
        },
        async syncRequests(sync) {
          const { requests } = sync
          active = session
          session.sync_displayed = sync
          session.requests_displayed = requests
          if (session.switchedToPopup) {
            session.fallback.syncRequests(sync)
            return
          }

          const ready = readyResult ?? channel_.waitForReady()
          if (!readyResult) void channel_.sendSync({}).catch(() => {})
          const { trustedHosts } = readyResult ?? (await ready)
          const accounts = session.parameters.getAccounts()
          if (accounts.length > 0) {
            syncSession = session
            channel_.sendSync({ addresses: accounts.map((a) => a.address) })
          }

          // Safari does not support WebAuthn credential creation in iframes.
          if (
            isSafari() &&
            requests.some((x) =>
              ['wallet_connect', 'eth_requestAccounts'].includes(x.request.method),
            )
          ) {
            session.fallback.syncRequests(sync)
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
            session.fallback.syncRequests(sync)
          } else {
            const requiresConfirm = requests.some((x) => x.status === 'pending')
            if (!open && requiresConfirm) this.open()
            for (const request of requests)
              if (request.status === 'pending') sessionsByRequestId.set(request.request.id, session)
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

      instance.syncTheme(parameters.theme)
      return instance
    },
    destroy() {
      if (cached?.surface === surface) cached = undefined
      active = undefined
      open = false
      activatePage()
      hideDialog()
      for (const session of sessions) session.fallback.destroy()
      sessions.clear()
      sessionsByRequestId.clear()
      channel_.close()
      root.remove()
      mountObserver.disconnect()
      inertObserver.disconnect()
    },
  }

  return surface
}

/** Opens the auth app in a new browser window. */
export function popup(options: popup.Options = {}): Dialog {
  if (typeof window === 'undefined') return noop()

  const { size = defaultSize } = options

  return define({ name: 'popup' }, (parameters) => {
    const { host } = parameters

    const ids = RpcRequest.createStore()
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
        channel_.onResponse((response) => parameters.onResponse(response))
        void channel_.start().catch(() => {})

        overlay.style.display = 'flex'
      },
      prepareRequest(request) {
        return ids.prepare(request as never)
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
  return define({ name: 'noop' }, () => {
    const ids = RpcRequest.createStore()
    return {
      open() {},
      close() {},
      destroy() {},
      prepareRequest(request) {
        return ids.prepare(request as never)
      },
      async syncRequests() {},
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
