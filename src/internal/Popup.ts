/**
 * The popup window of Tempo ID's pages: its opening, centered on the window, and the callback that
 * its page posts in place of the redirect URI's page. The dialog's fallback, the dialog in popup
 * mode, and the deposit page share it.
 * @module
 */
/* istanbul ignore file -- The popup window exists only in a browser. */
import {
  type ActorRefFrom,
  createActor,
  fromCallback,
  type SnapshotFrom,
  setup,
} from 'xstate'
import * as Callback from './Callback.js'
import * as Chains from './Chains.js'

/**
 * Milliseconds that a closed popup has to deliver a callback that its page posted as it closed,
 * before the sign-in counts as closed.
 */
const closeGrace = 1_000

/** Milliseconds between two checks of whether the user closed a popup. */
const closeInterval = 100

/**
 * Milliseconds that a popup's handle reads open on another origin's page before the popup counts as
 * open. A handle that this page's `Cross-Origin-Opener-Policy` severs reads open there for a few
 * tens of milliseconds.
 */
const settle = 500

/**
 * Opens `url` in a popup centered on the window, or returns `null` when the browser blocks it. Each
 * of Tempo ID's pages in the popup then fits the window's height to its content.
 */
export function openPopup(url: string) {
  // The content column of Tempo ID's pages, 384 pixels, and 24 pixels of padding at each side.
  const width = 432
  // About the height of the sign-in, the first page, so its fit moves the window little.
  const height = 420
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2
  return window.open(
    url,
    '_blank',
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  )
}

/**
 * Takes the callback that Tempo ID's page in `popup` posts in place of the redirect URI's page, and
 * calls `onClose` once the user closes the popup. `machines.watch` decides when a closed handle
 * counts as the user's close. Returns the function that stops the watch.
 */
export function watchPopup(popup: Window, options: watchPopup.Options) {
  const actor = createActor(
    machines.watch.provide({
      actions: {
        callback: (_args, params) => options.onCallback(params.callback),
        close: () => options.onClose(),
        closed: () => options.onClosed?.(),
      },
      actors: {
        popup: fromCallback<machines.watch.Event>((args) => {
          const listener = (event: MessageEvent) => {
            if (event.origin !== options.origin || event.source !== popup)
              return
            const data = event.data as { type?: unknown } | null
            if (data?.type === 'tempo-id:popup.open') {
              args.sendBack({ type: 'popup.open' })
              return
            }
            const callback = Callback.received(data, {
              prefix: 'tempo-id:popup',
            })
            if (callback) args.sendBack({ callback, type: 'popup.callback' })
          }
          const interval = setInterval(
            () => args.sendBack({ type: handle(popup) }),
            closeInterval,
          )

          window.addEventListener('message', listener)

          return () => {
            clearInterval(interval)
            window.removeEventListener('message', listener)
          }
        }),
      },
    }),
  ).start()

  return () => {
    if (actor.getSnapshot().status === 'active')
      actor.send({ type: 'watch.stop' })
  }
}

/** Returns the event of what the handle of `popup` reads: closed, or open on a page of which origin. */
function handle(popup: Window) {
  if (popup.closed) return 'handle.closed'
  try {
    void popup.location.href
    return 'handle.local'
  } catch {
    // This page cannot read the location of another origin's page.
    return 'handle.foreign'
  }
}

export declare namespace watchPopup {
  type Options = {
    /**
     * Runs with the callback: the redirect URI with `code` and `state`, or with `error`, or the
     * authorization of a request in the web message mode.
     */
    onCallback: (callback: Callback.Received) => void
    /** Runs once the user closes the popup, after `closeGrace` without a callback. */
    onClose: () => void
    /**
     * Runs as soon as the popup reads closed, before `closeGrace`, such as to remove a dialog that
     * names the window. A callback can still arrive after it.
     */
    onClosed?: (() => void) | undefined
    /** Tempo ID's origin, whose page in the popup posts the messages. */
    origin: string
  }
}

/**
 * Returns whether the page runs on iOS or iPadOS, whose Apple Pay runs only on a top-level page.
 * iPadOS Safari reports a Mac, so a Mac with a touch screen counts as an iPad.
 */
export function apple() {
  const agent = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(agent)) return true
  return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1
}

/**
 * Returns whether the deposit page of a request runs Coinflow where no frame can, so the page opens
 * in a popup. The page opens Buy MACH, which runs Coinflow, in place of the list for a hint of `MACH`
 * on Tempo mainnet. Apple Pay runs only on a top-level page, so on iOS and iPadOS no frame runs it.
 * Elsewhere, a frame shows Buy MACH's amount step, and its Pay by card continues in a popup.
 */
export function coinflow(options: coinflow.Options) {
  const { amount, chainId, token } = options
  if (amount === undefined || token !== 'MACH') return false
  if (chainId !== Chains.ids.mainnet) return false
  return apple()
}

