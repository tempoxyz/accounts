/**
 * The state machine of the embedded sign-in dialog: the frame's load, the request that the dialog
 * shows, the exit, the offer of a popup, and the close. It holds no I/O. `sheet.ts` provides the
 * DOM work, the messages to the frame, the user's handlers, and the popup, and sends the page's
 * messages and the dialog's calls as events.
 * @module
 */
import {
  type Actor as XStateActor,
  and,
  assign,
  fromCallback,
  raise,
  sendTo,
  setup,
  stateIn,
} from 'xstate'

/** Milliseconds of the dialog's exit, which `hide` and `close` wait for. */
export const exit = 240

/** Milliseconds after the frame's `load` event that its page has to send `loaded`. */
const loadDelay = 3_000

/** Where the dialog routes the user's actions. */
export type Handlers = {
  /** Receives the callback URL that the frame or the popup posts. */
  onCallback: (url: string) => void
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
export const machine = setup({
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
          handlers: { onCallback: event.onCallback, onClose: event.onClose },
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
    context: {} as Context,
    events: {} as Event,
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
        close: [{ guard: 'animate', target: 'closing' }, { target: 'closed' }],
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
                  actions: { params: { reason: 'unavailable' }, type: 'fail' },
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
                  on: { 'popup.open': { guard: 'current', target: 'popup' } },
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
                    'popup.blocked': { actions: 'blocked', target: 'offered' },
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

/** A running instance of {@link machine}. */
export type Actor = XStateActor<typeof machine>

/** A snapshot of {@link machine}. */
export type Snapshot = ReturnType<Actor['getSnapshot']>

/** Returns whether the dialog offers a popup in place of its frame, which then takes no request. */
export function failed(snapshot: Snapshot) {
  return snapshot.matches({ open: { frame: 'failed' } })
}

/**
 * Returns whether Tempo ID trusts the app not to cover the frame, as the loaded page reports it,
 * or `undefined` before the page loads.
 */
export function trusted(snapshot: Snapshot) {
  return snapshot.context.trusted
}
