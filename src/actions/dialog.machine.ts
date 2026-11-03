/**
 * The state machine of an instance's dialog: the frame that it preloads, and the sign-in that holds
 * the dialog, which the next one replaces. It holds no I/O. `dialog.ts` provides the close of a
 * frame, and opens, hides, and preloads the frames itself.
 * @module
 */
import { type Actor as XStateActor, assign, emit, setup } from 'xstate'
import type * as Sheet from '../internal/sheet.js'

/** A frame that the instance preloaded, which the next sign-in of the same redirect URI takes. */
export type Entry = {
  /** The options of the preload, which the next one reuses. */
  options: {
    /** The redirect URI that the preload named, if any. */
    redirectUri?: string | undefined
  }
  /** The redirect URI of the frame, with the default filled. */
  redirectUri: string
  /** The hidden dialog that frames the sign-in. */
  sheet: Sheet.create.ReturnType
}

/** The context of the machine. */
export type Context = {
  /** The token of the sign-in that holds the dialog, which the next sign-in replaces. */
  call: number | undefined
  /** The number of sign-ins that started, which gives each one its token. */
  calls: number
  /** The preloaded frame, while `frame` is `preloaded`. */
  entry: Entry | undefined
}

/** An event of the machine. */
export type Event =
  | {
      /** The preloaded frame closes, such as for a new preload. */
      type: 'discard'
    }
  | {
      /** The token of the sign-in that ended. */
      call: number
      /** The frame that the sign-in kept loaded for the next one, which it hid, if any. */
      kept: Entry | undefined
      /** A sign-in ended. */
      type: 'end'
    }
  | {
      /** The frame that loads hidden for the next sign-in. */
      entry: Entry
      /** The instance preloaded a frame. */
      type: 'preload'
    }
  | {
      /** A sign-in starts, which replaces the one that holds the dialog, if any. */
      type: 'replace'
    }
  | {
      /** The replacing sign-in holds the dialog, and takes the next token. */
      type: 'start'
    }
  | {
      /** Whether the sign-in shows the preloaded frame, which it then owns, or closes it. */
      reuse: boolean
      /** A sign-in takes the preloaded frame. */
      type: 'take'
    }

/** An event that the machine emits. */
export type Emitted = {
  /** The token of the sign-in that the next one replaced. */
  call: number
  /** A later sign-in replaced the sign-in of `call`, which rejects. */
  type: 'replaced'
}

/**
 * The machine. Two regions run in parallel: `frame`, the preloaded frame, and `call`, the sign-in
 * that holds the dialog.
 *
 * | State               | Meaning                                                              |
 * | ------------------- | -------------------------------------------------------------------- |
 * | `frame.empty`       | No frame is preloaded. A sign-in that holds one owns it.             |
 * | `frame.preloaded`   | A hidden frame waits for the next sign-in, in `context.entry`.       |
 * | `call.idle`         | No sign-in holds the dialog.                                         |
 * | `call.running`      | The sign-in of `context.call` holds the dialog.                      |
 */
export const machine = setup({
  actions: {
    /** Closes the preloaded frame. `dialog.ts` provides it. */
    close: () => {},
    /** Ends the sign-in that holds the dialog. */
    finish: assign({ call: undefined }),
    /** Holds the frame that the sign-in kept, or the new preload. */
    hold: assign(({ event }) => {
      if (event.type === 'preload') return { entry: event.entry }
      if (event.type === 'end') return { entry: event.kept }
      return {}
    }),
    /** Emits `replaced` for the sign-in that holds the dialog. */
    replace: emit(({ context }) => ({
      call: context.call ?? 0,
      type: 'replaced' as const,
    })),
    /** Gives the sign-in that starts the next token. */
    start: assign(({ context }) => ({
      call: context.calls + 1,
      calls: context.calls + 1,
    })),
    /** Releases the preloaded frame, which a sign-in owns or closed. */
    take: assign({ entry: undefined }),
  },
  guards: {
    /** Whether the sign-in that ended kept its frame loaded for the next one. */
    kept: ({ event }) => event.type === 'end' && event.kept !== undefined,
    /** Whether the sign-in that ended still holds the dialog. */
    owned: ({ context, event }) =>
      event.type === 'end' && event.call === context.call,
    /** Whether the sign-in shows the preloaded frame. */
    reuse: ({ event }) => event.type === 'take' && event.reuse,
  },
  types: {
    context: {} as Context,
    emitted: {} as Emitted,
    events: {} as Event,
  },
}).createMachine({
  context: { call: undefined, calls: 0, entry: undefined },
  id: 'dialog',
  states: {
    call: {
      initial: 'idle',
      states: {
        idle: {
          on: { start: { actions: 'start', target: 'running' } },
        },
        running: {
          on: {
            end: { actions: 'finish', guard: 'owned', target: 'idle' },
            replace: { actions: 'replace' },
            // A sign-in that the browser's popup blocker refused never starts, so the sign-in that
            // it replaced still holds the dialog.
            start: { actions: 'start', reenter: true, target: 'running' },
          },
        },
      },
    },
    frame: {
      initial: 'empty',
      states: {
        empty: {
          on: {
            end: { actions: 'hold', guard: 'kept', target: 'preloaded' },
            preload: { actions: 'hold', target: 'preloaded' },
          },
        },
        preloaded: {
          on: {
            discard: { actions: ['close', 'take'], target: 'empty' },
            preload: {
              actions: ['close', 'hold'],
              reenter: true,
              target: 'preloaded',
            },
            take: [
              { actions: 'take', guard: 'reuse', target: 'empty' },
              { actions: ['close', 'take'], target: 'empty' },
            ],
          },
        },
      },
    },
  },
  type: 'parallel',
})

/** A running instance of {@link machine}. */
export type Actor = XStateActor<typeof machine>

/** A snapshot of {@link machine}. */
export type Snapshot = ReturnType<Actor['getSnapshot']>

/** Returns the preloaded frame, or `undefined` without one. */
export function entry(snapshot: Snapshot) {
  return snapshot.context.entry
}

/**
 * Returns what an ending sign-in of `call` does with its frame:
 *
 * - `owned`: whether it still holds the dialog, so no later sign-in replaced it.
 * - `keep`: whether it hides its frame and keeps it for the next sign-in, which it does while it
 *   holds the dialog and no other preload took the instance's place. `dialog.ts` then hides the
 *   frame, which a failed frame refuses.
 */
export function ending(
  snapshot: Snapshot,
  options: ending.Options,
): ending.ReturnType {
  const owned = options.call === snapshot.context.call
  return {
    keep: owned && options.framed && snapshot.matches({ frame: 'empty' }),
    owned,
  }
}

export declare namespace ending {
  type Options = {
    /** The token of the sign-in that ends. */
    call: number
    /** Whether the sign-in holds a frame. */
    framed: boolean
  }

  type ReturnType = {
    /** Whether the sign-in hides its frame and keeps it for the next one. */
    keep: boolean
    /** Whether the sign-in still holds the dialog. */
    owned: boolean
  }
}
