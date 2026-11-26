/**
 * The `Accounts` namespace of the root entry: the one of `Accounts.ts`, whose `create` adds the
 * `dialog`, `funding`, and `mpp` plugins that an app does not name. `accounts/lite` exports the
 * namespace of `Accounts.ts` itself, so its bundle holds none of them.
 * @module
 */
import * as Accounts_core from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import { funding } from '../plugins/funding.js'
import * as DefaultDialog from './DefaultDialog.js'
import * as DefaultMpp from './DefaultMpp.js'

export * from '../Accounts.js'

/**
 * A Tempo ID instance of {@link create}: its configuration, its session, the namespace of each
 * plugin, and the `dialog`, `funding`, and `mpp` plugins that `plugins` lacks. `Accounts.ts`
 * describes its members.
 */
export type Accounts<
  plugins extends readonly Plugin.Plugin[] = readonly Plugin.Plugin[],
  guest extends Accounts_core.Config['guest'] = undefined,
> = Accounts_core.Accounts<WithMpp<WithFunding<WithSignIn<plugins>>>, guest>

/**
 * Creates an instance: its configuration, the session of its user, and one namespace for each
 * plugin. Each plugin adds a sign-in method or another set of actions, such as `email` or `viem`,
 * under its own name, such as `accounts.email`. An app bundles only the plugins that it imports.
 * `create` takes the options of `Accounts.from` but `par`, which each plugin of a redirect or a
 * dialog sets. With no options, the instance signs in through the dialog, with the page's origin
 * as its client ID.
 *
 * In a browser, the instance holds the session of its user and saves it to `store`, which
 * defaults to IndexedDB. Elsewhere, an instance with a `cli:` client ID saves it to the file of
 * `Store.file()`, which every CLI of the user shares, in a runtime with Node's file system
 * modules. Any other instance holds a session only with a `store`, such as `Store.file()` in a CLI
 * with a registered client ID. Without one, it holds none, since a backend's instance serves many
 * users. A service that signs in many users with a `cli:` client ID passes `store: false`, and
 * holds none either. An instance without a session runs its plugins' actions, and returns their
 * results, but keeps nothing. A backend keeps each user's session with the `backend` plugin
 * instead.
 *
 * An instance without a sign-in plugin (`backend`, `device`, `dialog`, `email`, `passkey`, or
 * `redirect`) receives the `dialog` plugin with its default options. Its code loads from a chunk
 * of its own on the first call of an action, so an app that names its sign-in plugins bundles none
 * of it. In a browser, the chunk loads as the instance is created on a page without a saved
 * session or with an expired one, and once the session ends. It then preloads the dialog's frame,
 * as the `dialog` plugin's `preload` describes. A page that restores a live session, or renews an
 * expired one through an authorization in progress, loads none of the chunk before the session
 * ends or an action runs.
 *
 * Every instance holds the `funding` plugin, which opens Tempo ID's deposit page, and the `mpp`
 * plugin of `accounts/mpp`, which adds `accounts.fetch` and `accounts.mpp`. An instance without one
 * of them receives it with its default options. The `mpp` plugin's code loads from a chunk of its
 * own at the first payment. An app passes `funding()` or `mpp()` only to set its options.
 *
 * Without `accessKey`, each sign-in without a challenge requests an access key that may transfer up
 * to 5 OUSD, and expires a day after the sign-in. `accessKey: false` requests none.
 *
 * @throws {ClientIdRequiredError} Outside a browser without `clientId`, where no page's origin can
 *   serve as one.
 * @throws {Error} For a plugin whose `id` is a member of every instance: `account`, `authorize`,
 *   `chain`, `config`, `connection`, `connections`, `handler`, `session`, `signOut`, or
 *   `switchChain`.
 * @throws {Error} With `connections.metadata`, for `clientAssertion`, `clientId`, or
 *   `clientSecret`, for a `connections.resource` with a query or a fragment, and for a `basePath`
 *   that does not start with `/` or sits inside `/.well-known/oauth-protected-resource`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { email, viem } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   // Each sign-in requests an access key that may transfer up to 10 OUSD for a day.
 *   accessKey: {
 *     expiry: '1d',
 *     limits: [{ limit: '10', token: 'ousd' }],
 *   },
 *   plugins: [email(), viem()],
 * })
 *
 * const session = await accounts.session.get()
 * ```
 */
export function create<
  const plugins extends readonly Plugin.Option[] = [],
  const guest extends Accounts_core.Config['guest'] = undefined,
>(
  options: Accounts_core.create.Options<plugins> & { guest?: guest } = {},
): Accounts<Plugin.Flatten<plugins>, guest> {
  const named = Plugin.flatten(options.plugins ?? [])
  const ids = new Set(named.map((plugin) => plugin.id))
  const signIn = [...ids].some((id) => DefaultDialog.signInIds.has(id))
  // An instance without a sign-in plugin signs in with the dialog, which loads on demand. Every
  // instance opens the deposit page and pays MPP endpoints, so one without the `funding` or the
  // `mpp` plugin receives it. The `mpp` plugin loads at the first payment.
  return Accounts_core.create({
    ...options,
    plugins: [
      ...named,
      ...(ids.has('funding') ? [] : [funding()]),
      ...(signIn ? [] : [DefaultDialog.plugin()]),
      ...(ids.has('mpp') ? [] : [DefaultMpp.plugin()]),
    ],
  }) as Accounts<Plugin.Flatten<plugins>, guest>
}

/**
 * Creates an instance as {@link create} does, with only the plugins in `plugins`. It adds no
 * `dialog`, `funding`, or `mpp` plugin, so an app bundles only the plugins that it names. An
 * instance without a sign-in plugin signs in only through `authorize`. `accounts/lite` exports it
 * as `Accounts.create`. Without `accessKey`, a sign-in requests the access key of {@link create}.
 *
 * @throws {ClientIdRequiredError} As {@link create} throws it.
 * @throws {Error} As {@link create} throws it.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts/lite'
 * import { dialog } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({ plugins: [dialog()] })
 *
 * await accounts.dialog.signIn()
 * ```
 */

export declare namespace create {
  type Options<
    plugins extends readonly Plugin.Option[] = readonly Plugin.Option[],
  > = Accounts_core.create.Options<plugins>
}

/** `plugins`, with the `dialog` plugin when none of them signs the user in. */
export type WithSignIn<plugins extends readonly Plugin.Plugin[]> =
  // A list whose IDs the type does not name, such as a widened `Plugin.Plugin[]`, may hold a
  // sign-in plugin, so its type promises no dialog.
  string extends plugins[number]['id']
    ? plugins
    : [Extract<plugins[number]['id'], DefaultDialog.SignInId>] extends [never]
      ? readonly [...plugins, DefaultDialog.Dialog]
      : plugins

/** `plugins`, with the `mpp` plugin and its default options when none of them is `mpp`. */
export type WithMpp<plugins extends readonly Plugin.Plugin[]> =
  // A list whose IDs the type does not name may hold the plugin, so its type promises none.
  string extends plugins[number]['id']
    ? plugins
    : 'mpp' extends plugins[number]['id']
      ? plugins
      : readonly [...plugins, DefaultMpp.Mpp]

/** `plugins`, with the `funding` plugin and its default options when none of them is `funding`. */
export type WithFunding<plugins extends readonly Plugin.Plugin[]> =
  // A list whose IDs the type does not name may hold the plugin, so its type promises none.
  string extends plugins[number]['id']
    ? plugins
    : 'funding' extends plugins[number]['id']
      ? plugins
      : readonly [...plugins, ReturnType<typeof funding>]
