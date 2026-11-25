/**
 * The dialog plugin of an instance that receives no sign-in plugin. It loads `dialog` from its own
 * chunk, so an app that names its sign-in plugins bundles none of the dialog's code.
 * @module
 */
import { RequestError } from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import type { dialog } from '../plugins/dialog.js'
import * as Session from '../Session.js'

/** The IDs of the plugins that sign the user in. An instance with none receives {@link plugin}. */
export const signInIds = new Set([
  'backend',
  'device',
  'dialog',
  'email',
  'local',
  'passkey',
  'redirect',
])

/** The ID of a plugin that signs the user in. */
export type SignInId =
  | 'backend'
  | 'device'
  | 'dialog'
  | 'email'
  | 'local'
  | 'passkey'
  | 'redirect'

/** The dialog plugin, with its default options. */
export type Dialog = ReturnType<typeof dialog<{}>>

/**
 * Returns the dialog plugin, whose module loads on the first call of an action. In a browser, the
 * module loads as the instance is created without a saved session or with an expired one, and once
 * the session ends. It then preloads the dialog's frame as `dialog()` does. A page that restores a
 * live session, or renews an expired one through an authorization in progress, loads no code of
 * the dialog before the session ends or an action runs. A sign-in whose load of the module fails in
 * a browser without a connection throws as the loaded sign-in does offline.
 */
export function plugin(): Dialog {
  let loading: Promise<Dialog> | undefined
  // The loaded plugin, whose hooks run without a wait. A sign-in registers only once it loads.
  let loaded_plugin: Dialog | undefined

  /** Loads the dialog plugin once. A failed load, such as offline, lets the next call try again. */
  function load() {
    loading ??= import('../plugins/dialog.js')
      .then((module) => (loaded_plugin = module.dialog()))
      .catch((error: unknown) => {
        loading = undefined
        throw error
      })
    return loading
  }

  return Plugin.from({
    actions: (context) => {
      let actions: Promise<Actions> | undefined

      /** Returns the actions of the loaded plugin, created once for this instance. */
      function get() {
        actions ??= load()
          .then((loaded) => loaded.actions!(context))
          .catch((error: unknown) => {
            actions = undefined
            throw error
          })
        return actions
      }

      return {
        callback: async () => (await get()).callback(),
        revokeAccessKey: async (
          parameters?: dialog.revokeAccessKey.Parameters,
        ) => (await get()).revokeAccessKey(parameters),
        // Without `backend`, the session is the stored one, so the read loads no dialog code.
        // An instance with the `dialog` plugin signs in with Tempo ID, so its session has tokens.
        session: async () =>
          ((await context.session.load()) as Session.Session | undefined) ??
          null,
        signIn: (async (parameters?: dialog.signIn.Parameters) =>
          (await get().catch(unloaded)).signIn(parameters)) as dialog.signIn.Fn,
        signMessage: async (parameters: dialog.signMessage.Parameters) =>
          (await get().catch(unloaded)).signMessage(parameters),
        updateAccessKey: async (
          parameters: dialog.updateAccessKey.Parameters,
        ) => (await get()).updateAccessKey(parameters),
      } satisfies Actions
    },
    // The loaded plugin adds no member, so its `extend` runs once the module loads, and this one
    // adds none either.
    extend(instance, context) {
      // The instance can be created outside a browser, such as on a server that renders the page.
      if (typeof document === 'undefined') return {}

      // The run of the loaded plugin's `extend`, which preloads the frame, once for this instance.
      let extending: Promise<void> | undefined
      /**
       * Loads the plugin, and runs its `extend`. With `read`, the session that this plugin's own
       * read returned, the loaded plugin's `reload` returns it, so the page reads the store once.
       */
      const extend = (read?: { session: Session.Any | undefined }) => {
        // The frame's preload is an optimization, so a failed load leaves the first sign-in to load
        // it, and the instance waits for no load.
        extending ??= load().then(
          (loaded) => {
            // The loaded plugin reads the instance's session again after its read, such as at the
            // end of an authorization in progress, so an earlier read decides only the first step.
            loaded.extend?.(
              instance,
              read
                ? {
                    ...context,
                    session: {
                      ...context.session,
                      reload: () => Promise.resolve(read.session),
                    },
                  }
                : context,
            )
          },
          () => {
            extending = undefined
          },
        )
      }

      // A browser without IntersectionObserver v2 loads the frame on every page, also with a session.
      if (!visibility()) {
        extend()
        return {}
      }
      // A page that restores a live session shows no sign-in, so it loads no code of the dialog until
      // the session ends. A failed read loads it, since the page then shows a sign-in. An
      // authorization that runs, such as the one of `react` at mount, can restore a session or renew
      // an expired one without a sign-in, so the load waits for it.
      void context.session.reload().then(
        async (session) => {
          if (session && !Session.expired(session)) return
          if (session) {
            await context.session.settled()
            // Without an authorization, the instance can keep the expired session, which shows a
            // sign-in.
            const current = context.session.get()
            if (current && !Session.expired(current)) return
          }
          extend({ session })
        },
        () => extend(),
      )
      // The loaded plugin subscribes after the status changes, and a subscription never receives the
      // current status, so `signedOut` reads no store. A renewal, at `reauthorizing`, is a request
      // of the page, so it loads no code of the dialog.
      instance.session.status.subscribe((status) => {
        if (status.status === 'signedOut') extend({ session: status.session })
      })
      return {}
    },
    // A sign-out closes the loaded plugin's sign-ins in progress. Before the load, none runs.
    hooks: {
      afterSignOut: (context) => loaded_plugin?.hooks?.afterSignOut?.(context),
      beforeSignOut(context) {
        if (loaded_plugin) return loaded_plugin.hooks?.beforeSignOut?.(context)
        // A sign-in can register once the module loads, before the sign-out ends, also one that
        // rejects and runs no `afterSignOut`. The loaded hook then closes it. The sign-out waits for
        // no load, and a failed load registers no sign-in.
        void loading?.then(
          (loaded) => loaded.hooks?.beforeSignOut?.(context),
          () => undefined,
        )
      },
    },
    id: 'dialog',
  }) as Dialog
}

/** The actions of the dialog plugin. */
type Actions = ReturnType<NonNullable<Dialog['actions']>>

/**
 * Throws `Accounts.RequestError` with `server_error` and status 0 for a load of the dialog's module
 * that fails in a browser without a connection, as the loaded sign-in throws offline, with the
 * failure as its `cause`. Rethrows any other failure.
 */
function unloaded(error: unknown): never {
  if (globalThis.navigator?.onLine !== false) throw error
  throw new RequestError({
    cause: error,
    code: 'server_error',
    message:
      'The browser is offline, so the sign-in receives no response. Check the connection, then sign in again.',
    status: 0,
  })
}

/**
 * Returns whether the browser reports whether anything covers an element, with IntersectionObserver
 * v2. Without it, `dialog()` loads the frame on every page.
 */
function visibility() {
  return (
    typeof IntersectionObserverEntry !== 'undefined' &&
    'isVisible' in IntersectionObserverEntry.prototype
  )
}
