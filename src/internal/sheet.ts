/**
 * The dialog of `Actions.dialog.signIn` in `iframe` mode: a compact modal on a wide screen, and a
 * bottom sheet on a narrow one, that frames Tempo ID's `/embed`. The frame loads while the dialog is
 * hidden, before the sign-in has a request. `show` posts the request to the frame, and the dialog
 * shows once the page shows it. `hide` keeps the frame loaded, and the next `show` posts its request
 * to the same frame. When the frame cannot load, or the sign-in needs a page that the frame cannot
 * show, the dialog offers a popup, which opens from the user's click. An actor of `machines.sheet`
 * holds the lifecycle, and this module provides its DOM work, its messages, and its popup.
 * @module
 */
/* istanbul ignore file -- The dialog, its frame, and the popup window exist only in a browser. */
import {
  type Actor as XStateActor,
  and,
  assertEvent,
  assign,
  createActor,
  fromCallback,
  raise,
  sendTo,
  setup,
  stateIn,
} from 'xstate'
import * as Popup from './popup.js'

/** The stylesheets that {@link adopt} constructed, which a document adopts once. */
const adopted = new WeakSet<CSSStyleSheet>()

/** The attribute that marks the dialog, which the styles select. */
const attribute = 'data-tempo-id-dialog'

/** Milliseconds of the dialog's exit, which `hide` and `close` wait for. */
const exit = 240

/** The curve of the dialog's entrance and exit, which eases out like a native sheet. */
const curve = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * The dialog's styles: a card of 380 pixels, or a bottom sheet below 480 pixels of width. The frame
 * draws the sign-in, so the dialog only places and sizes it. A closed dialog keeps its size off
 * screen, so a hidden frame lays out at the width that it shows at. A browser with `corner-shape`
 * draws squircle corners, with a larger radius for the same visual size. A click on the backdrop
 * targets the dialog, so the dialog takes no selection, which repeated clicks would draw over the
 * frame. The dialog's fill is the design system's `background.elevated`, which the frame's page
 * draws too, so the dialog shows no seam while the frame loads. IntersectionObserver v2 reports the
 * frame not visible under an opacity below 1 or a scale, and `/embed` waits for a visible frame
 * before it acts. So the card's entrance translates without a scale, and its fade takes 120
 * milliseconds of the 320 that the translate takes.
 */
