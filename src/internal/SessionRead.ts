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
  const { loaded, read, refused } = options
  const actor = createActor(
    machines.read.provide({
      actors: {
        // A failed read of the store leaves the session unread, so the page's next read reads it
        // again, and the machine keeps nothing. Only a restore hook's failure stays.
        read: fromPromise(() =>
          read().catch((error: unknown) => {
            if (!refused(error)) return undefined
            throw error
          }),
        ),
      },
    }),
  ).start()

  return {
    actor,
    change() {
      actor.send({ type: 'session.change' })
    },
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
      return fn().then(
        (value) => {
          actor.send({ type: 'page.end' })
          return value
        },
        (error: unknown) => {
          actor.send({ failure: { error }, type: 'page.end' })
          throw error
        },
      )
    },
  }
}

export declare namespace create {
  type Options = {
    /** Returns whether the session loaded, after which a subscription reads nothing. */
    loaded: () => boolean
    /** Reads the session as `session.get` does, with the restore hooks. */
    read: () => Promise<unknown>
    /** Returns whether `error` is a restore hook's failure, such as a refused callback. */
    refused: (error: unknown) => boolean
  }

  type ReturnType = {
    /** The machine of the reads, for reads of its state only. */
    actor: machines.read.Actor
    /** Records a change of the session, such as a sign-in, after which a kept failure is stale. */
    change: () => void
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
   * The machine of a status subscription's read beside the reads of the page. A read of the page
   * that joins the subscription's restore hooks rejects with the same error, which then reached a
   * caller. A read of the page that ran the hooks again, after the subscription's run of them ended,
   * delivers nothing, so the failure stays.
   *
   * | State        | Meaning                                                                                          |
   * | ------------ | ------------------------------------------------------------------------------------------------ |
   * | `idle`       | No subscription's read runs, and no failure waits.                                               |
   * | `reading.current`   | The subscription's read runs. `delivered` holds the failures of the reads of the page beside it. |
   * | `reading.overtaken` | The session changed during the read, so its failure is stale.                                    |
   * | `unreported` | A restore hook failed in the subscription's read, no caller received the failure, and the next read of the page throws it, unless the session changes first. |
   */
  export const read = setup({
    actions: {
      /** Counts a read of the page that starts. */
      count: assign((args) => ({ pages: args.context.pages + 1 })),
      /** Records the failure of a read of the page beside the subscription's read. */
      deliver: assign((args) => {
        assertEvent(args.event, 'page.end')
        return {
          delivered: args.event.failure
            ? [...args.context.delivered, args.event.failure.error]
            : args.context.delivered,
        }
      }),
      /** Forgets the kept failure, and the failures that reads of the page received. */
      forget: assign({ delivered: [], failure: undefined }),
      /** Keeps the failure of the subscription's read. */
      keep: assign((_, params: { error: unknown }) => ({
        delivered: [],
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
      /** Whether the session changed since the subscription's read started. */
      overtaken: stateIn({ reading: 'overtaken' }),
      /** Whether a read of the page rejected with the error itself, so a caller received it. */
      delivered: (args, params: { error: unknown }) =>
        args.context.delivered.includes(params.error),
      /** Whether a read of the page that ends rejected with the kept failure. */
      received: (args) => {
        assertEvent(args.event, 'page.end')
        return (
          args.event.failure !== undefined &&
          args.event.failure.error === args.context.failure?.error
        )
      },
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
    context: { delivered: [], failure: undefined, pages: 0 },
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
        invoke: {
          id: 'read',
          onDone: { actions: 'forget', target: 'idle' },
          onError: [
            {
              actions: 'forget',
              guard: {
                params: (args) => ({ error: args.event.error }),
                type: 'delivered',
              },
              target: 'idle',
            },
            // A sign-in or a sign-out during the read made its failure stale.
            { actions: 'forget', guard: 'overtaken', target: 'idle' },
            {
              actions: {
                params: (args) => ({ error: args.event.error }),
                type: 'keep',
              },
              target: 'unreported',
            },
          ],
          src: 'read',
        },
        initial: 'current',
        on: { 'page.end': { actions: ['uncount', 'deliver'] } },
        states: {
          current: { on: { 'session.change': { target: 'overtaken' } } },
          overtaken: {},
        },
      },
      unreported: {
        on: {
          'failure.take': { actions: 'forget', target: 'idle' },
          // A read of the page that was running when the read failed joined its hooks, and rejected
          // with the failure.
          'page.end': [
            {
              actions: ['uncount', 'forget'],
              guard: 'received',
              target: 'idle',
            },
            { actions: 'uncount' },
          ],
          // A sign-in or a sign-out since the failure makes it stale.
          'session.change': { actions: 'forget', target: 'idle' },
        },
      },
    },
  })

  export declare namespace read {
    /** The machine's context. */
    type Context = {
      /** In `reading`, the errors of the reads of the page beside the subscription's read. */
      delivered: readonly unknown[]
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
          /** The read's failure, or `undefined` for a read that resolved. */
          failure?: { error: unknown } | undefined
          /** A read of the page ended. */
          type: 'page.end'
        }
      | {
          /** A read of the page started. */
          type: 'page.start'
        }
      | {
          /** The session changed, such as at a sign-in or a sign-out. */
          type: 'session.change'
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
