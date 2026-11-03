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
import { createActor, fromPromise, waitFor } from 'xstate'
import type * as Id from '../Id.js'
import * as ClientId from '../internal/clientId.js'
import type * as Core from '../internal/core.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'
import * as RestoreMachine from './restore.machine.js'

/**
 * Returns the plugin of React, which adds `tempoId.useSession()`.
 *
 * @example
 * ```tsx
 * const tempoId = Id.create({ plugins: [react()] })
 *
 * function Account() {
 *   const { isPending, session } = tempoId.useSession()
 *   if (isPending) return <p>Checking your Tempo session…</p>
 *   if (!session) return <button onClick={() => tempoId.dialog.signIn()}>Sign in</button>
 *   return <p>Signed in as {session.user.email}</p>
 * }
 * ```
 */
export function react(options: react.Options = {}) {
  return Plugin.from({
    extend: (instance: Id.Id, context: Plugin.Context) => {
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
        RestoreMachine.machine.provide({
          actors: {
            restore: fromPromise<RestoreMachine.Output, RestoreMachine.Input>(
              async (args) => {
                // Whether the default authorization failed transiently, such as while Tempo ID is
                // unreachable, which the machine retries after a delay. A refusal that repeats at
                // every attempt, such as `webauthn_required`, declines until the status changes.
                let failed = false
                const reauthorize = defaulted
                  ? async () => {
                      const result = await instance
                        .authorize()
                        .catch((error: unknown) => {
                          failed = RestoreMachine.transient(error)
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
                    // The class lives in `Id.js`, which this entry does not load, so its name
                    // identifies it.
                    if (
                      error instanceof Error &&
                      error.name === 'Id.SupersededError'
                    )
                      return undefined
                    throw error
                  })
                const declined =
                  instance.session.status.get().status === 'signedOut'
                return { declined, transient: failed }
              },
            ),
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
          (snapshot) => !RestoreMachine.running(snapshot),
        )
        if (snapshot.context.error !== undefined) throw snapshot.context.error
      }

      return {
        /**
         * Returns the session's status and the session to show, and renders again at each change.
         * The first render restores the saved session, and completes a redirect's callback. With
         * the plugin's `reauthorizeOnMount`, it authorizes the browser's Tempo ID session when it finds no
         * session, or an expired one. A failed restore throws to the nearest error boundary. On a
         * server render, the status is `pending`.
         */
        useSession(): useSession.ReturnType {
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
     * or a session whose access key expired, as `tempoId.authorize` does: `true`, the parameters of
     * that authorization, or a function that authorizes, as `tempoId.session.get` takes. While it
     * renews an expired session, the status is `reauthorizing`, with that session. Defaults to
     * `true` on a page of a first-party app, and `false` elsewhere, such as in a third-party app or
     * a native app. A failure of the default authorization leaves the status `signedOut`, and a
     * failure of one that the app sets throws to the error boundary.
     */
    reauthorizeOnMount?: Core.getSession.Parameters['reauthorize']
  }
}

export declare namespace useSession {
  /** The status of the session, the session to show, and a flag for each status. */
  type ReturnType = {
    [status in Session.Status['status']]: Extract<
      Session.Status,
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
  }[Session.Status['status']]
}

/** The status of a server render. */
const pending: Session.Status = { session: undefined, status: 'pending' }

/** Returns `status` with a flag for each status. */
function withFlags(status: Session.Status): useSession.ReturnType {
  return {
    ...status,
    isPending: status.status === 'pending',
    isReauthorizing: status.status === 'reauthorizing',
    isSignedIn: status.status === 'signedIn',
    isSignedOut: status.status === 'signedOut',
    // The flags follow `status`, which the type cannot infer from the comparisons.
  } as useSession.ReturnType
}
