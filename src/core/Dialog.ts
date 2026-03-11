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

      let savedOverflow = ''

      return {
        open() {
          savedOverflow = document.body.style.overflow
          document.body.style.overflow = 'hidden'
          root.showModal()
        },
        close() {
          root.close()
          document.body.style.overflow = savedOverflow
        },
        destroy() {
          root.remove()
        },
      }
    },
  })
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
