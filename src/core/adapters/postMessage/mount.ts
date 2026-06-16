import { defaultSize, hasWebAuthnShim, isInsecureContext, isSafari } from '../../Dialog.js'
import * as IO from '../../IntersectionObserver.js'

/**
 * Wallet-window mounts for the postMessage adapter — the UI half of a wata
 * postMessage session.
 *
 * A mount owns where the wallet page lives (hidden overlay iframe or popup
 * window) and how it surfaces: the adapter drives `show`/`hide` from its
 * request queue, and the wata transport acquires and releases the window
 * handle through `target`/`close`. Mirrors the bespoke `Dialog.iframe` /
 * `Dialog.popup` UX without the bespoke messenger coupling.
 */

/** Mounted wallet-window UI driven by the adapter's request queue. */
export type Mount = {
  /** Tears down the session's window handle (wata transport close). */
  close: (handle: Window | MessagePort) => void
  /** Removes all mounted DOM. */
  destroy: () => void
  /** Puts the UI away once the request queue drains. */
  hide: () => void
  /** Mode the wallet page renders its approval chrome in. */
  mode: 'iframe' | 'popup'
  /** Surfaces and focuses the UI for a pending request. */
  show: () => void
  /** Acquires the window handle for the wata session, mounting UI as needed. */
  target: () => Window | null
}

/** Creates a {@link Mount} bound to the wallet page URL. */
export type Factory = ((parameters: Factory.Parameters) => Mount) & {
  /** Mode advertised to the wallet page (`?mode=`), known pre-instantiation. */
  mode: 'iframe' | 'popup'
}

export declare namespace Factory {
  /** Parameters for a mount factory. */
  export type Parameters = {
    /** Wallet page URL (already origin- and mode-tagged). */
    host: string
    /** Called when the user dismisses the UI without answering. */
    onDismiss: () => void
    /**
     * Called when the mounted wallet page was reloaded out from under the
     * session (e.g. React hydration re-appending the iframe) and the
     * session must re-handshake.
     */
    onInvalidate: () => void
  }
}

/**
 * Picks the default mount: an overlay iframe unless the context can't
 * support one — insecure contexts and Safari lack WebAuthn in cross-origin
 * iframes, and without IntersectionObserver v2 the wallet can't run its
 * occlusion defense.
 */
export function auto(): Factory {
  if (typeof window === 'undefined') return popup()
  if (isInsecureContext() || isSafari() || hasWebAuthnShim() || !IO.supported()) return popup()
  return iframe()
}

