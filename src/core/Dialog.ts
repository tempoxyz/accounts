import * as Messenger from './Messenger.js'
import type * as Store from './Store.js'

/** Dialog interface — manages the iframe/popup lifecycle for cross-origin auth. */
export type Dialog = {
  /** Identifier for the dialog type (e.g. `'iframe'`, `'popup'`). */
  name: string
  /** Initialize the dialog with the given host and store. */
  setup: (parameters: setup.Parameters) => setup.ReturnType
}

export declare namespace setup {
  type Parameters = {
    /** URL of the Tempo Auth app. */
    host: string
    /** Reactive state store. */
    store: Store.Store
  }

  type ReturnType = {
    /** Close the dialog (hide iframe / close popup). */
    close: () => void
    /** Destroy the dialog (remove DOM elements, clean up). */
    destroy: () => void
    /** Bridge messenger for cross-frame communication. */
    messenger: Messenger.Bridge
    /** Open the dialog (show iframe / open popup). */
    open: () => void
    /** Sync the pending request queue to the remote auth app. */
    syncRequests: (requests: readonly Store.QueuedRequest[]) => void
  }
}

/** Creates a dialog from a custom implementation. */
export function from(dialog: Dialog): Dialog {
  return dialog
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

  return from({
    name: 'iframe',
    setup(parameters) {
      const { host, store } = parameters
      const hostUrl = new URL(host)

      const root = document.createElement('dialog')
      root.dataset.tempoConnect = ''
      document.body.appendChild(root)

      const frame = document.createElement('iframe')
      frame.setAttribute(
        'sandbox',
        'allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
      )
      frame.setAttribute(
        'allow',
        [
          `publickey-credentials-get ${hostUrl.origin}`,
          `publickey-credentials-create ${hostUrl.origin}`,
        ].join('; '),
      )
      frame.src = host

      root.appendChild(frame)

      const messenger = Messenger.bridge({
        from: Messenger.fromWindow(window, { targetOrigin: hostUrl.origin }),
        to: Messenger.fromWindow(frame.contentWindow!, {
          targetOrigin: hostUrl.origin,
        }),
        waitForReady: true,
      })

      messenger.on('rpc-response', (response) => handleResponse(store, response))

      messenger.send('__internal', {
        type: 'init',
        chainId: store.getState().chainId,
        mode: 'iframe',
      })

      let isOpen = false
      let savedOverflow = ''
      let opener: HTMLElement | null = null

      function close() {
        if (!isOpen) return
        isOpen = false
        root.close()
        document.body.style.overflow = savedOverflow
        opener?.focus()
        opener = null
      }

      root.addEventListener('cancel', () => {
        close()
        handleBlur(store)
      })

      root.addEventListener('click', (event) => {
        if (event.target !== root) return
        close()
        handleBlur(store)
      })

      // 1Password extension adds `inert` attribute to `dialog` rendering it unusable.
      const inertObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'inert') root.removeAttribute('inert')
        }
      })
      inertObserver.observe(root, { attributes: true })

      return {
        messenger,
        open() {
          if (isOpen) return
          isOpen = true
          if (document.activeElement instanceof HTMLElement) opener = document.activeElement
          savedOverflow = document.body.style.overflow
          document.body.style.overflow = 'hidden'
          root.showModal()
        },
        close,
        destroy() {
          close()
          inertObserver.disconnect()
          messenger.destroy()
          root.remove()
        },
        syncRequests(requests) {
          const requiresConfirm = requests.some((x) => x.status === 'pending')
          if (!isOpen && requiresConfirm) this.open()
          messenger.send('rpc-requests', { chainId: store.getState().chainId, requests })
        },
      }
    },
  })
}

/** Opens the auth app in a new browser window. */
export function popup(options: popup.Options = {}): Dialog {
  if (typeof window === 'undefined') return noop()

  const { size = { width: 360, height: 440 } } = options

  return from({
    name: 'popup',
    setup(parameters) {
      const { host, store } = parameters
      const hostUrl = new URL(host)

      let win: Window | null = null
      let pollTimer: ReturnType<typeof setInterval> | undefined
      let messenger: Messenger.Bridge = Messenger.noop()

      function onBlur() {
        if (win) handleBlur(store)
      }

      return {
        get messenger() {
          return messenger
        },
        open() {
          const left = Math.round((window.innerWidth - size.width) / 2 + window.screenX)
          const top = Math.round(window.screenY + 100)
          const features = `width=${size.width},height=${size.height},left=${left},top=${top}`
          win = window.open(host, '_blank', features)
          if (!win) throw new Error('Failed to open popup')

          messenger = Messenger.bridge({
            from: Messenger.fromWindow(window, { targetOrigin: hostUrl.origin }),
            to: Messenger.fromWindow(win, { targetOrigin: hostUrl.origin }),
            waitForReady: true,
          })

          messenger.on('rpc-response', (response) => handleResponse(store, response))

          messenger.send('__internal', {
            type: 'init',
            chainId: store.getState().chainId,
            mode: 'popup',
          })

          pollTimer = setInterval(() => {
            if (win?.closed) {
              clearInterval(pollTimer)
              pollTimer = undefined
              win = null
              handleBlur(store)
            }
          }, 100)

          window.removeEventListener('focus', onBlur)
          window.addEventListener('focus', onBlur)
        },
        close() {
          win?.close()
          win = null
        },
        destroy() {
          win?.close()
          win = null
          if (pollTimer) {
            clearInterval(pollTimer)
            pollTimer = undefined
          }
          window.removeEventListener('focus', onBlur)
          messenger.destroy()
        },
        syncRequests(requests) {
          const requiresConfirm = requests.some((x) => x.status === 'pending')
          if (requiresConfirm) {
            if (!win || win.closed) this.open()
            win?.focus()
          }
          messenger.send('rpc-requests', { chainId: store.getState().chainId, requests })
        },
      }
    },
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
  return from({
    name: 'noop',
    setup() {
      return {
        messenger: Messenger.noop(),
        open() {},
        close() {},
        destroy() {},
        syncRequests() {},
      }
    },
  })
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
