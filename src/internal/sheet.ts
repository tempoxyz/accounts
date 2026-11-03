/**
 * The dialog of `Actions.dialog.signIn` in `iframe` mode: a compact modal on a wide screen, and a
 * bottom sheet on a narrow one, that frames Tempo ID's `/embed`. The frame loads while the dialog is
 * hidden, before the sign-in has a request. `show` posts the request to the frame, and the dialog
 * shows once the page shows it. `hide` keeps the frame loaded, and the next `show` posts its request
 * to the same frame. When the frame cannot load, or the sign-in needs a page that the frame cannot
 * show, the dialog offers a popup, which opens from the user's click. An actor of `SheetMachine`
 * holds the lifecycle, and this module provides its DOM work, its messages, and its popup.
 * @module
 */
/* istanbul ignore file -- The dialog, its frame, and the popup window exist only in a browser. */
import { assertEvent, createActor, fromCallback } from 'xstate'
import * as Popup from './popup.js'
import * as SheetMachine from './sheet.machine.js'

/** The stylesheets that {@link adopt} constructed, which a document adopts once. */
const adopted = new WeakSet<CSSStyleSheet>()

/** The attribute that marks the dialog, which the styles select. */
const attribute = 'data-tempo-id-dialog'

/** The curve of the dialog's entrance and exit, which eases out like a native sheet. */
const curve = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * The dialog's styles: a card of 380 pixels, or a bottom sheet below 480 pixels of width. The frame
 * draws the sign-in, so the dialog only places and sizes it. A closed dialog keeps its size off
 * screen, so a hidden frame lays out at the width that it shows at. A browser with `corner-shape`
 * draws squircle corners, with a larger radius for the same visual size. A click on the backdrop
 * targets the dialog, so the dialog takes no selection, which repeated clicks would draw over the
 * frame.
 */
const css = `
dialog[${attribute}] {
  background: Canvas;
  border: 0;
  border-radius: 20px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.24);
  color: CanvasText;
  color-scheme: light dark;
  max-height: min(680px, calc(100dvh - 32px));
  max-width: calc(100vw - 32px);
  overflow: hidden;
  padding: 0;
  -webkit-user-select: none;
  user-select: none;
  width: 380px;
}
dialog[${attribute}]:not([open]) {
  display: block;
  left: -10000px;
  position: fixed;
  top: 0;
  visibility: hidden;
}
dialog[${attribute}]::backdrop {
  background: rgb(0 0 0 / 0.4);
}
dialog[${attribute}] iframe {
  border: 0;
  color-scheme: normal;
  display: block;
  max-height: inherit;
  width: 100%;
}
dialog[${attribute}] [data-panel] {
  display: flex;
  flex-direction: column;
  font: 15px/1.4 system-ui, sans-serif;
  gap: 16px;
  padding: 24px;
  text-align: center;
}
dialog[${attribute}] [data-panel] p {
  margin: 0;
}
dialog[${attribute}] [data-panel] button {
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  padding: 12px 16px;
}
dialog[${attribute}] [data-panel] button[data-primary] {
  background: CanvasText;
  color: Canvas;
}
dialog[${attribute}] [data-panel] button:not([data-primary]) {
  background: transparent;
  color: inherit;
}
@media (max-width: 480px) {
  dialog[${attribute}] {
    border-radius: 20px 20px 0 0;
    margin: auto 0 0;
    max-height: 90dvh;
    max-width: 100vw;
    padding-bottom: env(safe-area-inset-bottom);
    width: 100vw;
  }
}
@supports (corner-shape: squircle) {
  dialog[${attribute}] {
    border-radius: 32px;
    corner-shape: squircle;
  }
  dialog[${attribute}] [data-panel] button {
    border-radius: 20px;
    corner-shape: squircle;
  }
  @media (max-width: 480px) {
    dialog[${attribute}] {
      border-radius: 32px 32px 0 0;
    }
  }
}
@media (prefers-reduced-motion: no-preference) {
  dialog[${attribute}][open] {
    animation: tempo-id-card-in 320ms ${curve};
  }
  dialog[${attribute}][open]::backdrop {
    animation: tempo-id-fade-in 320ms ${curve};
  }
  dialog[${attribute}][data-closing] {
    animation: tempo-id-card-out ${SheetMachine.exit}ms ${curve} forwards;
  }
  dialog[${attribute}][data-closing]::backdrop {
    animation: tempo-id-fade-out ${SheetMachine.exit}ms ${curve} forwards;
  }
  @media (max-width: 480px) {
    dialog[${attribute}][open] {
      animation: tempo-id-sheet-in 500ms ${curve};
    }
    dialog[${attribute}][data-closing] {
      animation: tempo-id-sheet-out ${SheetMachine.exit}ms ${curve} forwards;
    }
  }
}
@keyframes tempo-id-card-in {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
}
@keyframes tempo-id-card-out {
  to { opacity: 0; transform: translateY(8px) scale(0.97); }
}
@keyframes tempo-id-sheet-in {
  from { transform: translateY(100%); }
}
@keyframes tempo-id-sheet-out {
  to { transform: translateY(100%); }
}
@keyframes tempo-id-fade-in {
  from { opacity: 0; }
}
@keyframes tempo-id-fade-out {
  to { opacity: 0; }
}
`

