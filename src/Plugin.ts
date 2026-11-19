/**
 * The contract of a plugin, which adds a namespace of actions to an instance, such as a sign-in
 * method. An app bundles only the plugins that it imports.
 * @module
 */
import type { KeyAuthorization } from 'ox/tempo'
import type * as Accounts from './Accounts.js'
import type * as AccountActions from './actions/account.js'
import type { Payment } from './internal/Payment.js'
import type {
  Change,
  ChangeOptions,
  Rotation,
  Status,
} from './internal/Session.js'
import type { Permissions } from './Permissions.js'
import type * as Session from './Session.js'

/** A plugin: its namespace's name, its actions, the configuration it sets, and its hooks. */
export type Plugin<
  id extends string = string,
  actions = unknown,
  members = unknown,
> = {
  /**
   * Builds the plugin's namespace on the instance, once, at `Accounts.create`. Absent, the plugin
   * adds no namespace.
   */
  actions?: ((context: Context) => actions) | undefined
  /**
   * Returns options of `Accounts.create` that the plugin sets, such as a platform's `store`. The options
   * that `Accounts.create` receives win over them, and a later plugin's win over an earlier one's.
   */
  config?: (() => Partial<Accounts.from.Options>) | undefined
  /**
   * Returns members that the plugin adds to the instance itself, such as the `react` plugin's
   * `useSession`, from the instance that the other plugins and the core build, and the context
   * that its actions receive. `Accounts.create` throws for a member whose name the instance holds.
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
         * A `session.reload` with `hooks` runs it for such a session too, such as at the `connect`
         * of the `tempoId` connector outside a page.
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
         * Returns a challenge that signs the user in to the app, such as the `siwe` plugin's, for
         * `dialog.signIn` without `challenge`, and for `pay` without `account` while the instance
         * holds no session. The first plugin that returns one takes the call. Runs
         * within the click, so it starts no request.
         */
        challenge?: ((context: Context) => Challenge | undefined) | undefined
        /**
         * Runs at `pay`, in the order of `plugins`, before the payment page shows. In a frame, the
         * payment page loads in a hidden dialog while the plugin sends, and the dialog shows only
         * once no plugin sent the payment. Returns the
         * transaction of a payment that the plugin sent, such as with the session's access key.
         * Returns `undefined` for a payment that it did not send, which the next plugin takes,
         * and then the payment page. A rejection rejects `pay`.
         */
        pay?:
          | ((
              context: Context,
              payment: Payment,
            ) =>
              | Promise<
                  Pick<AccountActions.pay.ReturnType, 'transaction'> | undefined
                >
              | undefined)
          | undefined
        /**
         * Runs at each `session.get()`, in the order of `plugins`, before it reads the session,
         * such as to complete a redirect's callback through `context.session.change()`.
         */
        restore?: ((context: Context) => Promise<void>) | undefined
      }
    | undefined
  /**
   * The name of the plugin's namespace on the instance, such as `email`. It cannot be the name of a
   * member that every instance holds, such as `account`, `authorize`, `config`, `session`, or
   * `signOut`. A plugin whose `id` is one of `backend`, `device`, `dialog`, `email`, `passkey`, or
   * `redirect` counts as a sign-in plugin, so the instance receives no default `dialog` plugin.
   */
  id: id
  /** Runs once at `Accounts.create`, after the plugin's `actions`, such as to preload a frame. */
  setup?: ((context: Context) => void) | undefined
}

/**
 * A challenge that signs the user in to the app beside a Tempo ID sign-in or a payment: the message
 * that the account signs, and the verification of its signature, whose result the call returns as
 * `auth`.
 */
export type Challenge = {
  /**
   * Returns the message that the account signs on the chain of `chainId`, such as from the app's
   * challenge route. It runs after the dialog or the popup opens, and again for a sign-in that
   * retries outside the gesture. Its signal aborts once the call ends.
   */
  message: (options: Challenge.Options) => Promise<string>
  /**
   * Verifies the signature of the last message, such as at the app's verify route, and returns the
   * result, such as `{ token }`.
   */
  settle: (signed: Challenge.Signed) => Promise<Challenge.Result>
}