export declare namespace coinflow {
  type Options = {
    /** The hint's amount, which Buy MACH needs to open in place of the list. Absent for no hint. */
    amount?: string | undefined
    /** The chain of the deposit. */
    chainId: number
    /** The hint's token, by symbol. Absent, the page lists every method. */
    token?: string | undefined
  }
}

/**
 * Returns whether the page holds a user gesture, within which a popup blocker accepts `window.open`.
 * A browser without `navigator.userActivation` counts as holding one, so its call opens the popup.
 */
export function activated() {
  return navigator.userActivation?.isActive ?? true
}

/**
 * Returns whether the page is on `http:` while Tempo ID is on `https:`, so Tempo ID's sign-in opens
 * in a popup in place of a frame. `window.isSecureContext` does not name such a page, since
 * `http://localhost` is a secure context. A local Tempo ID on `http:` frames its sign-in on a page
 * on `http:`.
 */
export function http(options: http.Options) {
  return (
    new URL(options.page).protocol === 'http:' &&
    new URL(options.url).protocol === 'https:'
  )
}

export declare namespace http {
  type Options = {
    /** The URL of the app's page. */
    page: string
    /** Tempo ID's URL. */
    url: string
  }
}

export namespace machines {
  /**
   * The watch of a popup. This page's own `Cross-Origin-Opener-Policy` severs the handle as the
   * popup navigates away, and a severed handle reads closed while the popup is open. So a closed
   * handle counts as the user's close only in `open`: after Tempo ID's page reported that it
   * loaded, or after the handle read open on another origin's page for `settle`, such as at the
   * error page of a popup that failed to load offline. `closing` waits `closeGrace` for a
   * callback that the popup posted as it closed.
   *
   * | State         | A closed handle                         |
   * | ------------- | --------------------------------------- |
   * | `unconfirmed` | Counts as severed.                      |
   * | `settling`    | Counts as severed, and ends the settle. |
   * | `open`        | Starts the close.                       |
   */
  export const watch = setup({
    actions: {
      /** Runs `onCallback` with the callback. `Popup.ts` provides it. */
      callback: (_args, _params: { callback: Callback.Received }) => {},
      /** Runs `onClose`, after `closeGrace` without a callback. `Popup.ts` provides it. */
      close: () => {},
      /** Runs `onClosed`, once the handle of an open popup reads closed. `Popup.ts` provides it. */
      closed: () => {},
    },
    actors: {
      /**
       * Polls the handle every `closeInterval`, and sends the messages of the popup's page, until the
       * watch ends. `Popup.ts` provides it.
       */
      popup: fromCallback<watch.Event>(() => {}),
    },
    delays: {
      /** The wait of a closed popup for a callback that its page posted as it closed. */
      closeGrace,
      /** The time that the handle reads open on another origin's page before the popup counts as open. */
      settle,
    },
    types: {
      events: {} as watch.Event,
    },
  }).createMachine({
    id: 'watch',
    initial: 'unconfirmed',
    invoke: { src: 'popup' },
    on: {
      'popup.callback': {
        actions: {
          params: (args) => ({ callback: args.event.callback }),
          type: 'callback',
        },
        target: '.received',
      },
      'watch.stop': '.stopped',
    },
    states: {
      closed: { entry: 'close', type: 'final' },
      closing: {
        after: { closeGrace: 'closed' },
        entry: 'closed',
      },
      open: {
        on: { 'handle.closed': 'closing' },
      },
      received: { type: 'final' },
      settling: {
        after: { settle: 'open' },
        on: {
          'handle.closed': 'unconfirmed',
          'handle.local': 'unconfirmed',
          'popup.open': 'open',
        },
      },
      stopped: { type: 'final' },
      unconfirmed: {
        on: {
          'handle.foreign': 'settling',
          'popup.open': 'open',
        },
      },
    },
  })

  /** The types of {@link watch}. */
  export namespace watch {
    /** An event of the watch. */
    export type Event =
      /** The handle reads closed. */
      | { type: 'handle.closed' }
      /** The handle reads open on another origin's page, whose location this page cannot read. */
      | { type: 'handle.foreign' }
      /** The handle reads open on a page of this origin, such as the blank page before the navigation. */
      | { type: 'handle.local' }
      /** The popup's page posted the callback. */
      | {
          /** The redirect URI with `code` and `state`, or with `error`, or an authorization. */
          callback: Callback.Received
          type: 'popup.callback'
        }
      /** Tempo ID's page in the popup reported that it loaded. */
      | { type: 'popup.open' }
      /** The caller stopped the watch. */
      | { type: 'watch.stop' }

    /** A running watch. */
    export type Actor = ActorRefFrom<typeof watch>

    /** A snapshot of the watch. */
    export type Snapshot = SnapshotFrom<typeof watch>
  }
}
