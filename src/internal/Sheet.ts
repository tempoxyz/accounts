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
import * as Callback from './Callback.js'
import * as Popup from './Popup.js'

/** The stylesheets that {@link adopt} constructed, which a document adopts once. */
const adopted = new WeakSet<CSSStyleSheet>()

/** The attribute that marks the dialog, which the styles select. */
const attribute = 'data-tempo-id-dialog'

/** Milliseconds of the dialog's exit, which `hide` and `close` wait for. */
const exit = 240

/** Milliseconds after the frame's `load` event that its document's report has to arrive. */
const reportDelay = 500

/** The curve of the dialog's entrance and exit, which eases out like a native sheet. */
const curve = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * The skeleton of the payment page, where its page in the 400-pixel frame draws its own skeleton,
 * which skullet measures from the screen: the bar's address and close button, the header's logo,
 * title, and text, two cards and their rows, and the buttons. The second card draws two rows, the
 * currency and the account, whatever the payment's memo and fee. Each offset is in pixels from the
 * frame's top and from its side, and a bone without a side centers. The page's skeleton replaces
 * this one with no visible change.
 */
const payment = {
  bones: [
    { height: 24, left: 8, radius: 999, top: 8, width: 118 },
    { height: 16, radius: 999, right: 8, top: 12, width: 16 },
    { height: 48, radius: 999, top: 56, width: 48 },
    { height: 21, top: 125, width: 177 },
    { height: 15, top: 161, width: 281 },
    { height: 145, kind: 'surface', left: 24, right: 24, top: 203 },
    { height: 27, top: 237, width: 84 },
    { height: 12, left: 37, top: 292, width: 14 },
    { height: 11, right: 61, top: 292, width: 79 },
    { height: 16, radius: 0, right: 37, top: 289, width: 16 },
    { height: 12, left: 37, top: 320, width: 27 },
    { height: 12, right: 37, top: 320, width: 109 },
    { height: 90, kind: 'surface', left: 24, right: 24, top: 360 },
    { height: 1, kind: 'line', left: 25, right: 25, top: 406 },
    { height: 12, left: 37, top: 378, width: 52 },
    { height: 20, radius: 0, right: 80, top: 373, width: 20 },
    { height: 12, right: 37, top: 378, width: 35 },
    { height: 12, left: 37, top: 422, width: 47 },
    { height: 12, right: 37, top: 422, width: 267 },
    { height: 40, left: 24, radius: 999, top: 474, width: 'calc(50% - 28px)' },
    { height: 40, radius: 999, right: 24, top: 474, width: 'calc(50% - 28px)' },
  ],
  /** The page's height, which the frame takes until the page reports its own. */
  height: 546,
} as const

/**
 * The dialog's styles: a card of 400 pixels, or a bottom sheet below 480 pixels of width. The frame
 * draws the sign-in, so the dialog only places and sizes it. The card sets its own `margin: auto`,
 * which centers it, because a page's CSS reset removes the browser's. A closed dialog stays on screen
 * at its size, transparent and without pointer events, since Chromium paints no cross-origin frame
 * that is off screen or hidden. So a preloaded frame paints its request and reports its height before
 * the dialog shows. The dialog takes no transition, which a page's reduced-motion reset adds to every
 * element, so it leaves the top layer in one frame. The frame's page insets its address 8 pixels,
 * with a 12-pixel radius, so it is concentric with the dialog's 20-pixel corner. A browser with
 * `corner-shape` draws squircle corners at 1.84 times the radius, which meets the round corner's 45
 * degree point, as the design system draws them. A click on the backdrop
 * targets the dialog, so the dialog takes no selection, which repeated clicks would draw over the
 * frame. The dialog's fill is the design system's `background.elevated`, which the frame's page
 * draws too, so the dialog shows no seam while the frame loads. {@link scheme} sets the dialog's
 * color scheme, and the frame inherits it, so its page draws in the same scheme. IntersectionObserver v2 reports the
 * frame not visible under an opacity below 1 or a scale, and `/embed` waits for a visible frame
 * before it acts. So the card's entrance translates without a scale, and its fade takes 120
 * milliseconds of the 320 that the translate takes.
 */