export declare namespace Challenge {
  /** The request of a challenge's message. */
  type Options = {
    /** The chain of the sign-in or the payment, which the message names. */
    chainId: number
    /** Aborts once the call ends. */
    signal: AbortSignal
  }

  /** The account's signature of the challenge's message. */
  type Signed = {
    /**
     * The proof of a sign-in with an access key, in place of the message's own signature: the
     * account signed the key authorization, whose witness is the message's EIP-191 hash. Absent
     * without an access key.
     */
    accessKey?:
      | {
          /** The access token of the same sign-in, which names the access key for the app. */
          accessToken: string
          /** The signed key authorization, in RPC format. */
          keyAuthorization: KeyAuthorization.Rpc
        }
      | undefined
    /** The Tempo Account that signed. */
    address: `0x${string}`
    /** The message that the account signed. */
    message: string
    /**
     * The account's signature of the message's EIP-191 hash, or, with `accessKey`, of the key
     * authorization.
     */
    signature: `0x${string}`
  }

  /** The verification's result, such as the app's `{ token }`. */
  type Result = {
    /** The app's token, for a verification that returns one. */
    token?: string | undefined
    readonly [key: string]: unknown
  }
}

/** What each of a plugin's functions receives from its instance. */
export type Context = {
  /**
   * Returns the access key of a sign-in that names none, or `undefined` for a sign-in without an
   * access key.
   */
  accessKey: () => Permissions | undefined
  /** The instance's chain, which `switchChain` selects. */
  chain: {
    /**
     * The configured `chainId`, which `switchChain` never changes, such as the chain of a plugin's
     * single-chain options.
     */
    configured: number
    /** Returns the instance's chain ID. */
    get: () => number
    /**
     * Reads the stored selection once, and applies it. Rejects when the read fails, and the next
     * call reads again.
     */
    load: () => Promise<void>
    /** Calls `listener` at each change of the chain. Returns the function that unsubscribes. */
    subscribe: (
      listener: (chainId: number, previous: number) => void,
    ) => () => void
  }
  /**
   * Returns the challenge of the first plugin whose `challenge` hook returns one, or `undefined`
   * without one.
   */
  challenge: () => Challenge | undefined
  /**
   * The instance's configuration, which every action of `Actions` takes. Its `chainId` returns the
   * instance's chain at each read.
   */
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
    /**
     * Revokes the refresh token of `session`, which no change saved, such as a renewal that a retry
     * discards, beside the caller. It ends no Tempo ID session. A revocation without an answer
     * enters the store's unanswered entry, so the next sign-out sends it again.
     */
    discard: (session: Session.Session) => void
    /**
     * Resolves once every sign-out that runs now settles, with its revocation and logout, with
     * whether one ran. Resolves at once with `false` without one. Never rejects. A plugin that
     * leaves the page, such as for a redirect, waits for it, since the page's departure aborts the
     * requests in flight.
     */
    ended: () => Promise<boolean>
    /** Returns the session, without reading the store. */
    get: () => Session.Session | undefined
    /**
     * Runs `fn` while no other run of the same session's `exclusive` does, also in another tab of
     * a browser.
     */
    exclusive: <value>(fn: () => Promise<value>) => Promise<value>
    /**
     * Reads the stored session once, and returns the session. `options.locked` marks a caller that
     * holds `exclusive`, so the empty write of an expired session takes no lock again.
     */
    load: (options?: {
      locked?: boolean | undefined
    }) => Promise<Session.Session | undefined>
    /**
     * Reads the stored session again, and returns the session. Sets the stored session when it is
     * the same user's with other tokens, such as after another tab's refresh. With `hooks`, an
     * adoption in place of no session, or another user's, runs the plugins' `afterSignIn` hooks,
     * for a caller that commits no session after it. Defaults to `false`.
     */
    reload: (options?: {
      /** Whether an adoption runs the plugins' `afterSignIn` hooks. Defaults to `false`. */
      hooks?: boolean | undefined
    }) => Promise<Session.Session | undefined>
    /**
     * Returns the saved session whose access key expired, which the next authorization in this
     * instance renews. `undefined` after a change sets a session, and after a sign-out. The store
     * does not hold it, so a later instance on the same store holds none.
     */
    renewing: () => Session.Session | undefined
    /**
     * Reads the store's refresh token rotations, which a change with `sent` takes as its
     * `rotations`, so the read runs beside the read of the token. Resolves `undefined` when the
     * read fails. Never rejects.
     */
    rotations: () => Promise<readonly Rotation[] | undefined>
    /**
     * Resolves once every authorization that runs now, through `authorize`, settles, with whether one
     * ran. Resolves at once with `false` without one. Never rejects.
     */
    settled: () => Promise<boolean>
    /**
     * Resolves with whether a sign-out without `everywhere`, or one with it that rejects or whose
     * logout has no answer yet, followed the last sign-in, in this instance or in another one on the
     * same store. A logout without an answer includes one that a reload interrupted, until the next
     * sign-in. Such a sign-out can keep the browser's Tempo ID session, so a plugin that acts on that session, such as
     * `passkey.register`, refuses while it resolves `true`. While a sign-out runs in the instance,
     * resolves with `true`. After it, the call reads the store, and sets the session of another
     * instance's later sign-in, which runs `afterSignIn`. Never rejects.
     */
    signedOut: () => Promise<boolean>
    /**
     * The session's status, as `accounts.session.status` returns it: `pending` before the instance
     * reads its saved session, and while a sign-in runs.
     */
    status: Status
  }
}

