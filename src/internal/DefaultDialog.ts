/**
 * The dialog plugin of an instance that receives no sign-in plugin. It loads `dialog` from its own
 * chunk, so an app that names its sign-in plugins bundles none of the dialog's code.
 * @module
 */
import * as Plugin from '../Plugin.js'
import type { dialog } from '../plugins/dialog.js'

/** The IDs of the plugins that sign the user in. An instance with none receives {@link plugin}. */
export const signInIds = new Set([
  'backend',
  'device',
  'dialog',
  'email',
  'passkey',
  'redirect',
])

/** The ID of a plugin that signs the user in. */
export type SignInId =
  | 'backend'
  | 'device'
  | 'dialog'
  | 'email'
  | 'passkey'
  | 'redirect'

/** The dialog plugin, with its default options. */
export type Dialog = ReturnType<typeof dialog>

/**
 * Returns the dialog plugin, whose module loads on the first call of an action. In a browser, the
 * module starts to load as the instance is created, and then preloads the dialog's frame, as
 * `dialog()` does.
 */
export function plugin(): Dialog {
  let loading: Promise<Dialog> | undefined

  /** Loads the dialog plugin once. A failed load, such as offline, lets the next call try again. */
  function load() {
    loading ??= import('../plugins/dialog.js')
      .then((module) => module.dialog())
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
        signIn: async (parameters?: dialog.signIn.Parameters) =>
          (await get()).signIn(parameters),
      } satisfies Actions
    },
    id: 'dialog',
    setup(context) {
      // The instance can be created outside a browser, such as on a server that renders the page.
      if (typeof document === 'undefined') return
      // The frame's preload is an optimization, so a failed load leaves the first sign-in to load it.
      void load().then(
        (loaded) => loaded.setup?.(context),
        () => undefined,
      )
    },
  }) as Dialog
}

/** The actions of the dialog plugin. */
type Actions = ReturnType<NonNullable<Dialog['actions']>>