const css = `
dialog[${attribute}] {
  background: light-dark(#ffffff, #1a1a1a);
  border: 0;
  border-radius: 20px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.24);
  color: CanvasText;
  margin: auto;
  max-height: min(680px, calc(100dvh - 32px));
  max-width: calc(100vw - 32px);
  overflow: hidden;
  padding: 0;
  transition: none !important;
  -webkit-user-select: none;
  user-select: none;
  width: 400px;
}
dialog[${attribute}]:not([open]) {
  display: block;
  left: 0;
  opacity: 0;
  pointer-events: none;
  position: fixed;
  top: 0;
}
dialog[${attribute}]::backdrop {
  background: rgb(0 0 0 / 0.4);
}
dialog[${attribute}] iframe {
  border: 0;
  color-scheme: inherit;
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
  padding: 8px 24px 24px;
  position: absolute;
}
dialog[${attribute}] [data-skeleton] > div {
  background: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.08));
  border-radius: 10px;
  flex: none;
}
dialog[${attribute}] [data-skeleton] [data-bar] {
  border-radius: 12px;
  height: 24px;
  margin-bottom: 12px;
  margin-left: -16px;
  width: 118px;
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
dialog[${attribute}] [data-skeleton][data-payment] {
  display: block;
  padding: 0;
}
dialog[${attribute}] [data-skeleton][data-payment] > div {
  border-radius: 6px;
  position: absolute;
}
/* The cards and their dividers take the design system's container and line colors, as the page draws them. */
dialog[${attribute}] [data-skeleton][data-payment] > [data-surface] {
  background: light-dark(#f5f5f5, #2b2b2b);
  border-radius: 22px;
  box-shadow: inset 0 0 0 1px light-dark(#e2e2e2, #353535);
}
dialog[${attribute}] [data-skeleton][data-payment] > [data-line] {
  background: light-dark(#e1e1e1, #3b3b3b);
  border-radius: 0;
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
    border-radius: 36.8px;
    corner-shape: squircle;
  }
  dialog[${attribute}] [data-panel] button {
    border-radius: 20px;
    corner-shape: squircle;
  }
  dialog[${attribute}] [data-skeleton][data-payment] > [data-surface] {
    corner-shape: squircle;
  }
  @media (max-width: 480px) {
    dialog[${attribute}] {
      border-radius: 36.8px 36.8px 0 0;
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
  dialog[${attribute}] [data-skeleton] > div:not([data-line], [data-surface]) {
    animation: tempo-id-pulse 1.2s ease-in-out infinite alternate;
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
  to { opacity: 0.45; }
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
  dialog.style.colorScheme = scheme()

  const frame = document.createElement('iframe')
  // The frame runs the passkey ceremonies for Tempo ID's origin, a sign-in and a new user's passkey
  // account, and may never navigate this page. Its legal links open in a new, unsandboxed tab.
  frame.setAttribute(
    'allow',
    `publickey-credentials-create ${origin}; publickey-credentials-get ${origin}`,
  )
  frame.setAttribute(
    'sandbox',
    'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts',
  )
  frame.setAttribute('title', 'Sign in with Tempo')
  frame.style.height = '376px'

  const listener = (event: MessageEvent) => {
    // Only this frame's page, at Tempo ID's origin, sends the sign-in's messages. A removed frame has
    // no window, and a message without a source is no frame's.
    const source = frame.contentWindow
    if (!source || event.origin !== origin || event.source !== source) return
    const message = parse(event.data)
    if (!message) return
    // A click in the frame also activates this page, so the popup can open within that gesture.
    actor.send(
      message.type === 'embed.popup'
        ? { ...message, activated: Popup.activated() }
        : message,
    )
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
        arm: ({ context }) => {
          primary.disabled = context.current?.popupUrl === undefined
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
        offer: ({ context, event }) => {
          assertEvent(event, 'fallback')
          // The popup of Google's sign-in asks the frame whether the user clicked Google in it, which
          // then starts Google at once. The frame stays loaded for that, out of view.
          if (event.method === 'google') frame.style.display = 'none'
          else frame.remove()
          // A deferred request's popup has no URL until its challenge arrives, so Continue waits too.
          primary.disabled = context.current?.popupUrl === undefined
          text.textContent =
            event.reason === 'popup'
              ? 'Continue in a new window to finish signing in.'
              : 'Sign in with Tempo in a new window.'
          dialog.appendChild(panel)
        },
        onCallback: ({ context, event }) => {
          assertEvent(event, ['embed.callback', 'popup.callback'])
          context.current?.handlers.onCallback(
            event.callback,
            event.type === 'embed.callback' ? event.funding : undefined,
          )
        },
        onClose: ({ context }) => context.current?.handlers.onClose(),
        opened: () => {
          text.textContent = 'Continue in the new window.'
          primary.remove()
        },
        post: ({ context }) => {
          if (!context.current) return
          // Only Tempo ID's page receives the request, since the target is its exact origin. A
          // deferred request's challenge follows the request.
          if (context.request !== undefined)
            frame.contentWindow?.postMessage(
              {
                ...(context.current.deferred ? { deferred: true } : {}),
                id: context.current.id,
                request: context.request,
                type: 'tempo-id:embed.request',
              },
              origin,
            )
          if (context.challenge !== undefined)
            frame.contentWindow?.postMessage(
              {
                id: context.current.id,
                request: context.challenge,
                type: 'tempo-id:embed.challenge',
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
          // The app's page can change its scheme while the frame loads hidden.
          dialog.style.colorScheme = scheme()
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
              onCallback: (callback) =>
                sendBack({ callback, type: 'popup.callback' }),
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

  frame.src = schemed(url)
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
    challenge(value) {
      actor.send({
        id: value.id,
        popupUrl: value.popupUrl,
        request: value.request,
        type: 'challenge',
      })
    },
    received() {
      actor.send({ type: 'received' })
    },
    show(value) {
      const id = crypto.randomUUID()
      actor.send({
        deferred: value.deferred === true,
        id,
        onCallback: value.onCallback,
        onClose: value.onClose,
        popupUrl: value.popupUrl,
        request: value.request,
        timeout: value.timeout,
        type: 'show',
      })
      return id
    },
    trusted: () => machines.trusted(actor.getSnapshot()),
    usable: () => dialog.isConnected && !machines.failed(actor.getSnapshot()),
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
    /**
     * Posts the challenge of the deferred request of the `show` of `id` to the frame, once the
     * app's server issues it, and arms the popup's URL. A challenge of an earlier `show` changes
     * nothing.
     */
    challenge: (options: {
      /** The ID that the deferred `show` returned. */
      id: string
      /** The `/oauth2/authorize` URL of the full request, which a fallback popup opens. */
      popupUrl: string
      /** The full request: the deferred request with its challenge, as the query of `popupUrl`. */
      request: string
    }) => void
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
     * user's actions to the handlers. A deferred request shows at once, and `challenge` completes
     * it later. Returns the request's ID.
     */
    show: (options: show.Options) => string
    /**
     * Returns whether Tempo ID trusts the app not to cover the frame, as the loaded page reports it,
     * or `undefined` before the page loads.
     */
    trusted: () => boolean | undefined
    /**
     * Returns whether the dialog is still in the document and its frame has not failed, so the next
     * `show` can take the frame.
     */
    usable: () => boolean
  }

  namespace show {
    type Options = Handlers &
      (
        | {
            /** Absent, `false`. */
            deferred?: false | undefined
            /** The `/oauth2/authorize` URL of the request, which a fallback popup opens. */
            popupUrl: string
          }
        | {
            /**
             * Whether the request waits for its challenge, which `challenge` posts. The page shows
             * the request at once, and checks it once the challenge arrives.
             */
            deferred: true
            /** Absent, since `challenge` supplies the full request's URL. */
            popupUrl?: undefined
          }
      ) & {
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
  dialog.style.colorScheme = scheme()

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
  dialog.style.colorScheme = scheme()

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
 * Loads the dialog with a frame of Tempo ID's page at `options.url`, hidden, and returns the handle that
 * shows it: the deposit pages, for an app's `funding.open` in `frame` mode or its `funding.preload`, or
 * the approval page of an access key. The frame's page reports that it loaded, its height, and the
 * return to the app, each from Tempo ID's origin. A frame that loads without that report, such as one
 * that Tempo ID refuses to frame, or the sign-in page without a session, shows the offer of a popup,
 * which opens from the user's click. So does a frame that requests a popup, since the app's page can
 * cover it. A hidden dialog stays out of the accessibility tree and out of focus, frame included.
 * With `covered`, the page takes no input until `uncover`, and Tempo ID's page shows its own
 * skeleton until then. With `deferred`, the page shows at once, and receives the challenge with
 * `uncover`.
 */
export function load(options: load.Options): load.ReturnType {
  const { origin } = options

  adopt()

  const dialog = document.createElement('dialog')
  dialog.setAttribute(attribute, '')
  dialog.setAttribute('aria-hidden', 'true')
  dialog.setAttribute('aria-label', options.label)
  dialog.inert = true
  dialog.style.colorScheme = scheme()

  const element = document.createElement('iframe')
  // The frame may never navigate this page.
  element.setAttribute('allow', options.allow)
  // Tempo ID reads the frame's session only for a document whose `Referer` names this page's
  // origin, so the frame sends the origin under any policy of this page.
  element.setAttribute('referrerpolicy', 'origin')
  element.setAttribute('sandbox', options.sandbox)
  element.setAttribute('title', 'Tempo ID')
  element.style.height = '420px'
  element.src = schemed(options.url)
  // An inert frame's page takes no focus or input, so a covered page cannot approve.
  element.inert = options.covered === true

  // The skeleton covers the frame until its first document reports that it shows Tempo ID's page, so
  // the dialog never shows an empty frame.
  const skeleton = document.createElement('div')
  skeleton.setAttribute('aria-label', 'Loading')
  skeleton.setAttribute('data-skeleton', '')
  skeleton.setAttribute('role', 'progressbar')
  if (options.skeleton === 'payment') {
    skeleton.setAttribute('data-payment', '')
    element.style.height = `${payment.height}px`
    for (const bone of payment.bones) {
      const block = document.createElement('div')
      if ('kind' in bone) block.setAttribute(`data-${bone.kind}`, '')
      block.style.height = `${bone.height}px`
      block.style.top = `${bone.top}px`
      if ('radius' in bone) block.style.borderRadius = `${bone.radius}px`
      if ('width' in bone)
        block.style.width =
          typeof bone.width === 'number' ? `${bone.width}px` : bone.width
      if ('left' in bone) block.style.left = `${bone.left}px`
      if ('right' in bone) block.style.right = `${bone.right}px`
      if (!('left' in bone) && !('right' in bone)) {
        block.style.left = '50%'
        block.style.transform = 'translateX(-50%)'
      }
      skeleton.appendChild(block)
    }
  } else
    for (const part of ['bar', 'title', 'text', 'row', 'row', 'row']) {
      const block = document.createElement('div')
      block.setAttribute(`data-${part}`, '')
      skeleton.appendChild(block)
    }

  // The dialog's phase. A hidden dialog takes no input, so only a shown dialog runs the handlers of
  // the call that shows it.
  let state:
    | { handlers: load.Handlers; phase: 'shown' }
    | { phase: 'closed' | 'hidden' } = { phase: 'hidden' }
  const handlers = () => (state.phase === 'shown' ? state.handlers : undefined)
  // The report of the frame's current document that it shows Tempo ID's page. Each document posts
  // the report as it parses. A browser can still fire the document's `load` before it delivers the
  // report, such as WebKit for a document without a pending subresource. So a `load` without the
  // report waits `reportDelay` for it, and each `load` ends its document's report.
  let report:
    | { phase: 'awaited'; timer: ReturnType<typeof setTimeout> }
    | { phase: 'none' | 'reported' } = { phase: 'none' }
  // The cover of `covered` or `deferred`. The page reports that it listens for the lift with
  // `tempo-id:embed.covered`: `held` before that report, `listening` after it, and `free` once
  // `uncover` lifts the cover. The lift goes to the page only once the page listens.
  let cover: 'free' | 'held' | 'listening' =
    options.covered || options.deferred ? 'held' : 'free'
  // The challenge's message that the lift hands to the page.
  let challenge: string | undefined
  const uncover = () =>
    element.contentWindow?.postMessage(
      {
        ...(challenge !== undefined ? { challenge } : {}),
        type: 'tempo-id:embed.uncover',
      },
      origin,
    )
  // Offers a popup in place of the frame, which opens `popup` from the user's click.
  const offer = (popup: Omit<load.Popup, 'automatic'> = {}) => {
    skeleton.remove()
    if (state.phase === 'closed' || !element.isConnected) return
    const panel = document.createElement('div')
    panel.setAttribute('data-panel', '')
    const text = document.createElement('p')
    text.setAttribute('aria-live', 'polite')
    text.textContent = options.text
    const primary = document.createElement('button')
    primary.setAttribute('data-primary', '')
    primary.type = 'button'
    primary.textContent = 'Continue'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    primary.addEventListener('click', () =>
      handlers()?.onPopup({ ...popup, automatic: false }),
    )
    cancel.addEventListener('click', () => handlers()?.onCancel())
    panel.appendChild(text)
    panel.appendChild(primary)
    panel.appendChild(cancel)
    // The offer takes input only once the cover lifts, as the frame does.
    panel.inert = element.inert
    element.replaceWith(panel)
  }
  const listener = (event: MessageEvent) => {
    // A frame that the offer replaced has no window, and a message without a source is no frame's.
    const source = element.contentWindow
    if (!source || event.origin !== origin || event.source !== source) return
    const data = event.data as {
      amount?: unknown
      covered?: unknown
      height?: unknown
      method?: unknown
      type?: unknown
      url?: unknown
    } | null
    if (data?.type === 'tempo-id:embed.ready') {
      // A report after its document's `load` ends the wait.
      if (report.phase === 'awaited') {
        clearTimeout(report.timer)
        report = { phase: 'none' }
      } else report = { phase: 'reported' }
      // A covered page draws its own skeleton once it renders, and reports it with `covered`.
      if (data.covered !== true) skeleton.remove()
    } else if (data?.type === 'tempo-id:embed.covered') {
      skeleton.remove()
      if (cover === 'free') uncover()
      else cover = 'listening'
    } else if (
      data?.type === 'tempo-id:embed.resize' &&
      typeof data.height === 'number'
    )
      element.style.height = `${Math.max(0, Math.ceil(data.height))}px`
    else if (
      data?.type === 'tempo-id:embed.callback' &&
      typeof data.url === 'string'
    )
      handlers()?.onCallback(data.url)
    // The frame cannot show that nothing covers it, found it covered at an action, or needs a page of
    // its own. The popup opens at once while the page holds a gesture: the click that opened the
    // dialog, or a click in the frame, which also activates its parent. A method, such as Buy MACH
    // or a sign-in as another user, runs only in a popup. A covered page waits for another send of
    // the same payment, which a popup must not overlap. Otherwise, the dialog offers the popup.
    else if (data?.type === 'tempo-id:embed.popup') {
      const popup = ((): Omit<load.Popup, 'automatic'> => {
        if (data.method === 'switch') return { method: 'switch' }
        if (data.method !== 'mach') return {}
        return {
          ...(typeof data.amount === 'string' ? { amount: data.amount } : {}),
          method: 'mach',
        }
      })()
      if (
        machines.automatic({
          activated: Popup.activated(),
          cover,
          covered: options.covered === true,
          method: popup.method !== undefined,
        }) &&
        handlers()?.onPopup({ ...popup, automatic: true })
      )
        return
      offer(popup)
    }
    // The frame's close button or Escape, which the frame's page receives in place of the dialog.
    else if (data?.type === 'tempo-id:embed.close') handlers()?.onCancel()
  }
  window.addEventListener('message', listener)

  // A document without the report `reportDelay` after its `load` shows no page of the frame, such
  // as the sign-in page after the session ends, which Tempo ID refuses to frame.
  element.addEventListener('load', () => {
    if (report.phase === 'awaited') clearTimeout(report.timer)
    if (report.phase === 'reported') {
      report = { phase: 'none' }
      return
    }
    report = {
      phase: 'awaited',
      timer: setTimeout(() => {
        report = { phase: 'none' }
        offer()
      }, reportDelay),
    }
  })

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    handlers()?.onCancel()
  })
  // A click on the backdrop targets the dialog itself, outside its content.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) handlers()?.onCancel()
  })

  dialog.appendChild(element)
  dialog.appendChild(skeleton)
  document.body.appendChild(dialog)

  return {
    close: () => {
      if (state.phase === 'closed') return
      const open = state.phase === 'shown'
      state = { phase: 'closed' }
      window.removeEventListener('message', listener)
      if (report.phase === 'awaited') clearTimeout(report.timer)
      const remove = () => {
        dialog.close()
        dialog.remove()
      }
      if (!open || !motion()) return remove()
      dialog.inert = true
      dialog.setAttribute('data-closing', '')
      setTimeout(remove, exit)
    },
    show: (value) => {
      if (state.phase !== 'hidden') return
      state = { handlers: value, phase: 'shown' }
      // The app's page can change its scheme while a preloaded frame waits.
      dialog.style.colorScheme = scheme()
      dialog.removeAttribute('aria-hidden')
      dialog.inert = false
      dialog.showModal()
    },
    uncover: (value = {}) => {
      if (cover === 'free') return
      challenge = value.challenge
      if (cover === 'listening') uncover()
      cover = 'free'
      // The frame, or the offer of a popup that replaced it, takes input again.
      for (const child of dialog.children)
        if (child instanceof HTMLElement) child.inert = false
    },
    // The offer of a popup replaces the frame, so a frame that offers one shows no page.
    usable: () => state.phase === 'hidden' && element.isConnected,
  }
}

export declare namespace load {
  type Options = {
    /** The frame's permissions policy, such as `payment` for Apple Pay and Google Pay. */
    allow: string
    /**
     * Whether the page takes no input until `uncover`, such as while another send of the same payment
     * runs. The page shows its own skeleton until then, for a `url` with `covered`. Defaults to
     * `false`.
     */
    covered?: boolean | undefined
    /**
     * Whether the page waits for the challenge that `uncover` hands over, for a `url` with
     * `deferred`. The page shows at once, and takes input. Defaults to `false`.
     */
    deferred?: boolean | undefined
    /** The dialog's accessible name, such as `Add funds with Tempo`. */
    label: string
    /** Tempo ID's origin, whose page in the frame posts the messages. */
    origin: string
    /** The frame's sandbox, which never allows a navigation of the app's page. */
    sandbox: string
    /**
     * The skeleton before the page shows: `payment` for the payment page's own layout. Defaults to
     * a list.
     */
    skeleton?: 'payment' | undefined
    /** The offer of a popup, such as `Continue in a Tempo ID window to add funds.` */
    text: string
    /** The page's URL, such as the deposit page at `/embed/deposit`. */
    url: string
  }

  /** What the call that shows the dialog runs. */
  type Handlers = {
    /**
     * Runs with the return to the app: the redirect URI with `deposit_status`, or with
     * `transaction`, or with `error`.
     */
    onCallback: (url: string) => void
    /**
     * Runs when the user selects Cancel, presses Escape, clicks the backdrop, or selects the frame's
     * close button.
     */
    onCancel: () => void
    /**
     * Opens the popup, and returns whether it opened. It runs in the click of Continue, or with
     * `automatic` for a popup that the frame requests while the page holds a gesture, or for a method.
     */
    onPopup: (options: Popup) => boolean
  }

  /** The popup that `onPopup` opens. */
  type Popup = {
    /** With `method`, the amount in USD that its first step shows, such as `7.50`. */
    amount?: string | undefined
    /** Whether the frame requested the popup, so a blocked popup shows the offer instead. */
    automatic: boolean
    /**
     * The method that the popup opens, such as `mach` for Buy MACH, or `switch` for the payment
     * page's sign-in as another user.
     */
    method?: 'mach' | 'switch' | undefined
  }

  type ReturnType = {
    /** Closes the dialog, after its exit if it shows. Later calls do nothing. */
    close: () => void
    /** Shows the dialog, which then runs `handlers`. Later calls do nothing. */
    show: (handlers: Handlers) => void
    /**
     * Lifts the cover of `covered` or `deferred`: lets the page take input, and posts
     * `tempo-id:embed.uncover` to the page once it listens, with `challenge`, the message that the
     * account signs, if given. Later calls do nothing.
     */
    uncover: (options?: { challenge?: string | undefined }) => void
    /**
     * Whether a call can still show the dialog: it is not closed or shown, the page holds it, and
     * its frame offers no popup.
     */
    usable: () => boolean
  }
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
  if (value.type === 'tempo-id:embed.popup')
    return {
      id,
      ...(value.method === 'google' ? { method: 'google' as const } : {}),
      type: 'embed.popup',
    }
  // Every other message concerns a request, so it names one.
  if (id === undefined) return undefined
  if (value.type === 'tempo-id:embed.close') return { id, type: 'embed.close' }
  if (value.type === 'tempo-id:embed.ready') return { id, type: 'embed.ready' }
  const callback = Callback.received(value, { prefix: 'tempo-id:embed' })
  if (callback) {
    const funding = address(value.funding)
    return {
      callback,
      ...(funding ? { funding: { address: funding } } : {}),
      id,
      type: 'embed.callback',
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

/**
 * Returns the color scheme of the app's page, which the dialog takes. A browser gives a frame the
 * scheme of its `iframe` element as the preferred scheme, so Tempo ID's page draws in it too. A
 * page that declares one scheme, on its root or in its `color-scheme` meta tag, decides it. A page
 * that declares both or none takes the user's preference.
 */
function scheme() {
  const root = getComputedStyle(document.documentElement).colorScheme
  // HTML matches the meta tag's name, and CSS its keywords, without regard to case.
  const declared =
    root === 'normal'
      ? (document.querySelector<HTMLMetaElement>('meta[name="color-scheme" i]')
          ?.content ?? '')
      : root
  const names = declared.toLowerCase().split(/\s+/)
  const dark = names.includes('dark')
  if (dark !== names.includes('light')) return dark ? 'dark' : 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * Returns `url` with `color_scheme`, the scheme of the app's page, so Tempo ID's page draws in it.
 * Some browsers give a frame the browser's preference, whatever the `iframe` element's scheme.
 */
function schemed(url: string) {
  const value = new URL(url)
  value.searchParams.set('color_scheme', scheme())
  return value.href
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
      /** Plays the dialog's exit, and keeps the frame from input. `Sheet.ts` provides it. */
      animate: () => {},
      /**
       * Lets the offer of a popup take a click only while the current request holds its popup's URL,
       * which a deferred request receives with `challenge`. `Sheet.ts` provides it.
       */
      arm: () => {},
      /** Shows that the browser blocked the popup. `Sheet.ts` provides it. */
      blocked: () => {},
      /** Ends the current request. */
      clear: assign({
        challenge: undefined,
        current: undefined,
        request: undefined,
      }),
      /** Takes the dialog out of the top layer, the accessibility tree, and focus. `Sheet.ts` provides it. */
      conceal: () => {},
      /** Posts the end of the current request to the page. `Sheet.ts` provides it. */
      end: () => {},
      /** Raises `fallback` for `params.reason`, with the method and the gesture of an `embed.popup`. */
      fail: raise(({ event }, params: { reason: 'popup' | 'unavailable' }) => ({
        activated: event.type === 'embed.popup' && event.activated,
        method: event.type === 'embed.popup' ? event.method : undefined,
        reason: params.reason,
        type: 'fallback' as const,
      })),
      /** Holds the method of the popup that `fallback` offers, which the popup starts. */
      hold: assign(({ context, event }) => {
        if (event.type !== 'fallback' || !context.current) return {}
        return { current: { ...context.current, method: event.method } }
      }),
      /** Replaces the frame with the offer of a popup, on `fallback`. `Sheet.ts` provides it. */
      offer: () => {},
      /** Runs the current request's `onCallback`, on `embed.callback` or `popup.callback`. `Sheet.ts` provides it. */
      onCallback: () => {},
      /** Runs the current request's `onClose`. `Sheet.ts` provides it. */
      onClose: () => {},
      /** Shows that the popup opened, and removes Continue. `Sheet.ts` provides it. */
      opened: () => {},
      /** Posts `context.request`, then `context.challenge`, to the page. `Sheet.ts` provides it. */
      post: () => {},
      /** Stops the popup's watch, and keeps the popup open. */
      receive: sendTo('popup', { type: 'received' }),
      /** Removes the dialog and its frame from the document. `Sheet.ts` provides it. */
      remove: () => {},
      /** Sets the frame's height, on `embed.resize`. `Sheet.ts` provides it. */
      resize: () => {},
      /** Shows the dialog, and admits it to the accessibility tree and to focus. `Sheet.ts` provides it. */
      reveal: () => {},
      /** Marks the request and its challenge posted. */
      sent: assign({ challenge: undefined, request: undefined }),
      /** Starts the request of `show`. */
      start: assign(({ event }) => {
        if (event.type !== 'show') return {}
        return {
          challenge: undefined,
          current: {
            deferred: event.deferred,
            handlers: {
              onCallback: event.onCallback,
              onClose: event.onClose,
            },
            id: event.id,
            method: undefined,
            popupUrl: event.popupUrl,
            timeout: event.timeout,
          },
          request: event.request,
        }
      }),
      /** Takes the challenge of the deferred request, and its popup's URL. */
      supply: assign(({ context, event }) => {
        if (event.type !== 'challenge' || !context.current) return {}
        return {
          challenge: event.request,
          current: { ...context.current, popupUrl: event.popupUrl },
        }
      }),
      /** Holds the trust that the loaded page reports. */
      trust: assign(({ event }) => {
        if (event.type !== 'embed.loaded') return {}
        return { trusted: event.trusted }
      }),
      /** Stops taking the page's messages. `Sheet.ts` provides it. */
      unlisten: () => {},
    },
    actors: {
      /**
       * Opens the popup of `input.url`, watches it, and closes it once its state ends. It sends
       * `popup.opened` or `popup.blocked`, then `popup.callback` and `popup.close`, and stops watching
       * on `received`. `Sheet.ts` provides it.
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
      // A method's popup opens within the click in the frame that selected the method.
      automatic: ({ event }) =>
        event.type === 'fallback' &&
        event.method !== undefined &&
        event.activated,
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
      // A popup opens only for a request whose URL arrived.
      ready: ({ context }) => context.current?.popupUrl !== undefined,
      unsent: ({ context }) =>
        context.current !== undefined &&
        (context.request !== undefined || context.challenge !== undefined),
    },
    types: {
      context: {} as machines.sheet.Context,
      events: {} as machines.sheet.Event,
    },
  }).createMachine({
    context: {
      challenge: undefined,
      current: undefined,
      request: undefined,
      trusted: undefined,
    },
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
          // A loaded frame shows the deferred request already, so its challenge follows at once. A
          // dialog that offers a popup takes the challenge too, whose full request the popup opens.
          challenge: [
            {
              actions: ['supply', 'arm', 'post', 'sent'],
              guard: and(['ours', 'loaded']),
            },
            { actions: ['supply', 'arm'], guard: 'ours' },
          ],
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
                      actions: ['conceal', 'start', 'arm'],
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
                {
                  actions: ['start', 'arm'],
                  guard: 'failed',
                  target: '.revealed',
                },
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
                      'popup.open': { guard: 'ready', target: 'popup' },
                    },
                  },
                  popup: {
                    invoke: {
                      id: 'popup',
                      input: ({ context }) => ({
                        url: machines.popupUrl(context),
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
                  fallback: [
                    {
                      actions: ['hold', 'offer'],
                      guard: and(['automatic', 'ready']),
                      target: 'failed.popup',
                    },
                    {
                      actions: ['hold', 'offer'],
                      target: 'failed',
                    },
                  ],
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
      onCallback: (callback: Callback.Received, funding?: Funding) => void
      /** Runs when the user closes the dialog, the frame's sign-in, or the popup. */
      onClose: () => void
    }

    /** The context of the machine. The states hold the rest. */
    export type Context = {
      /**
       * The full request of the deferred request, with its challenge, that the page has not
       * received yet, until the page loads.
       */
      challenge: string | undefined
      /** The sign-in that the dialog shows, from `show` until `hide`. Absent while idle and hiding. */
      current:
        | {
            /** Whether the request waits for its challenge, which `challenge` carries. */
            deferred: boolean
            /** Where the dialog routes the user's actions. */
            handlers: Handlers
            /** The ID of the request, which the page names in each message about it. */
            id: string
            /** The method that the fallback popup starts, as `method` of its URL. Absent for none. */
            method: 'google' | undefined
            /**
             * The `/oauth2/authorize` URL of the request, which a fallback popup opens. Absent until
             * a deferred request's challenge arrives.
             */
            popupUrl: string | undefined
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
          /** The callback URL, or the authorization of a request in the web message mode. */
          callback: Callback.Received
          /** The deposit page that the app opens after the sign-in. Absent for none. */
          funding?: Funding | undefined
          /** The ID of the request that the sign-in finished. */
          id: string
          /** The sign-in finished. */
          type: 'embed.callback'
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
          /**
           * The sign-in method that the user selected in the frame, which the popup starts: `google`,
           * which refuses frames. Absent if the popup shows the sign-in page.
           */
          method?: 'google' | undefined
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
      | Exclude<Message, { type: 'embed.popup' }>
      | (Extract<Message, { type: 'embed.popup' }> & {
          /** Whether the page holds a gesture, such as the click in the frame that sent the message. */
          activated: boolean
        })
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
          /** Whether the page holds a gesture, so a method's popup opens at once in place of the offer. */
          activated: boolean
          /** The method that the popup starts. Absent for none. */
          method?: 'google' | undefined
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
          /** The callback that the popup's page posted. */
          callback: Callback.Received
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
      | {
          /** The ID of the deferred `show`. */
          id: string
          /** The `/oauth2/authorize` URL of the full request, which a fallback popup opens. */
          popupUrl: string
          /** The full request: the deferred request with its challenge, as the query of `popupUrl`. */
          request: string
          /** The challenge of the deferred request of the `show` of `id` arrived. */
          type: 'challenge'
        }
      | (Handlers & {
          /** Whether the request waits for its challenge, which `challenge` carries. */
          deferred: boolean
          /** The ID of the request, which `Sheet.ts` generates. */
          id: string
          /**
           * The `/oauth2/authorize` URL of the request, which a fallback popup opens. Absent for a
           * deferred request, whose `challenge` supplies it.
           */
          popupUrl?: string | undefined
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

  /** Returns the URL of the current request's fallback popup, with the method that it starts. */
  export function popupUrl(context: machines.sheet.Context) {
    const current = context.current
    if (!current?.popupUrl || !current.method) return current?.popupUrl ?? ''
    const url = new URL(current.popupUrl)
    url.searchParams.set('method', current.method)
    return url.href
  }

  /** Returns whether the dialog offers a popup in place of its frame, which then takes no request. */
  export function failed(snapshot: machines.sheet.Snapshot) {
    return snapshot.matches({ open: { frame: 'failed' } })
  }

  /**
   * Returns whether `Sheet.load`'s dialog opens the popup that its page requests at once, in place of
   * its offer. A method's popup opens at once, unless a covered page waits for another send of the
   * same payment, which a popup must not overlap. A deferred page's popup opens blank, and loads once
   * the challenge arrives. A popup without a method opens at once only once the cover lifts, while
   * the page holds a gesture.
   */
  export function automatic(options: automatic.Options) {
    if (options.method) return !options.covered || options.cover === 'free'
    return options.cover === 'free' && options.activated
  }

  export declare namespace automatic {
    type Options = {
      /** Whether the page holds a gesture, such as a click in the frame. */
      activated: boolean
      /** The cover of the page: `free` once `uncover` lifts it, or for a page without one. */
      cover: 'free' | 'held' | 'listening'
      /** Whether the page loaded with `covered`, so a send of the same payment can still run. */
      covered: boolean
      /** Whether the popup runs a method, such as Buy MACH or a sign-in as another user. */
      method: boolean
    }
  }

  /**
   * Returns whether Tempo ID trusts the app not to cover the frame, as the loaded page reports it,
   * or `undefined` before the page loads.
   */
  export function trusted(snapshot: machines.sheet.Snapshot) {
    return snapshot.context.trusted
  }
}