/**
 * Creates the hidden dialog, and loads the frame of `options.url` in it. `show` posts the request to
 * the frame once its page loads, and the dialog shows once the page shows the request, or once the
 * frame fails, which shows the offer of a popup instead.
 */
export function create(options: create.Options): create.ReturnType {
  const { url } = options
  const origin = new URL(url).origin

  adopt()

  const dialog = document.createElement('dialog')
  dialog.setAttribute(attribute, '')
  dialog.setAttribute('aria-label', 'Sign in with Tempo')
  // A hidden dialog stays out of the accessibility tree and out of focus, frame included, until it
  // shows.
  dialog.setAttribute('aria-hidden', 'true')
  dialog.inert = true

  const frame = document.createElement('iframe')
  // The frame runs the passkey ceremony for Tempo ID's origin, and may never navigate this page.
  frame.setAttribute('allow', `publickey-credentials-get ${origin}`)
  frame.setAttribute('sandbox', 'allow-forms allow-same-origin allow-scripts')
  frame.setAttribute('title', 'Sign in with Tempo')
  frame.style.height = '376px'

  const listener = (event: MessageEvent) => {
    // Only this frame's page, at Tempo ID's origin, sends the sign-in's messages.
    if (event.origin !== origin || event.source !== frame.contentWindow) return
    const message = parse(event.data)
    if (message) actor.send(message)
  }

  // The offer of a popup, which `offer` fills in place of the frame.
  const panel = document.createElement('div')
  panel.setAttribute('data-panel', '')
  const text = document.createElement('p')
  const primary = document.createElement('button')
  primary.setAttribute('data-primary', '')
  primary.type = 'button'
  primary.textContent = 'Continue'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  panel.appendChild(text)
  panel.appendChild(primary)
  panel.appendChild(cancel)

  const actor = createActor(
    SheetMachine.machine.provide({
      actions: {
        animate: () => {
          // The exit plays before the dialog leaves the top layer, and the frame takes no input in
          // it, since the sign-in already ended.
          dialog.inert = true
          dialog.setAttribute('data-closing', '')
        },
        blocked: () => {
          text.textContent =
            'The browser blocked the window. Allow pop-ups for this site, and select Continue again.'
        },
        conceal: () => {
          dialog.close()
          dialog.removeAttribute('data-closing')
          dialog.setAttribute('aria-hidden', 'true')
          dialog.inert = true
        },
        end: ({ context }) => {
          // The frame stays loaded, so it ends the request's sign-in, and an action that waits for
          // the request's check runs nothing.
          if (!context.current) return
          frame.contentWindow?.postMessage(
            { id: context.current.id, type: 'tempo-id:embed.end' },
            origin,
          )
        },
        offer: ({ event }) => {
          assertEvent(event, 'fallback')
          frame.remove()
          text.textContent =
            event.reason === 'popup'
              ? 'Continue in a new window to finish signing in.'
              : 'Sign in with Tempo in a new window.'
          dialog.appendChild(panel)
        },
        onCallback: ({ context, event }) => {
          assertEvent(event, ['embed.callback', 'popup.callback'])
          context.current?.handlers.onCallback(event.url)
        },
        onClose: ({ context }) => context.current?.handlers.onClose(),
        opened: () => {
          text.textContent = 'Continue in the new window.'
          primary.remove()
        },
        post: ({ context }) => {
          if (!context.current || context.request === undefined) return
          // Only Tempo ID's page receives the request, since the target is its exact origin.
          frame.contentWindow?.postMessage(
            {
              id: context.current.id,
              request: context.request,
              type: 'tempo-id:embed.request',
            },
            origin,
          )
        },
        remove: () => {
          dialog.close()
          dialog.remove()
        },
        resize: ({ event }) => {
          assertEvent(event, 'embed.resize')
          frame.style.height = `${event.height}px`
        },
        reveal: () => {
          if (dialog.open) return
          dialog.removeAttribute('aria-hidden')
          dialog.inert = false
          dialog.showModal()
        },
        unlisten: () => window.removeEventListener('message', listener),
      },
      actors: {
        popup: fromCallback<{ type: 'received' }, { url: string }>(
          (options) => {
            const { input, receive, sendBack } = options
            // A popup blocker accepts `window.open` only within the click, which sends the event
            // that starts this actor.
            const popup = Popup.openPopup(input.url)
            if (!popup) {
              sendBack({ type: 'popup.blocked' })
              return
            }
            sendBack({ type: 'popup.opened' })
            // The popup's page posts the callback here, and a user who closes the popup closes the
            // sign-in.
            const unwatch = Popup.watchPopup(popup, {
              onCallback: (url) => sendBack({ type: 'popup.callback', url }),
              onClose: () => sendBack({ type: 'popup.close' }),
              origin,
            })
            receive(() => unwatch())
            return () => {
              unwatch()
              popup.close()
            }
          },
        ),
      },
    }),
  ).start()

  window.addEventListener('message', listener)

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    actor.send({ type: 'dismiss' })
  })
  // A click on the backdrop targets the dialog itself, outside its content.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) actor.send({ type: 'dismiss' })
  })
  cancel.addEventListener('click', () => actor.send({ type: 'dismiss' }))
  primary.addEventListener('click', () => actor.send({ type: 'popup.open' }))

  frame.addEventListener('load', () => {
    // A `load` of the frame's first document, `about:blank`, does not count. It is the only document
    // that this page can read, since Tempo ID's page and the browser's refusal are on another origin.
    const blank = (() => {
      try {
        return frame.contentWindow?.location.href === 'about:blank'
      } catch {
        return false
      }
    })()
    if (!blank) actor.send({ type: 'frame.load' })
  })

  frame.src = url
  dialog.appendChild(frame)
  document.body.appendChild(dialog)

  /** Returns whether the dialog is open and plays its exit, which reduced motion turns off. */
  const animate = () => dialog.open && motion()

  return {
    close() {
      actor.send({ animate: animate(), type: 'close' })
    },
    connected: () => dialog.isConnected,
    hide() {
      if (SheetMachine.failed(actor.getSnapshot())) return false
      actor.send({ animate: animate(), type: 'hide' })
      return true
    },
    received() {
      actor.send({ type: 'received' })
    },
    show(value) {
      actor.send({
        id: crypto.randomUUID(),
        onCallback: value.onCallback,
        onClose: value.onClose,
        popupUrl: value.popupUrl,
        request: value.request,
        timeout: value.timeout,
        type: 'show',
      })
    },
    trusted: () => SheetMachine.trusted(actor.getSnapshot()),
  }
}

