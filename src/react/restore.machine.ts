/**
 * The state machine of the React plugin's restore: whether a mount authorizes the browser's Tempo
 * ID session, which mounts share one run, and when a page that the authorization found signed out
 * stays so. It holds no I/O. `react/index.ts` provides the `restore` actor and runs the machine.
 * @module
 */
import {
  and,
  type Actor as XStateActor,
  assign,
  fromPromise,
  setup,
  stateIn,
} from 'xstate'

/** The context of the machine. */
export type Context = {
  /**
   * Whether the decline ended during a check, at the retry's deadline or a change of the status, so
   * the machine leaves `declined` once that check settles.
   */
  ended: boolean
  /** The error of the last restore, which every mount that awaited it throws. Absent after a success. */
  error: unknown
  /**
   * Whether the last decline came from a transient failure, such as an unreachable Tempo ID, so the
   * machine authorizes again after {@link retryDelay}.
   */
  retry: boolean
}

/** An event of the machine. */
export type Event =
  | {
      /** A component that reads the session mounted, and restores it. */
      type: 'component.mount'
    }
  | {
      /** The session's status changed, such as at a sign-in, so a later mount authorizes again. */
      type: 'session.status'
    }

/** The input of a restore. */
export type Input = {
  /**
   * Whether the restore authorizes the browser's Tempo ID session when it finds no session. A restore
   * without it reads the store again, which can hold another tab's sign-in since the decline.
   */
  reauthorize: boolean
}

/** The output of a restore. */
export type Output = {
  /**
   * Whether the restore left the page signed out, so a later mount skips the authorization and moves
   * no signed-out page back to `pending`.
   */
  declined: boolean
  /** Whether the decline came from a transient failure, which the machine retries after a delay. */
  transient: boolean
}

/** The wait after a transient failure before a mount authorizes again, in milliseconds. */
export const retryDelay = 30_000

/**
 * The machine. Every restore that leaves the page signed out declines, so no mount loop starts. A
 * decline after a transient failure ends {@link retryDelay} after it starts, whatever checks run in
 * it, and any decline ends at a change of the status.
 *
 * | State               | A mount                                   |
 * | ------------------- | ----------------------------------------- |
 * | `idle`              | Starts a restore that authorizes.         |
 * | `authorizing`       | Shares the restore in progress.           |
 * | `declined.waiting`  | Starts a restore that does not authorize. |
 * | `declined.checking` | Shares the restore in progress.           |
 */
export const machine = setup({
  actions: {
    /** Records the error of the restore. */
    fail: assign((_, params: { error: unknown }) => ({ error: params.error })),
    /** Records whether the decline came from a transient failure. */
    decline: assign((_, params: Output) => ({
      ended: false,
      retry: params.transient,
    })),
    /** Records that the decline ended during a check, which settles before the machine leaves it. */
    end: assign({ ended: true }),
    /** Clears the error of the last restore. */
    start: assign({ error: undefined }),
  },
  actors: {
    /** Restores the session. `react/index.ts` provides it. */
    restore: fromPromise<Output, Input>(() =>
      Promise.resolve({ declined: false, transient: false }),
    ),
  },
  delays: {
    /** The wait after a transient failure before a mount authorizes again. */
    retry: retryDelay,
  },
  guards: {
    /** Whether the restore left the page signed out. */
    declined: (_, params: Output) => params.declined,
    /** Whether the decline ended during the check that settled. */
    ended: (args) => args.context.ended,
    /** Whether the decline came from a transient failure. */
    retry: (args) => args.context.retry,
  },
  types: {
    context: {} as Context,
    events: {} as Event,
  },
}).createMachine({
  context: { ended: false, error: undefined, retry: false },
  id: 'restore',
  initial: 'idle',
  states: {
    authorizing: {
      entry: 'start',
      invoke: {
        id: 'restore',
        input: { reauthorize: true },
        onDone: [
          {
            actions: { params: (args) => args.event.output, type: 'decline' },
            guard: { params: (args) => args.event.output, type: 'declined' },
            target: 'declined',
          },
          { target: 'idle' },
        ],
        onError: {
          actions: {
            params: (args) => ({ error: args.event.error }),
            type: 'fail',
          },
          target: 'idle',
        },
        src: 'restore',
      },
    },
    // The decline holds the retry's delay, so a check at a mount keeps its deadline. A decline that
    // ends during a check leaves once the check settles, so every mount that awaits it reads its
    // result.
    declined: {
      after: {
        retry: [
          {
            guard: and(['retry', stateIn('#restore.declined.waiting')]),
            target: 'idle',
          },
          { actions: 'end', guard: 'retry' },
        ],
      },
      initial: 'waiting',
      states: {
        checking: {
          entry: 'start',
          on: { 'session.status': { actions: 'end' } },
          invoke: {
            id: 'restore',
            input: { reauthorize: false },
            // A check authorizes nothing, so it keeps the decline's retry.
            onDone: [
              { guard: 'ended', target: '#restore.idle' },
              {
                guard: {
                  params: (args) => args.event.output,
                  type: 'declined',
                },
                target: 'waiting',
              },
              { target: '#restore.idle' },
            ],
            onError: {
              actions: {
                params: (args) => ({ error: args.event.error }),
                type: 'fail',
              },
              target: '#restore.idle',
            },
            src: 'restore',
          },
        },
        waiting: {
          on: {
            'component.mount': 'checking',
            'session.status': '#restore.idle',
          },
        },
      },
    },
    idle: {
      on: { 'component.mount': 'authorizing' },
    },
  },
})

/** A running instance of {@link machine}. */
export type Actor = XStateActor<typeof machine>

/** A snapshot of {@link machine}. */
export type Snapshot = ReturnType<Actor['getSnapshot']>

/** Returns whether a restore is in progress, which a mount awaits. */
export function running(snapshot: Snapshot) {
  return (
    snapshot.matches('authorizing') ||
    snapshot.matches({ declined: 'checking' })
  )
}

/**
 * Returns whether a failure of the default authorization is transient, so the next mount retries:
 * an error without Tempo ID's answer, a server error, or a refusal for load. Any other refusal,
 * such as `webauthn_required`, repeats at every attempt, so it is a decline. The entry loads no
 * error class, so the error's name and fields identify a `RequestError`.
 */
export function transient(error: unknown) {
  if (!(error instanceof Error) || error.name !== 'Id.RequestError') return true
  const { reason, status } = error as Error & {
    reason?: string | undefined
    status?: number | undefined
  }
  if (status === undefined || status === 0 || status >= 500) return true
  return reason === 'rate_limited' || reason === 'upstream_unavailable'
}
