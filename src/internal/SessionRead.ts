/**
 * The reads of an instance's session for `session.get` and for its status subscriptions: a status
 * subscription that finds the session unread reads it once, beside no read of the page, and keeps
 * a failure that no caller receives for the page's next read.
 * @module
 */
import {
  type ActorRefFrom,
  assertEvent,
  assign,
  createActor,
  fromPromise,
  type SnapshotFrom,
  setup,
  stateIn,
} from 'xstate'

/**
 * Returns the reads of an instance's session. `run` runs a page's read, such as `session.get`, and
 * `follow` starts the read of a status subscription after the code that subscribes, so a page's read
 * in that code settles the status first.
 */
export function create(options: create.Options): create.ReturnType {
  const { loaded, read } = options
  const actor = createActor(
    machines.read.provide({
      actors: { read: fromPromise(() => read()) },
    }),
  ).start()

  return {
    follow() {
      queueMicrotask(() =>
        actor.send({ loaded: loaded(), type: 'follow.start' }),
      )
    },
    run(fn) {
      const failure = machines.failure(actor.getSnapshot())
      if (failure) {
        actor.send({ type: 'failure.take' })
        return Promise.reject(failure.error)
      }
      actor.send({ type: 'page.start' })
      return fn().finally(() => actor.send({ type: 'page.end' }))
    },
  }
}

export declare namespace create {
  type Options = {
    /** Returns whether the session loaded, after which a subscription reads nothing. */
    loaded: () => boolean
    /** Reads the session as `session.get` does, with the restore hooks. */
    read: () => Promise<unknown>
  }

  type ReturnType = {
    /** Starts the read of a status subscription, if the session is unread and no read of the page runs. */
    follow: () => void
    /**
     * Runs `fn`, a read of the page. Rejects first with the failure of a subscription's read that no
     * caller received, once.
     */
    run: <value>(fn: () => Promise<value>) => Promise<value>
  }
}

export namespace machines {
  /**
   * The machine of a status subscription's read beside the reads of the page.
   *
   * | State               | Meaning                                                                 |
   * | ------------------- | ----------------------------------------------------------------------- |
   * | `idle`              | No subscription's read runs, and no failure waits.                      |
   * | `reading.alone`     | The subscription's read runs, and no read of the page started beside it. |
   * | `reading.shared`    | The subscription's read runs, and a read of the page started beside it. |
   * | `unreported`        | The subscription's read failed alone, and the next read of the page throws it. |
   */
  export const read = setup({
    actions: {
      /** Counts a read of the page that starts. */
      count: assign((args) => ({ pages: args.context.pages + 1 })),
      /** Forgets the failure that a read of the page took. */
      forget: assign({ failure: undefined }),
      /** Keeps the failure of the subscription's read. */
      keep: assign((args, params: { error: unknown }) => ({
        ...args.context,
        failure: { error: params.error },
      })),
      /** Counts a read of the page that ends. */
      uncount: assign((args) => ({ pages: args.context.pages - 1 })),
    },
    actors: {
      /** Reads the session, with the restore hooks. `create` provides it. */
      read: fromPromise<unknown>(() => Promise.resolve(undefined)),
    },
    guards: {
      /** Whether no read of the page started beside the subscription's read. */
      alone: stateIn({ reading: 'alone' }),
      /** Whether the session is unread, and no read of the page runs. */
      startable: (args) => {
        assertEvent(args.event, 'follow.start')
        return !args.event.loaded && args.context.pages === 0
      },
    },
    types: {
      context: {} as read.Context,
      events: {} as read.Event,
    },
  }).createMachine({
    context: { failure: undefined, pages: 0 },
    id: 'read',
    initial: 'idle',
    on: {
      'page.end': { actions: 'uncount' },
      'page.start': { actions: 'count' },
    },
    states: {
      idle: {
        on: {
          'follow.start': { guard: 'startable', target: 'reading' },
        },
      },
      reading: {
        initial: 'alone',
        invoke: {
          onDone: { target: 'idle' },
          // A read of the page beside it received the failure itself.
          onError: [
            {
              actions: {
                params: (args) => ({ error: args.event.error }),
                type: 'keep',
              },
              guard: 'alone',
              target: 'unreported',
            },
            { target: 'idle' },
          ],
          id: 'read',
          src: 'read',
        },
        states: {
          alone: {
            on: { 'page.start': { actions: 'count', target: 'shared' } },
          },
          shared: {},
        },
      },
      unreported: {
        on: { 'failure.take': { actions: 'forget', target: 'idle' } },
      },
    },
  })

  export declare namespace read {
    /** The machine's context. */
    type Context = {
      /** The failure of the subscription's read in `unreported`, or `undefined`. */
      failure: { error: unknown } | undefined
      /** The count of the reads of the page that run. */
      pages: number
    }

    /** An event of the reads. */
    type Event =
      | {
          /** Whether the session loaded when the subscription's read would start. */
          loaded: boolean
          /** A status subscription asks for a read. */
          type: 'follow.start'
        }
      | {
          /** A read of the page took the kept failure. */
          type: 'failure.take'
        }
      | {
          /** A read of the page ended. */
          type: 'page.end'
        }
      | {
          /** A read of the page started. */
          type: 'page.start'
        }

    /** A running machine. */
    type Actor = ActorRefFrom<typeof read>

    /** A snapshot of the machine. */
    type Snapshot = SnapshotFrom<typeof read>
  }

  /** Returns the failure that the next read of the page throws, or `undefined`. */
  export function failure(
    snapshot: read.Snapshot,
  ): { error: unknown } | undefined {
    return snapshot.matches('unreported') ? snapshot.context.failure : undefined
  }
}