export declare namespace create {
  type Options = {
    /** The `/embed` URL of the frame, which names the app and the redirect URI. */
    url: string
  }

  /** Where the dialog routes the user's actions. */
  type Handlers = SheetMachine.Handlers

  type ReturnType = {
    /** Closes the dialog, after its exit, and removes it with its frame and any popup it opened. */
    close: () => void
    /**
     * Returns whether the dialog is still in the document. A page can remove it, such as a framework
     * that mounts into the body after the dialog loads.
     */
    connected: () => boolean
    /**
     * Hides the dialog, after its exit, and keeps its frame loaded, which takes the next `show`'s
     * request. Returns `false`, and changes nothing, for a dialog that offers a popup in place of its
     * frame.
     */
    hide: () => boolean
    /**
     * Stops watching the popup that the dialog offered, once the callback arrived through another
     * channel, such as the broadcast that a callback page sends when its opener is severed. A close of
     * that popup then ends nothing.
     */
    received: () => void
    /**
     * Posts the request to the frame, shows the dialog once the page shows it, and routes the
     * user's actions to the handlers.
     */
    show: (options: show.Options) => void
    /**
     * Returns whether Tempo ID trusts the app not to cover the frame, as the loaded page reports it,
     * or `undefined` before the page loads.
     */
    trusted: () => boolean | undefined
  }