/** Mounts the wallet page in a hidden full-viewport overlay iframe. */
export function iframe(): Factory {
  return Object.assign(
    (parameters: Factory.Parameters): Mount => {
      const { host, onDismiss, onInvalidate } = parameters
      const origin = new URL(host).origin

      const root = document.createElement('dialog')
      // Distinct marker from the bespoke `Dialog.iframe` (`data-tempo-wallet`)
      // so the two mount systems never collide in the DOM or in cleanup.
      root.dataset.tempoWalletPostmessage = ''
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
      frame.dataset.testid = 'tempo-wallet-postmessage'
      frame.setAttribute(
        'allow',
        [
          `publickey-credentials-get ${origin}`,
          `publickey-credentials-create ${origin}`,
          'clipboard-write',
          'payment',
        ].join('; '),
      )
      frame.setAttribute('allowtransparency', 'true')
      frame.setAttribute('tabindex', '0')
      frame.setAttribute('title', 'Tempo Wallet')
      frame.src = host
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
        dialog[data-tempo-wallet-postmessage]::backdrop {
          background: transparent!important;
        }
      `
      root.appendChild(style)
      root.appendChild(frame)
      document.body.appendChild(root)

      // Re-mount if removed (e.g. React hydration clears non-server-rendered
      // elements). Re-appending reloads the wallet page, so the session must
      // re-handshake through a fresh handle.
      const remountObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.removedNodes) {
            if (node !== root) continue
            document.body.appendChild(root)
            onInvalidate()
            return
          }
        }
      })
      remountObserver.observe(document.body, { childList: true })

      // 1Password extension adds `inert` to `dialog`, rendering it unusable.
      const inertObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== 'attributes') continue
          if (mutation.attributeName !== 'inert') continue
          root.removeAttribute('inert')
        }
      })
      inertObserver.observe(root, { attributeOldValue: true, attributes: true })

      const onCancel = (event: Event) => {
        event.preventDefault()
        onDismiss()
      }
      const onClick = () => onDismiss()

      let opener: HTMLElement | null = null
      let savedOverflow = ''
      let visible = false

      function show() {
        if (visible) return frame.focus()
        visible = true
        if (document.activeElement instanceof HTMLElement) opener = document.activeElement
        root.removeAttribute('hidden')
        root.removeAttribute('aria-closed')
        root.showModal()
        root.addEventListener('cancel', onCancel)
        root.addEventListener('click', onClick)
        root.style.pointerEvents = 'auto'
        frame.focus()
        savedOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }

      function hide() {
        if (!visible) return
        visible = false
        root.removeEventListener('cancel', onCancel)
        root.removeEventListener('click', onClick)
        root.style.pointerEvents = 'none'
        root.setAttribute('hidden', 'true')
        root.setAttribute('aria-closed', 'true')
        root.close()
        opener?.focus()
        opener = null
        document.body.style.overflow = savedOverflow

        // 1Password sometimes adds `inert` to dialog siblings and does not
        // clean up when the dialog closes.
        for (const sibling of root.parentNode ? Array.from(root.parentNode.children) : []) {
          if (sibling === root) continue
          if (sibling.hasAttribute('inert')) sibling.removeAttribute('inert')
        }
      }

      return {
        close() {
          hide()
        },
        destroy() {
          hide()
          remountObserver.disconnect()
          inertObserver.disconnect()
          root.remove()
        },
        hide,
        mode: 'iframe',
        show,
        target: () => frame.contentWindow,
      }
    },
    { mode: 'iframe' as const },
  )
}

/** Opens the wallet page in a centered popup window per request burst. */
export function popup(options: popup.Options = {}): Factory {
  const { size = defaultSize } = options

  return Object.assign(
    (parameters: Factory.Parameters): Mount => {
      const { host, onDismiss } = parameters

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
      const message = document.createElement('p')
      Object.assign(message.style, { margin: '0' })
      message.textContent = 'Continue in the popup window'
      const close = document.createElement('button')
      Object.assign(close.style, {
        background: 'none',
        border: 'none',
        color: 'white',
        cursor: 'pointer',
        font: 'inherit',
        padding: '0',
        textDecoration: 'underline',
      })
      close.textContent = 'Close'
      close.addEventListener('click', () => onDismiss())
      overlay.appendChild(message)
      overlay.appendChild(close)
      document.body.appendChild(overlay)

      let win: Window | null = null

      function hide() {
        overlay.style.display = 'none'
        win?.close()
        win = null
      }

      return {
        close() {
          hide()
        },
        destroy() {
          hide()
          overlay.remove()
        },
        hide,
        mode: 'popup',
        show() {
          if (win && !win.closed) win.focus()
        },
        target: () => {
          const left = (window.innerWidth - size.width) / 2 + window.screenX
          const top = window.screenY + 100
          win = window.open(
            host,
            '_blank',
            `width=${size.width},height=${size.height},left=${left},top=${top}`,
          )
          if (win) overlay.style.display = 'flex'
          return win
        },
      }
    },
    { mode: 'popup' as const },
  )
}

export declare namespace popup {
  /** Options for {@link popup}. */
  export type Options = {
    /** Popup window dimensions. @default `{ width: 360, height: 440 }` */
    size?: { width: number; height: number } | undefined
  }
}
