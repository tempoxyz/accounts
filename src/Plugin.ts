/**
 * The contract of a plugin, which adds a namespace of actions to an instance, such as a sign-in
 * method. An app bundles only the plugins that it imports.
 * @module
 */
import type * as Accounts from './Accounts.js'
import type { Change, ChangeOptions } from './internal/Session.js'
import type { Permissions } from './Permissions.js'
import type * as Session from './Session.js'

/** A plugin: its namespace's name, its actions, the configuration it sets, and its hooks. */
export type Plugin<
  id extends string = string,
  actions = unknown,
  members = unknown,
> = {
  /** Builds the plugin's namespace on the instance. Absent, the plugin adds no namespace. */
  actions?: ((context: Context) => actions) | undefined
  /**
   * Returns options of `Accounts.create` that the plugin sets, such as a platform's `store`. The options
   * that `Accounts.create` receives win over them, and a later plugin's win over an earlier one's.
   */
  config?: (() => Partial<Accounts.from.Options>) | undefined
  /**
   * Returns members that the plugin adds to the instance itself, such as React hooks, from the
   * instance that the other plugins and the core build, and the context that its actions receive.
   * A member may not take an existing name.
   */
  extend?:
    | ((instance: Accounts.Accounts, context: Context) => members)
    | undefined
  /** Runs at the points of the instance's lifecycle. */
  hooks?:
    | {
        /**
         * Runs after a change sets a session, in the order of `plugins`. In a browser, it also runs
         * after another tab's sign-in sets a session where this instance held none or another user's.
         */
        afterSignIn?:
          | ((
              context: Context,
              session: Session.Session,
            ) => Promise<void> | void)
          | undefined
        /**
         * Runs after `signOut`, in the order of `plugins`. In a browser, it also runs after another
         * tab's sign-out empties this instance's session.
         */
        afterSignOut?: ((context: Context) => Promise<void> | void) | undefined
        /**
         * Runs at the start of `signOut`, in the order of `plugins`, while the instance ends the session.
         * `signOut` waits for it. It runs also when the sign-out rejects, such as for a revocation that
         * received no answer.
         */
        beforeSignOut?: ((context: Context) => Promise<void> | void) | undefined
        /**
         * Runs at `session.get()` before it reads the session, such as to complete a redirect's
         * callback through `context.session.change()`.
         */
        restore?: ((context: Context) => Promise<void>) | undefined
      }
    | undefined
  /** The name of the plugin's namespace on the instance, such as `email`. */
  id: id
  /** Runs once at `Accounts.create`, such as to preload a frame. */
  setup?: ((context: Context) => void) | undefined
}

/** What each of a plugin's functions receives from its instance. */
export type Context = {
  /**
   * Returns the access key of a sign-in that names none, or `undefined` for a sign-in without an
   * access key.
   */
  accessKey: () => Permissions | undefined
  /** The instance's configuration, which every action of `Actions` takes. */
  config: Accounts.Config
  /** The instance's session. */
  session: {
    /**
     * Runs `fn`, an authorization of the browser's Tempo ID session, and holds the session's status at
     * `pending`, or at `reauthorizing` while it renews a saved session that expired.
     */
    authorize: <value>(fn: () => Promise<value>) => Promise<value>
    /**
     * Begins a change to the session. The only way to change it: the change holds the race guard
     * and saves the session.
     */
    change: (options?: ChangeOptions) => Change
    /** Returns the session, without reading the store. */
    get: () => Session.Session | undefined
    /**
     * Runs `fn` while no other run of the same session's `exclusive` does, also in another tab of
     * a browser.
     */
    exclusive: <value>(fn: () => Promise<value>) => Promise<value>
    /** Reads the stored session once, and returns the session. */
    load: () => Promise<Session.Session | undefined>
    /**
     * Reads the stored session again, and returns the session. Sets the stored session when it is
     * the same user's with other tokens, such as after another tab's refresh.
     */
    reload: () => Promise<Session.Session | undefined>
  }
}

/**
 * Instantiates a {@link Plugin}, and keeps its `id` and actions as literal types.
 *
 * @example
 * ```ts
 * export function hello() {
 *   return Plugin.from({
 *     actions: (context) => ({ clientId: () => context.config.clientId }),
 *     id: 'hello',
 *   })
 * }
 * ```
 */
export function from<
  const id extends string,
  actions = unknown,
  members = unknown,
>(plugin: Plugin<id, actions, members>): Plugin<id, actions, members> {
  return plugin
}

/** The namespaces that `plugins` add to an instance, one for each plugin, by its `id`. */
export type Namespaces<plugins extends readonly Plugin[]> = {
  [
    plugin in plugins[number] as unknown extends ActionsOf<plugin>
      ? never
      : plugin['id']
  ]: ActionsOf<plugin>
}

/** The actions of `plugin`, or `unknown` for a plugin without actions. */
type ActionsOf<plugin> =
  plugin extends Plugin<string, infer actions> ? actions : never

/** The members that `plugins` add to an instance itself, through `extend`. */
export type Members<plugins extends readonly Plugin[]> = Intersection<
  MembersOf<plugins[number]>
>

/** The members of `plugin`, or `never` for a plugin without members. */
type MembersOf<plugin> =
  plugin extends Plugin<string, unknown, infer members>
    ? unknown extends members
      ? never
      : members
    : never

/** The intersection of the members of a union. */
type Intersection<union> = [union] extends [never]
  ? unknown
  : (union extends unknown ? (value: union) => void : never) extends (
        value: infer intersection,
      ) => void
    ? intersection
    : never

/**
 * An entry of `Accounts.create`'s `plugins`: a plugin, a list of entries, such as a preset that combines
 * plugins, or a falsy value, which adds nothing, as `enabled && email()` returns.
 */
export type Option = Plugin | false | null | undefined | readonly Option[]

/** The plugins of `options`, flattened in order, without the falsy entries. */
export type Flatten<options extends readonly unknown[]> =
  options extends readonly []
    ? readonly []
    : options extends readonly [infer head, ...infer tail]
      ? readonly [
          ...(head extends readonly unknown[]
            ? Flatten<head>
            : head extends Plugin
              ? readonly [head]
              : readonly []),
          ...Flatten<tail>,
        ]
      : options extends readonly (infer entry)[]
        ? readonly Extract<entry, Plugin>[]
        : readonly []

/** Returns the plugins of `options`, flattened in order, without the falsy entries. */
export function flatten(options: readonly Option[]): readonly Plugin[] {
  return options.flatMap((option) => {
    if (!option) return []
    if (Array.isArray(option)) return flatten(option as readonly Option[])
    return [option as Plugin]
  })
}