  namespace show {
    type Options = Handlers & {
      /** The `/oauth2/authorize` URL of the request, which a fallback popup opens. */
      popupUrl: string
      /** The authorization request, as the query of `popupUrl`. */
      request: string
      /** Milliseconds that the page has to show the request, before the dialog offers the popup. */
      timeout: number
    }
  }
}

/**
 * Shows a modal dialog on the page while `options.popup` is open, so the page takes no input and
 * states where the user continues. Show window focuses the popup, from the click, which a browser
 * accepts within a gesture. A click on the backdrop focuses it too. Cancel and Escape run
 * `onCancel`. A browser can refuse to raise the popup, or the page's `Cross-Origin-Opener-Policy`
 * can sever the handle, and the text still names the window. Returns the function that closes the
 * dialog, after its exit.
 */
export function waiting(options: waiting.Options): waiting.ReturnType {
  const { onCancel, popup } = options

  adopt()

  const dialog = document.createElement('dialog')
  dialog.setAttribute(attribute, '')
  dialog.setAttribute('aria-label', 'Continue with Tempo')

  const panel = document.createElement('div')
  panel.setAttribute('data-panel', '')
  const text = document.createElement('p')
  text.setAttribute('aria-live', 'polite')
  text.textContent = 'Continue in the Tempo ID window.'
  const primary = document.createElement('button')
  primary.setAttribute('data-primary', '')
  primary.type = 'button'
  primary.textContent = 'Show window'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'

  primary.addEventListener('click', () => popup.focus())
  cancel.addEventListener('click', () => onCancel())
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    onCancel()
  })
  // A click on the backdrop targets the dialog itself, outside its content.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) popup.focus()
  })

  panel.appendChild(text)
  panel.appendChild(primary)
  panel.appendChild(cancel)
  dialog.appendChild(panel)
  document.body.appendChild(dialog)
  dialog.showModal()

  return () => {
    if (closed) return
    closed = true
    const remove = () => {
      dialog.close()
      dialog.remove()
    }
    if (!motion()) return remove()
    dialog.inert = true
    dialog.setAttribute('data-closing', '')
    setTimeout(remove, SheetMachine.exit)
  }
}

export declare namespace waiting {
  type Options = {
    /** Runs when the user selects Cancel, or presses Escape. */
    onCancel: () => void
    /** The popup window that the user continues in. */
    popup: Window
  }

  /** Closes the dialog, after its exit. Later calls do nothing. */
  type ReturnType = () => void
}

/**
 * Shows the dialog with a frame of Tempo ID's deposit pages at `options.url`, for a first-party
 * app's `funding.open` in `frame` mode. The frame's page reports that it loaded, its height, and the
 * return to the app, each from Tempo ID's origin. A frame that loads without that report, such as
 * one that Tempo ID refuses to frame, or the sign-in page without a session, shows the offer of a
 * popup, which opens from the user's click. Returns the function that closes the dialog, after its
 * exit.
 */