const css = `
dialog[${attribute}] {
  background: light-dark(#ffffff, #141414);
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
dialog[${attribute}] [data-skeleton] {
  background: inherit;
  display: flex;
  flex-direction: column;
  gap: 12px;
  inset: 0;
  padding: 12px 24px 24px;
  position: absolute;
}
dialog[${attribute}] [data-skeleton] > div {
  background: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.08));
  border-radius: 10px;
  flex: none;
}
dialog[${attribute}] [data-skeleton] [data-bar] {
  height: 20px;
  margin-bottom: 20px;
  width: 120px;
}
dialog[${attribute}] [data-skeleton] [data-title] {
  height: 28px;
  width: 50%;
}
dialog[${attribute}] [data-skeleton] [data-text] {
  height: 16px;
  margin-bottom: 12px;
  width: 75%;
}
dialog[${attribute}] [data-skeleton] [data-row] {
  height: 56px;
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
    animation:
      tempo-id-card-in 320ms ${curve},
      tempo-id-fade-in 120ms ${curve};
  }
  dialog[${attribute}][open]::backdrop {
    animation: tempo-id-fade-in 320ms ${curve};
  }
  dialog[${attribute}] [data-skeleton] > div {
    animation: tempo-id-pulse 1s ease-in-out infinite alternate;
  }
  dialog[${attribute}][data-closing] {
    animation: tempo-id-card-out ${exit}ms ${curve} forwards;
  }
  dialog[${attribute}][data-closing]::backdrop {
    animation: tempo-id-fade-out ${exit}ms ${curve} forwards;
  }
  @media (max-width: 480px) {
    dialog[${attribute}][open] {
      animation: tempo-id-sheet-in 500ms ${curve};
    }
    dialog[${attribute}][data-closing] {
      animation: tempo-id-sheet-out ${exit}ms ${curve} forwards;
    }
  }
}
@keyframes tempo-id-card-in {
  from { transform: translateY(8px); }
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
@keyframes tempo-id-pulse {
  to { opacity: 0.5; }
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
    machines.sheet.provide({
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
          context.current?.handlers.onCallback(
            event.url,
            event.type === 'embed.callback' ? event.funding : undefined,
          )
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
      if (machines.failed(actor.getSnapshot())) return false
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
    trusted: () => machines.trusted(actor.getSnapshot()),
  }
}

export declare namespace create {
  type Options = {
    /** The `/embed` URL of the frame, which names the app and the redirect URI. */
    url: string
  }

  /** Where the dialog routes the user's actions. */
  type Handlers = machines.sheet.Handlers

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

  let closed = false
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
    setTimeout(remove, exit)
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
 * Shows a modal dialog that offers a popup, for a call that runs outside a user gesture, where a
 * popup blocker refuses `window.open`. Continue runs `onContinue` in its click, so the popup opens.
 * Cancel and Escape run `onCancel`. Returns the function that closes the dialog, after its exit.
 */
export function prompt(options: prompt.Options): prompt.ReturnType {
  const { label, onCancel, onContinue, text: message } = options

  adopt()

  const dialog = document.createElement('dialog')
  dialog.setAttribute(attribute, '')
  dialog.setAttribute('aria-label', label)

  const panel = document.createElement('div')
  panel.setAttribute('data-panel', '')
  const text = document.createElement('p')
  text.setAttribute('aria-live', 'polite')
  text.textContent = message
  const primary = document.createElement('button')
  primary.setAttribute('data-primary', '')
  primary.type = 'button'
  primary.textContent = 'Continue'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'

  primary.addEventListener('click', () => onContinue())
  cancel.addEventListener('click', () => onCancel())
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    onCancel()
  })

  panel.appendChild(text)
  panel.appendChild(primary)
  panel.appendChild(cancel)
  dialog.appendChild(panel)
  document.body.appendChild(dialog)
  dialog.showModal()

  let closed = false
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
    setTimeout(remove, exit)
  }
}

export declare namespace prompt {
  type Options = {
    /** The dialog's accessible name. */
    label: string
    /** Runs when the user selects Cancel, or presses Escape. */
    onCancel: () => void
    /** Runs in the click of Continue, so a popup can open. */
    onContinue: () => void
    /** The sentence that states where the user continues. */
    text: string
  }

  /** Closes the dialog, after its exit. Later calls do nothing. */
  type ReturnType = () => void
}

/**
 * Shows the dialog with a frame of Tempo ID's deposit pages at `options.url`, for an app's
 * `funding.open` in `frame` mode. The frame's page reports that it loaded, its height, and the
 * return to the app, each from Tempo ID's origin. A frame that loads without that report, such as
 * one that Tempo ID refuses to frame, or the sign-in page without a session, shows the offer of a
 * popup, which opens from the user's click. So does a frame that requests a popup, since the app's
 * page can cover it. Returns the function that closes the dialog, after its
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

  // The skeleton covers the frame until its first document reports that it shows a deposit page, so
  // the dialog never shows an empty frame.
  const skeleton = document.createElement('div')
  skeleton.setAttribute('aria-label', 'Loading')
  skeleton.setAttribute('data-skeleton', '')
  skeleton.setAttribute('role', 'progressbar')
  for (const part of ['bar', 'title', 'text', 'row', 'row', 'row']) {
    const block = document.createElement('div')
    block.setAttribute(`data-${part}`, '')
    skeleton.appendChild(block)
  }

  // Whether the frame's current document reported that it shows a deposit page. Each document reports
  // as it parses, before its `load`, which resets the report for the next document.
  let shown = false
  let closed = false
  // Offers a popup in place of the frame, which opens `popup` from the user's click.
  const offer = (popup: Omit<frame.Popup, 'automatic'> = {}) => {
    skeleton.remove()
    if (closed || !element.isConnected) return
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
    primary.addEventListener('click', () =>
      onPopup({ ...popup, automatic: false }),
    )
    cancel.addEventListener('click', () => onCancel())
    panel.appendChild(text)
    panel.appendChild(primary)
    panel.appendChild(cancel)
    element.replaceWith(panel)
  }
  const listener = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== element.contentWindow)
      return
    const data = event.data as {
      amount?: unknown
      height?: unknown
      method?: unknown
      type?: unknown
      url?: unknown
    } | null
    if (data?.type === 'tempo-id:embed.ready') {
      shown = true
      skeleton.remove()
    } else if (
      data?.type === 'tempo-id:embed.resize' &&
      typeof data.height === 'number'
    )
      element.style.height = `${Math.max(0, Math.ceil(data.height))}px`
    else if (
      data?.type === 'tempo-id:embed.callback' &&
      typeof data.url === 'string'
    )
      onCallback(data.url)
    // The frame cannot show that nothing covers it, or found it covered at an action. A method, such
    // as Buy MACH, that runs only in a popup opens at once, within the click in the frame.
    else if (data?.type === 'tempo-id:embed.popup') {
      const popup: Omit<frame.Popup, 'automatic'> =
        data.method === 'mach'
          ? {
              ...(typeof data.amount === 'string'
                ? { amount: data.amount }
                : {}),
              method: 'mach' as const,
            }
          : {}
      if (popup.method && onPopup({ ...popup, automatic: true })) return
      offer(popup)
    }
    // The frame's close button or Escape, which the frame's page receives in place of the dialog.
    else if (data?.type === 'tempo-id:embed.close') onCancel()
  }
  window.addEventListener('message', listener)

  // A document that fires `load` without the report shows no deposit page, such as the sign-in page
  // after the session ends, which Tempo ID refuses to frame.
  element.addEventListener('load', () => {
    const reported = shown
    shown = false
    if (!reported) offer()
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
  dialog.appendChild(skeleton)
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
    setTimeout(remove, exit)
  }
}

export declare namespace frame {
  type Options = {
    /** Runs with the return to the app: the redirect URI with `deposit_status`. */
    onCallback: (url: string) => void
    /**
     * Runs when the user selects Cancel, presses Escape, clicks the backdrop, or selects the frame's
     * close button.
     */
    onCancel: () => void
    /**
     * Opens the popup, and returns whether it opened. It runs in the click of Continue, or with
     * `automatic` for a method that the frame requests, within the user's click in the frame.
     */
    onPopup: (options: Popup) => boolean
    /** Tempo ID's origin, whose page in the frame posts the messages. */
    origin: string
    /** The deposit page's URL at `/embed/deposit`. */
    url: string
  }

  /** The popup that `onPopup` opens. */
  type Popup = {
    /** With `method`, the amount in USD that its first step shows, such as `7.50`. */
    amount?: string | undefined
    /** Whether the frame requested the popup, so a blocked popup shows the offer instead. */
    automatic: boolean
    /** The method that the popup opens, such as `mach` for Buy MACH. */
    method?: 'mach' | undefined
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
function parse(data: unknown): machines.sheet.Message | undefined {
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
  if (
    value.type === 'tempo-id:embed.callback' &&
    typeof value.url === 'string'
  ) {
    const funding = address(value.funding)
    return {
      ...(funding ? { funding: { address: funding } } : {}),
      id,
      type: 'embed.callback',
      url: value.url,
    }
  }
  return undefined
}

/** Returns the account address of a callback's `funding`, or `undefined` for any other value. */
function address(funding: unknown) {
  if (typeof funding !== 'object' || funding === null) return undefined
  const value = (funding as Record<string, unknown>).address
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
    return undefined
  return value as `0x${string}`
}

/** Returns whether the dialog plays its entrance and exit, which reduced motion turns off. */
function motion() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The state machines that this module runs. */
export namespace machines {
  /** Milliseconds after the frame's `load` event that its page has to send `loaded`. */
  export const loadDelay = 3_000

  /**
   * The machine. While `open`, two regions run in parallel: `dialog`, the request that the dialog
   * shows, and `frame`, the frame that shows it or the popup that replaces it. A frame that fails
   * stays failed, so the dialog shows its offer of a popup at once on each later `show`.
   *
   * | State                  | Meaning                                                                 |
   * | ---------------------- | ----------------------------------------------------------------------- |
   * | `dialog.idle`          | No request. The dialog is hidden.                                       |
   * | `dialog.pending`       | A request waits for the page to show it, until its `timeout`.           |
   * | `dialog.revealed`      | The dialog shows the request, or the offer of a popup.                  |
   * | `dialog.hiding`        | The dialog plays its exit, then goes idle.                              |
   * | `frame.loading`        | The page has not loaded. `checking` waits for it after the frame's `load`. |
   * | `frame.loaded`         | The page takes requests.                                                |
   * | `frame.failed`         | The offer of a popup replaces the frame. `popup` watches the popup.     |
   * | `closing` and `closed` | `close` plays the exit, if the dialog is open, then removes the dialog. |
   */
  export const sheet = setup({
    actions: {
      /** Plays the dialog's exit, and keeps the frame from input. `sheet.ts` provides it. */
      animate: () => {},
      /** Shows that the browser blocked the popup. `sheet.ts` provides it. */
      blocked: () => {},
      /** Ends the current request. */
      clear: assign({ current: undefined, request: undefined }),
      /** Takes the dialog out of the top layer, the accessibility tree, and focus. `sheet.ts` provides it. */
      conceal: () => {},
      /** Posts the end of the current request to the page. `sheet.ts` provides it. */
      end: () => {},
      /** Raises `fallback` for `params.reason`. */
      fail: raise((_, params: { reason: 'popup' | 'unavailable' }) => ({
        reason: params.reason,
        type: 'fallback' as const,
      })),
      /** Replaces the frame with the offer of a popup, on `fallback`. `sheet.ts` provides it. */
      offer: () => {},
      /** Runs the current request's `onCallback`, on `embed.callback` or `popup.callback`. `sheet.ts` provides it. */
      onCallback: () => {},
      /** Runs the current request's `onClose`. `sheet.ts` provides it. */
      onClose: () => {},
      /** Shows that the popup opened, and removes Continue. `sheet.ts` provides it. */
      opened: () => {},
      /** Posts `context.request` to the page. `sheet.ts` provides it. */
      post: () => {},
      /** Stops the popup's watch, and keeps the popup open. */
      receive: sendTo('popup', { type: 'received' }),
      /** Removes the dialog and its frame from the document. `sheet.ts` provides it. */
      remove: () => {},
      /** Sets the frame's height, on `embed.resize`. `sheet.ts` provides it. */
      resize: () => {},
      /** Shows the dialog, and admits it to the accessibility tree and to focus. `sheet.ts` provides it. */
      reveal: () => {},
      /** Marks the request posted. */
      sent: assign({ request: undefined }),
      /** Starts the request of `show`. */
      start: assign(({ event }) => {
        if (event.type !== 'show') return {}
        return {
          current: {
            handlers: {
              onCallback: event.onCallback,
              onClose: event.onClose,
            },
            id: event.id,
            popupUrl: event.popupUrl,
            timeout: event.timeout,
          },
          request: event.request,
        }
      }),
      /** Holds the trust that the loaded page reports. */
      trust: assign(({ event }) => {
        if (event.type !== 'embed.loaded') return {}
        return { trusted: event.trusted }
      }),
      /** Stops taking the page's messages. `sheet.ts` provides it. */
      unlisten: () => {},
    },
    actors: {
      /**
       * Opens the popup of `input.url`, watches it, and closes it once its state ends. It sends
       * `popup.opened` or `popup.blocked`, then `popup.callback` and `popup.close`, and stops watching
       * on `received`. `sheet.ts` provides it.
       */
      popup: fromCallback<{ type: 'received' }, { url: string }>(() => {}),
    },
    delays: {
      exit,
      load: loadDelay,
      timeout: ({ context }) => context.current?.timeout ?? 0,
    },
    guards: {
      animate: ({ event }) =>
        (event.type === 'close' || event.type === 'hide') && event.animate,
      current: ({ context }) => context.current !== undefined,
      failed: stateIn('#sheet.open.frame.failed'),
      // A popup without an ID concerns the frame, which takes no request.
      frame: ({ context, event }) =>
        event.type === 'embed.popup' &&
        (event.id === undefined || event.id === context.current?.id),
      loaded: stateIn('#sheet.open.frame.loaded'),
      // A message about a request names its ID, so one about an earlier sign-in in the same frame
      // acts on nothing.
      ours: ({ context, event }) =>
        'id' in event && event.id === context.current?.id,
      unsent: ({ context }) =>
        context.current !== undefined && context.request !== undefined,
    },
    types: {
      context: {} as machines.sheet.Context,
      events: {} as machines.sheet.Event,
    },
  }).createMachine({
    context: { current: undefined, request: undefined, trusted: undefined },
    id: 'sheet',
    initial: 'open',
    states: {
      // Not final: a stopped actor warns on each event, and the dialog's callers can still call it.
      closed: { entry: 'remove' },
      closing: {
        after: { exit: 'closed' },
        entry: 'animate',
      },
      open: {
        exit: 'unlisten',
        on: {
          close: [
            { guard: 'animate', target: 'closing' },
            { target: 'closed' },
          ],
          dismiss: { actions: 'onClose', guard: 'current' },
          'embed.callback': {
            actions: 'onCallback',
            guard: 'ours',
          },
          'embed.close': { actions: 'onClose', guard: 'ours' },
          'embed.popup': {
            actions: { params: { reason: 'popup' }, type: 'fail' },
            guard: 'frame',
          },
          'embed.resize': {
            actions: 'resize',
          },
          'popup.callback': {
            actions: 'onCallback',
            guard: 'current',
          },
          'popup.close': { actions: 'onClose', guard: 'current' },
        },
        states: {
          dialog: {
            initial: 'idle',
            states: {
              hiding: {
                after: { exit: { actions: 'conceal', target: 'idle' } },
                entry: 'animate',
                on: {
                  // The exit continues, and conceals the dialog once it ends, unless the dialog stops
                  // animating.
                  hide: [
                    { guard: 'failed' },
                    { guard: 'animate' },
                    { actions: 'conceal', target: 'idle' },
                  ],
                  // A dialog that still plays its exit leaves the top layer at once, so its frame is
                  // out of view and takes the request.
                  show: [
                    {
                      actions: ['conceal', 'start'],
                      guard: 'failed',
                      target: 'revealed',
                    },
                    {
                      actions: ['conceal', 'start', 'post', 'sent'],
                      guard: 'loaded',
                      target: 'pending',
                    },
                    { actions: ['conceal', 'start'], target: 'pending' },
                  ],
                },
              },
              idle: {
                on: { hide: [{ guard: 'failed' }, { actions: 'conceal' }] },
              },
              pending: {
                after: {
                  timeout: {
                    actions: {
                      params: { reason: 'unavailable' },
                      type: 'fail',
                    },
                  },
                },
                on: {
                  'embed.ready': { guard: 'ours', target: 'revealed' },
                  fallback: 'revealed',
                },
              },
              revealed: { entry: 'reveal' },
            },
            // `idle` and `hiding` handle `hide` and `show` themselves. A request that the dialog shows
            // ends with `hide`, or gives way to the next `show`. A dialog that offers a popup keeps its
            // request, since the popup can still finish it.
            on: {
              hide: [
                { guard: 'failed' },
                {
                  actions: ['end', 'clear'],
                  guard: and(['loaded', 'animate']),
                  target: '.hiding',
                },
                {
                  actions: ['end', 'clear', 'conceal'],
                  guard: 'loaded',
                  target: '.idle',
                },
                { actions: 'clear', guard: 'animate', target: '.hiding' },
                { actions: ['clear', 'conceal'], target: '.idle' },
              ],
              show: [
                { actions: 'start', guard: 'failed', target: '.revealed' },
                {
                  actions: ['start', 'post', 'sent'],
                  guard: 'loaded',
                  target: '.pending',
                },
                { actions: 'start', target: '.pending' },
              ],
            },
          },
          frame: {
            initial: 'loading',
            states: {
              failed: {
                initial: 'offered',
                states: {
                  offered: {
                    on: {
                      'popup.open': { guard: 'current', target: 'popup' },
                    },
                  },
                  popup: {
                    invoke: {
                      id: 'popup',
                      input: ({ context }) => ({
                        url: context.current?.popupUrl ?? '',
                      }),
                      src: 'popup',
                    },
                    on: {
                      'popup.blocked': {
                        actions: 'blocked',
                        target: 'offered',
                      },
                      'popup.opened': { actions: 'opened' },
                      received: { actions: 'receive' },
                    },
                  },
                },
              },
              loaded: {
                on: {
                  'embed.loaded': { actions: 'trust' },
                  fallback: {
                    actions: 'offer',
                    target: 'failed',
                  },
                },
              },
              loading: {
                initial: 'blank',
                on: {
                  'embed.loaded': [
                    {
                      actions: ['trust', 'post', 'sent'],
                      guard: 'unsent',
                      target: 'loaded',
                    },
                    { actions: 'trust', target: 'loaded' },
                  ],
                  fallback: {
                    actions: 'offer',
                    target: 'failed',
                  },
                },
                states: {
                  blank: { on: { 'frame.load': 'checking' } },
                  // Tempo ID refuses a frame with `frame-ancestors 'none'`, which loads an error page
                  // without a message, so a frame without `loaded` soon after `load` fails.
                  checking: {
                    // A `hide` ends the check, as it ends the request's timeout. The next request's
                    // timeout then offers the popup.
                    on: { hide: 'blank' },
                    after: {
                      load: {
                        actions: {
                          params: { reason: 'unavailable' },
                          type: 'fail',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        type: 'parallel',
      },
    },
  })

  /** The types of {@link sheet}. */
  export namespace sheet {
    /** The deposit page that the frame's sign-in leaves to the app, since the frame cannot show it. */
    export type Funding = {
      /** The Tempo Account that holds less than the funding hint. */
      address: `0x${string}`
    }

    /** Where the dialog routes the user's actions. */
    export type Handlers = {
      /**
       * Receives the callback URL that the frame or the popup posts, with the account that the frame
       * names for the deposit page of a funding hint.
       */
      onCallback: (url: string, funding?: Funding) => void
      /** Runs when the user closes the dialog, the frame's sign-in, or the popup. */
      onClose: () => void
    }

    /** The context of the machine. The states hold the rest. */
    export type Context = {
      /** The sign-in that the dialog shows, from `show` until `hide`. Absent while idle and hiding. */
      current:
        | {
            /** Where the dialog routes the user's actions. */
            handlers: Handlers
            /** The ID of the request, which the page names in each message about it. */
            id: string
            /** The `/oauth2/authorize` URL of the request, which a fallback popup opens. */
            popupUrl: string
            /** Milliseconds that the page has to show the request, before the dialog offers the popup. */
            timeout: number
          }
        | undefined
      /** The authorization request that the page has not received yet, until the page loads. */
      request: string | undefined
      /**
       * Whether Tempo ID trusts the app not to cover the frame, as the loaded page reports it, or
       * `undefined` before the page loads.
       */
      trusted: boolean | undefined
    }

    /** A message from the page of `/embed`, without the `tempo-id:` prefix of its wire type. */
    export type Message =
      | {
          /** The deposit page that the app opens after the sign-in. Absent for none. */
          funding?: Funding | undefined
          /** The ID of the request that the sign-in finished. */
          id: string
          /** The sign-in finished. */
          type: 'embed.callback'
          /** The redirect URI with `code` and `state`, or with `error`. */
          url: string
        }
      | {
          /** The ID of the request whose sign-in the user closed. */
          id: string
          /** The user closed the sign-in. */
          type: 'embed.close'
        }
      | {
          /** Whether Tempo ID trusts the app not to cover the frame, which skips its check of visibility. */
          trusted: boolean
          /** The page loaded, and takes a request. */
          type: 'embed.loaded'
        }
      | {
          /** The ID of the request that needs the popup. Absent when the frame cannot take any request. */
          id?: string | undefined
          /** The sign-in needs a page that the frame cannot show. */
          type: 'embed.popup'
        }
      | {
          /** The ID of the request that the page shows. */
          id: string
          /** The page shows the request. */
          type: 'embed.ready'
        }
      | {
          /** The document's height, in CSS pixels. */
          height: number
          /** The page changed its size. */
          type: 'embed.resize'
        }

    /** An event of the machine: a message from the page, a call of the dialog, or a DOM or popup event. */
    export type Event =
      | Message
      | {
          /** Whether the dialog is open and plays its exit, which reduced motion turns off. */
          animate: boolean
          /** `close` ends the dialog, and removes it after its exit. */
          type: 'close'
        }
      | {
          /** The user closed the dialog with the Escape key, a click on the backdrop, or Cancel. */
          type: 'dismiss'
        }
      | {
          /** Why the dialog offers the popup: the sign-in needs it, or the frame cannot show the sign-in. */
          reason: 'popup' | 'unavailable'
          /** The frame gives way to the offer of a popup, for good. */
          type: 'fallback'
        }
      | {
          /** The frame loaded a document other than its first, `about:blank`. */
          type: 'frame.load'
        }
      | {
          /** Whether the dialog is open and plays its exit, which reduced motion turns off. */
          animate: boolean
          /** `hide` ends the request, and keeps the frame loaded for the next one. */
          type: 'hide'
        }
      | {
          /** The browser blocked the popup that the user's click opened. */
          type: 'popup.blocked'
        }
      | {
          /** The redirect URI that the popup's callback page posted. */
          url: string
          /** The popup delivered the callback. */
          type: 'popup.callback'
        }
      | {
          /** The user closed the popup. */
          type: 'popup.close'
        }
      | {
          /** The user selected Continue on the offer of a popup. */
          type: 'popup.open'
        }
      | {
          /** The popup opened. */
          type: 'popup.opened'
        }
      | {
          /** The callback arrived through another channel, so the dialog stops watching the popup. */
          type: 'received'
        }
      | (Handlers & {
          /** The ID of the request, which `sheet.ts` generates. */
          id: string
          /** The `/oauth2/authorize` URL of the request, which a fallback popup opens. */
          popupUrl: string
          /** The authorization request, as the query of `popupUrl`. */
          request: string
          /** Milliseconds that the page has to show the request, before the dialog offers the popup. */
          timeout: number
          /** `show` starts a request. */
          type: 'show'
        })

    /** A running instance of {@link machine}. */
    export type Actor = XStateActor<typeof sheet>

    /** A snapshot of {@link machine}. */
    export type Snapshot = ReturnType<Actor['getSnapshot']>
  }

  /** Returns whether the dialog offers a popup in place of its frame, which then takes no request. */
  export function failed(snapshot: machines.sheet.Snapshot) {
    return snapshot.matches({ open: { frame: 'failed' } })
  }

  /**
   * Returns whether Tempo ID trusts the app not to cover the frame, as the loaded page reports it,
   * or `undefined` before the page loads.
   */
  export function trusted(snapshot: machines.sheet.Snapshot) {
    return snapshot.context.trusted
  }
}