/**
 * Instantiates a {@link Plugin}, which adds a namespace of actions to an instance, and returns it
 * as it was given. It keeps its `id` and actions as literal types, so the instance's type holds
 * `accounts[id]`. The built-in plugins of `accounts/plugins` use it. An app writes a plugin of its
 * own for actions that share the instance's configuration and session, or for hooks at the
 * instance's sign-in and sign-out.
 *
 * @example
 * ```ts
 * import { Accounts, Plugin } from 'accounts'
 *
 * function profile() {
 *   return Plugin.from({
 *     actions: (context) => ({
 *       email: () => context.session.get()?.user.email,
 *     }),
 *     extend: (instance) => ({ clientIdOf: () => instance.config.clientId }),
 *     hooks: {
 *       afterSignIn: (context, session) => analytics.identify(session.user.id),
 *     },
 *     id: 'profile',
 *     setup: (context) => void fetch(new URL('/health', context.config.url)),
 *   })
 * }
 *
 * const accounts = Accounts.create({ plugins: [profile()] })
 * const email = accounts.profile.email()
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
 * An entry of `Accounts.create`'s `plugins`: a plugin, a list of entries, such as a preset that
 * combines plugins, or a falsy value, which adds nothing, as `enabled && email()` returns. A preset
 * is a function that returns a list of plugins, as Vite's plugins do. `Accounts.create` flattens
 * each list in order. The `expo` preset returns a plugin whose `config` sets the store and the
 * redirect URI, and the `redirect` plugin.
 *
 * @example
 * ```ts
 * import { Accounts, Plugin } from 'accounts'
 * import { redirect, viem } from 'accounts/plugins'
 *
 * const preset = (options: { redirectUri: string }) => [
 *   Plugin.from({
 *     config: () => ({ redirectUri: options.redirectUri }),
 *     id: 'preset',
 *   }),
 *   redirect(),
 * ]
 *
 * const accounts = Accounts.create({ plugins: [preset({ redirectUri }), viem()] })
 * ```
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
