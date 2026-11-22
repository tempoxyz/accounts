/**
 * The entry for React: `react`, a plugin that adds `useSession` to the instance itself. It has an
 * entry of its own, since React is an optional peer, so `accounts/plugins` loads without it.
 *
 * @example
 * ```tsx
 * import { react } from 'accounts/react'
 * ```
 * @module
 */
/* istanbul ignore file -- The hook runs only in a React render in a browser, which only an app drives. */
import * as React from 'react'
import {
  type Actor as XStateActor,
  and,
  assign,
  createActor,
  fromPromise,
  setup,
  stateIn,
  waitFor,
} from 'xstate'
import type * as Accounts from '../Accounts.js'
import * as ClientId from '../internal/ClientId.js'
import type * as Core from '../internal/Core.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/**
 * Returns the plugin of React, from `accounts/react`, which adds `accounts.useSession()` to the
 * instance itself. React is an optional peer dependency of `accounts`, so an app with React shares
 * its own copy.
 *
 * `accounts.useSession()` returns the status of the instance's session, which changes as follows:
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> pending
 *   pending --> signedIn: saved session, or authorization
 *   pending --> reauthorizing: saved session expired, authorization runs
 *   pending --> signedOut: no session
 *   reauthorizing --> signedIn: authorization returns a session
 *   reauthorizing --> signedOut: no Tempo ID session
 *   signedOut --> signedIn: sign-in
 *   signedOut --> reauthorizing: authorize after session.get emptied an expired session
 *   signedIn --> signedOut: signOut, or the access key expires
 * ```
 *
 * @example
 * ```tsx
 * import { Accounts } from 'accounts'
 * import { react } from 'accounts/react'
 *
 * const accounts = Accounts.create({ plugins: [react()] })
 *
 * function Account() {
 *   const { isPending, isReauthorizing, session } = accounts.useSession()
 *   if (isPending) return <p>Checking your Tempo session…</p>
 *   if (!session)
 *     return <button onClick={() => accounts.dialog.signIn()}>Sign in</button>
 *   return (
 *     <p>
 *       Signed in as {session.user.email}
 *       {isReauthorizing ? ' (renewing the access key…)' : null}
 *     </p>
 *   )
 * }
 * ```
 */
export function react(options: react.Options = {}) {
  return Plugin.from({
    extend: (instance: Accounts.Accounts, context: Plugin.Context) => {
      // Only a first-party app's page holds a Tempo ID session that it may read. A third-party app
      // has no CORS grant for it, and a native app holds no browser session.
      const defaulted =
        options.reauthorizeOnMount === undefined &&
        typeof document !== 'undefined' &&
        !ClientId.thirdParty(instance.config.clientId)

      // The machine decides whether a mount authorizes, and shares one restore between the mounts
      // that arrive while it runs. It skips the authorization only for a page that the plugin's own
      // authorization found signed out, so it moves no signed-out page back to `pending`, which
      // could unmount and mount that page's components again without end.
      const actor = createActor(
        machines.restore.provide({
          actors: {
            restore: fromPromise<
              machines.restore.Output,
              machines.restore.Input
            >(async (args) => {
              // Whether the default authorization failed transiently, such as while Tempo ID is
              // unreachable, which the machine retries after a delay. A refusal that repeats at
              // every attempt, such as `webauthn_required`, declines until the status changes.
              let failed = false
              const reauthorize = defaulted
                ? async () => {
                    const result = await instance
                      .authorize()
                      .catch((error: unknown) => {
                        failed = machines.transient(error)
                        return undefined
                      })
                    if (!result) return undefined
                    const { upgradeAvailable: _, ...session } = result
                    return session
                  }
                : options.reauthorizeOnMount
              // A check authorizes nothing, so it reads the store again, which holds a sign-in of
              // another tab since the decline.
              if (!args.input.reauthorize)
                // A failed read leaves the session that `session.get` loads.
                await context.session.reload().catch(() => undefined)
              await instance.session
                .get(args.input.reauthorize ? { reauthorize } : {})
                .catch((error: unknown) => {
                  // A sign-out or a newer sign-in overtook the restore, and the status shows it.
                  // The class lives in `Accounts.js`, which this entry does not load, so its name
                  // identifies it.
                  if (
                    error instanceof Error &&
                    error.name === 'Accounts.SupersededError'
                  )
                    return undefined
                  throw error
                })
              const declined =
                instance.session.status.get().status === 'signedOut'
              return { declined, transient: failed }
            }),
          },
        }),
      ).start()
      // A sign-in or a sign-out after a decline lets the next mount authorize again.
      instance.session.status.subscribe(() =>
        actor.send({ type: 'session.status' }),
      )

      /** Restores the session at a mount, and throws the error of a restore that failed. */
      async function restore() {
        actor.send({ type: 'component.mount' })
        const snapshot = await waitFor(
          actor,
          (snapshot) => !machines.running(snapshot),
        )
        if (snapshot.context.error !== undefined) throw snapshot.context.error
      }

      return {
        /**
         * Returns the session's status and the session to show, and renders again at each change
         * of the status. The first render restores the saved session through
         * `accounts.session.get()`, which also completes a redirect's callback. With the plugin's
         * `reauthorizeOnMount`, it authorizes the browser's Tempo ID session when it finds no
         * session, or an expired one. After an `accounts.signOut` without `everywhere`, in this
         * tab or another, it authorizes nothing until the next sign-in, and a component that mounts
         * then keeps the status `signedOut`. After one with `everywhere`, it authorizes nothing until the logout's
         * answer. After a reload during that logout, it authorizes nothing until the next sign-in.
         * Every component's first render shares one restore. A failed restore,
         * such as a refused callback, throws to the nearest error boundary. On a server render, the
         * status is `pending`.
         *
         * The hook reads `accounts.session.status` with `useSyncExternalStore`, so every component
         * that calls it renders the same status.
         *
         * A sign-out or a newer sign-in that overtakes the first render's restore throws nothing,
         * since the status already shows it.
         *
         * @throws {Accounts.RequestError} To the error boundary, when the restore fails, such as
         *   for a refused redirect callback, as the `redirect` plugin lists. Also when an
         *   authorization that the app sets with `reauthorizeOnMount` fails, as the errors of
         *   `accounts.authorize` list.
         */
        // The instance types it by its session, which `Accounts.Members` names.
        useSession(): useSession.ReturnType<Session.Any> {
          const status = React.useSyncExternalStore(
            instance.session.status.subscribe,
            instance.session.status.get,
            () => pending,
          )
          const flagged = React.useMemo(() => withFlags(status), [status])
          const [error, setError] = React.useState<unknown>()

          React.useEffect(() => {
            restore().catch(setError)
          }, [])

          if (error) throw error
          return flagged
        },
      }
    },
    id: 'react',
  })
}

export declare namespace react {
  type Options = {
    /**
     * Whether the first render authorizes the browser's Tempo ID session when it finds no session,
     * or a session whose access key expired, as `accounts.authorize` does: `true`, the parameters of
     * that authorization, or a function that authorizes, as `accounts.session.get` takes. `true`
     * authorizes with the instance's `accessKey`. An object passes the parameters of
     * `accounts.authorize`, such as `{ accessKey: false }`. A function runs as the authorization,
     * such as one that falls back to a sign-in without an access key. `false` turns the
     * authorization off. While it renews an expired session, the status is `reauthorizing`, with
     * that session. Defaults to `true` on a page of a
     * [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps),
     * and `false` elsewhere. A third-party app has no grant to read the Tempo ID session, and a
     * native app holds no browser session, so neither authorizes by default.
     *
     * A failure of the default authorization, such as an unreachable Tempo ID, a check of the
     * Tempo ID session without a response within 10 seconds, or a page origin without a CORS
     * grant, leaves the status `signedOut`. After a failure without an answer from
     * Tempo ID, a server error, or a rate limit, a component that mounts 30 seconds later
     * authorizes again. After any other refusal, such as `webauthn_required` for a passkey prompt
     * that the user dismissed, or `redirect_refused` for a `url` that redirects, it authorizes
     * nothing until the status changes. A failure of an authorization that the app sets throws to
     * the error boundary.
     */
    reauthorizeOnMount?: Core.getSession.Parameters['reauthorize']
  }
}

export declare namespace useSession {
  /**
   * The status of the session, the session to show, and a flag for each status: a `Session.Status`
   * with the flags. The type narrows on `status` and on each flag. An instance with the `local`
   * plugin shows a `Session.Any`.
   */
  type ReturnType<session extends Session.Any = Session.Session> = {
    [status in Session.Status<session>['status']]: Extract<
      Session.Status<session>,
      { status: status }
    > & {
      /** Whether the status is `pending`: the instance restores or authorizes, with no session to show. */
      isPending: status extends 'pending' ? true : false
      /** Whether the status is `reauthorizing`: an authorization renews the expired `session`. */
      isReauthorizing: status extends 'reauthorizing' ? true : false
      /** Whether the status is `signedIn`. */
      isSignedIn: status extends 'signedIn' ? true : false
      /** Whether the status is `signedOut`. */
      isSignedOut: status extends 'signedOut' ? true : false
    }
  }[Session.Status<session>['status']]
}

/** The status of a server render. */
const pending: Session.Status<Session.Any> = {
  session: undefined,
  status: 'pending',
}

/** Returns `status` with a flag for each status. */
function withFlags<session extends Session.Any>(
  status: Session.Status<session>,
): useSession.ReturnType<session> {
  return {
    ...status,
    isPending: status.status === 'pending',
    isReauthorizing: status.status === 'reauthorizing',
    isSignedIn: status.status === 'signedIn',
    isSignedOut: status.status === 'signedOut',
    // The flags follow `status`, which the type cannot infer from the comparisons.
  } as useSession.ReturnType<session>
}

/** The state machines that this module runs. */
export namespace machines {
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
  export const restore = setup({
    actions: {
      /** Records the error of the restore. */
      fail: assign((_, params: { error: unknown }) => ({
        error: params.error,
      })),
      /** Records whether the decline came from a transient failure. */
      decline: assign((_, params: machines.restore.Output) => ({
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
      restore: fromPromise<machines.restore.Output, machines.restore.Input>(
        () => Promise.resolve({ declined: false, transient: false }),
      ),
    },
    delays: {
      /** The wait after a transient failure before a mount authorizes again. */
      retry: retryDelay,
    },
    guards: {
      /** Whether the restore left the page signed out. */
      declined: (_, params: machines.restore.Output) => params.declined,
      /** Whether the decline ended during the check that settled. */
      ended: (args) => args.context.ended,
      /** Whether the decline came from a transient failure. */
      retry: (args) => args.context.retry,
    },
    types: {
      context: {} as machines.restore.Context,
      events: {} as machines.restore.Event,
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
              actions: {
                params: (args) => args.event.output,
                type: 'decline',
              },
              guard: {
                params: (args) => args.event.output,
                type: 'declined',
              },
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

  /** The types of {@link restore}. */
  export namespace restore {
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

    /** A running instance of {@link machine}. */
    export type Actor = XStateActor<typeof restore>

    /** A snapshot of {@link machine}. */
    export type Snapshot = ReturnType<Actor['getSnapshot']>
  }

  /** Returns whether a restore is in progress, which a mount awaits. */
  export function running(snapshot: machines.restore.Snapshot) {
    return (
      snapshot.matches('authorizing') ||
      snapshot.matches({ declined: 'checking' })
    )
  }

  /**
   * Returns whether a failure of the default authorization is transient, so the next mount retries:
   * an error without Tempo ID's answer, a server error, a status of 429, or a refusal for load. Any
   * other refusal, such as `webauthn_required` after a passkey prompt that the user dismissed, or a
   * refused redirect, repeats at every attempt, so it is a decline. The entry loads no error class, so the
   * error's name and fields identify a `RequestError`.
   */
  export function transient(error: unknown) {
    if (!(error instanceof Error) || error.name !== 'Accounts.RequestError')
      return true
    const { code, reason, status } = error as Error & {
      code?: string | undefined
      reason?: string | undefined
      status?: number | undefined
    }
    // A rate limit is transient also without a reason, such as the 429 of a proxy or of the
    // issuer's own limiter, whose errors carry no reason.
    if (status !== undefined && (status === 429 || status >= 500)) return true
    // Only a refused redirect has status 0 with this code. A retry meets the same redirect.
    if (code === 'redirect_refused' && status === 0) return false
    // A passkey ceremony that failed on the page refuses with status 0 and `webauthn_required`, and
    // its prompt shows again at every attempt, so the reason decides before the missing answer.
    if (reason !== undefined)
      return reason === 'rate_limited' || reason === 'upstream_unavailable'
    return status === undefined || status === 0
  }
}
