import type * as Messenger from './Messenger.js'

/** Dialog interface — manages the iframe/popup lifecycle for cross-origin auth. */
export type Dialog = {
  /** Identifier for the dialog type (e.g. `'iframe'`, `'popup'`). */
  name: string
  /** Initialize the dialog with the given host and messenger. */
  setup: (parameters: setup.Parameters) => setup.ReturnType
}

export declare namespace setup {
  type Parameters = {
    /** URL of the Tempo Auth app. */
    host: string
    /** Bridge messenger for cross-frame communication. */
    messenger: Messenger.Bridge
  }

  type ReturnType = {
    /** Close the dialog (hide iframe / close popup). */
    close: () => void
    /** Destroy the dialog (remove DOM elements, clean up). */
    destroy: () => void
    /** Open the dialog (show iframe / open popup). */
    open: () => void
  }
}

/** Creates a dialog from a custom implementation. */
export function from(dialog: Dialog): Dialog {
  return dialog
}

/** Creates an iframe dialog that embeds the auth app in a `<dialog>` element. */
export function iframe(): Dialog {
  if (typeof window === 'undefined') return noop()

  return from({
    name: 'iframe',
    setup(parameters) {
      const { host } = parameters
      const hostUrl = new URL(host)

      const root = document.createElement('dialog')
      root.dataset.tempoConnect = ''

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
      document.body.appendChild(root)

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

      root.addEventListener('cancel', () => close())

      root.addEventListener('click', (event) => {
        if (event.target === root) close()
      })

      const inertObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'inert') root.removeAttribute('inert')
        }
      })
      inertObserver.observe(root, { attributes: true })

      return {
        open() {
          if (isOpen) return
          isOpen = true
          if (document.activeElement instanceof HTMLElement)
            opener = document.activeElement
          savedOverflow = document.body.style.overflow
          document.body.style.overflow = 'hidden'
          root.showModal()
        },
        close,
        destroy() {
          close()
          inertObserver.disconnect()
          root.remove()
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
      const { host } = parameters

      let win: Window | null = null
      let pollTimer: ReturnType<typeof setInterval> | undefined

      return {
        open() {
          const left = Math.round((window.innerWidth - size.width) / 2 + window.screenX)
          const top = Math.round(window.screenY + 100)
          const features = `width=${size.width},height=${size.height},left=${left},top=${top}`
          win = window.open(host, '_blank', features)
          if (!win) throw new Error('Failed to open popup')

          pollTimer = setInterval(() => {
            if (win?.closed) {
              clearInterval(pollTimer)
              pollTimer = undefined
              win = null
            }
          }, 100)
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

/** Detects Safari (which does not support WebAuthn in cross-origin iframes). */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('safari') && !ua.includes('chrome')
}

/** Returns a no-op dialog for SSR environments. */
export function noop(): Dialog {
  return from({
    name: 'noop',
    setup() {
      return {
        open() {},
        close() {},
        destroy() {},
      }
    },
  })
}