export function frame(options: frame.Options): frame.ReturnType {
  const { onCallback, onCancel, onPopup, origin } = options

  adopt()

  const dialog = document.createElement('dialog')
  dialog.setAttribute(attribute, '')
  dialog.setAttribute('aria-label', 'Add funds with Tempo')

  const element = document.createElement('iframe')
  // Apple Pay and Google Pay need the `payment` permission in a frame, and their sheets open popups
  // from the frame's own clicks. The frame runs third-party scripts and nests the card issuer's page,
  // so it may never navigate this page.
  element.setAttribute('allow', 'payment')
  element.setAttribute(
    'sandbox',
    'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts',
  )
  element.setAttribute('title', 'Tempo ID')
  element.style.height = '420px'
  element.src = options.url

  // Whether the frame's current document reported that it shows a deposit page. Each document reports
  // as it parses, before its `load`, which resets the report for the next document.
  let shown = false
  let closed = false
  const listener = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== element.contentWindow)
      return
    const data = event.data as {
      height?: unknown
      type?: unknown
      url?: unknown
    } | null
    if (data?.type === 'tempo-id:frame.open') shown = true
    else if (
      data?.type === 'tempo-id:frame.resize' &&
      typeof data.height === 'number'
    )
      element.style.height = `${Math.max(0, Math.ceil(data.height))}px`
    else if (
      data?.type === 'tempo-id:frame.callback' &&
      typeof data.url === 'string'
    )
      onCallback(data.url)
  }
  window.addEventListener('message', listener)

  // A document that fires `load` without the report shows no deposit page, such as the sign-in page
  // after the session ends, which Tempo ID refuses to frame.
  element.addEventListener('load', () => {
    const reported = shown
    shown = false
    if (reported || closed) return
    const panel = document.createElement('div')
    panel.setAttribute('data-panel', '')
    const text = document.createElement('p')
    text.setAttribute('aria-live', 'polite')
    text.textContent = 'Continue in a Tempo ID window to add funds.'
    const primary = document.createElement('button')
    primary.setAttribute('data-primary', '')
    primary.type = 'button'
    primary.textContent = 'Continue'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    primary.addEventListener('click', () => onPopup())
    cancel.addEventListener('click', () => onCancel())
    panel.appendChild(text)
    panel.appendChild(primary)
    panel.appendChild(cancel)
    element.replaceWith(panel)
  })

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    onCancel()
  })
  // A click on the backdrop targets the dialog itself, outside its content.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) onCancel()
  })

  dialog.appendChild(element)
  document.body.appendChild(dialog)
  dialog.showModal()

  return () => {
    if (closed) return
    closed = true
    window.removeEventListener('message', listener)
    const remove = () => {
      dialog.close()
      dialog.remove()
    }
    if (!motion()) return remove()
    dialog.inert = true
    dialog.setAttribute('data-closing', '')
    setTimeout(remove, SheetMachine.exit)
  }
}

export declare namespace frame {
  type Options = {
    /** Runs with the return to the app: the redirect URI with `deposit_status`. */
    onCallback: (url: string) => void
    /** Runs when the user selects Cancel, presses Escape, or clicks the backdrop. */
    onCancel: () => void
    /** Runs in the click of Continue, when the frame shows no deposit page, so a popup can open. */
    onPopup: () => void
    /** Tempo ID's origin, whose page in the frame posts the messages. */
    origin: string
    /** The deposit page's URL, with `display=frame`. */
    url: string
  }

  /** Closes the dialog, after its exit. Later calls do nothing. */
  type ReturnType = () => void
}

/**
 * Adds the dialog's styles to the document once. A constructed stylesheet is CSSOM, which a page's
 * `style-src` policy does not block, so a page with a strict policy still lays out the dialog. A
 * browser without constructed stylesheets takes a `<style>` element.
 */
function adopt() {
  if (
    'adoptedStyleSheets' in document &&
    'replaceSync' in CSSStyleSheet.prototype
  ) {
    if (document.adoptedStyleSheets.some((sheet) => adopted.has(sheet))) return
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    adopted.add(sheet)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    return
  }

  if (document.querySelector(`style[${attribute}]`)) return
  const style = document.createElement('style')
  style.setAttribute(attribute, '')
  style.textContent = css
  document.head.appendChild(style)
}

/**
 * Returns `data` as a message from the page, with the `tempo-id:` prefix removed from its type, or
 * `undefined` for any other value.
 */
function parse(data: unknown): SheetMachine.Message | undefined {
  if (typeof data !== 'object' || data === null || !('type' in data))
    return undefined
  const value = data as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id : undefined
  if (value.type === 'tempo-id:embed.loaded')
    return { trusted: value.trusted === true, type: 'embed.loaded' }
  if (
    value.type === 'tempo-id:embed.resize' &&
    typeof value.height === 'number'
  )
    return { height: value.height, type: 'embed.resize' }
  if (value.type === 'tempo-id:embed.popup') return { id, type: 'embed.popup' }
  // Every other message concerns a request, so it names one.
  if (id === undefined) return undefined
  if (value.type === 'tempo-id:embed.close') return { id, type: 'embed.close' }
  if (value.type === 'tempo-id:embed.ready') return { id, type: 'embed.ready' }
  if (value.type === 'tempo-id:embed.callback' && typeof value.url === 'string')
    return { id, type: 'embed.callback', url: value.url }
  return undefined
}

/** Returns whether the dialog plays its entrance and exit, which reduced motion turns off. */
function motion() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
