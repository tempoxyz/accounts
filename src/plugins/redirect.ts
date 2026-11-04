/**
 * The plugin of sign-in through a redirect to Tempo ID's pages: in the page's own window, or with
 * `open`, in a system browser on a device.
 * @module
 */
import { Bytes, Hex } from 'ox'
import * as Actions from '../internal/Actions.js'
import type * as Funding from '../internal/Funding.js'
import * as DefaultStore from '../internal/defaultStore.js'
import * as SignIn from '../internal/signIn.js'
import * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'

/**
 * Returns the plugin of sign-in through a redirect, which adds `redirect.prefetch` and `redirect.signIn`. Without `open`,
 * the sign-in leaves the page, and `session.get()` completes it on the redirect URI's page. With
 * `open`, which shows the URL and resolves with the callback URL, the sign-in resolves with the
 * session, such as on a device.
 *
 * @example
 * ```ts
 * const accounts = Accounts.create({
 *   plugins: [
 *     redirect({
 *       open: async (url) => (await WebBrowser.openAuthSessionAsync(url, redirectUri)).url,
 *     }),
 *   ],
 *   redirectUri: 'myapp://callback',
 * })
 *
 * const session = await accounts.redirect.signIn()
 * ```
 */
export function redirect(options: redirect.Options = {}) {
  const { open, par } = options
  // One configuration with `par` for each instance, so its actions and its hooks share the state
  // that the actions keep by configuration, such as the preloaded frame.
  const configs = new WeakMap<
    Plugin.Context['config'],
    Plugin.Context['config']
  >()
  /** Returns the instance's configuration, with `par` when the plugin sets it. */
  function configOf(context: Plugin.Context) {
    if (par === undefined) return context.config
    let config = configs.get(context.config)
    if (!config)
      configs.set(context.config, (config = { ...context.config, par }))
    return config
  }
  // A page load completes each instance's redirect once, so a later `session.get()` never applies it
  // again. Each call that starts before the completion settles receives its refusal, and a later
  // call receives none. An instance's configuration keys it, so instances that share the plugin keep
  // their own.
  const completing = new WeakMap<Plugin.Context['config'], Promise<void>>()
  // The flag of each instance that signed out since its last sign-in through `open`, so a sign-in that
  // starts before the stored flag is written still sends `prompt=login`.
  const signingOut = new WeakMap<Plugin.Context['config'], string>()
  // The number of sign-outs of each instance, so a sign-in removes the flag only when no sign-out
  // started since it read the flag.
  const signOuts = new WeakMap<Plugin.Context['config'], number>()

  return Plugin.from({
    actions: (context) => {
      const config = configOf(context)

      return {
        /**
         * Prefetches the scripts and style sheets of Tempo ID's sign-in page, so the page that
         * `redirect.signIn` opens loads them from the browser's cache. Returns their URLs. Outside a
         * browser, it prefetches nothing. Never throws.
         */
        prefetch: (): Promise<readonly string[]> =>
          Actions.redirect.prefetch(config),
        /**
         * Sends the user to Tempo ID's sign-in. Without `open`, the page leaves, and the promise
         * resolves with `undefined`. With `open`, it sets the instance's session and returns it, or
         * returns `undefined` when `open` resolves with no URL, such as a dismissed browser.
         */
        async signIn(
          parameters: redirect.signIn.Parameters = {},
        ): Promise<Session.Session | undefined> {
          const accessKey = SignIn.accessKey(context, parameters.accessKey)
          const request = {
            accessKey,
            challenge: parameters.challenge,
            funding: parameters.funding,
          }
          if (!open) {
            await Actions.redirect.start(config, request)
            return undefined
          }

          const change = context.session.change()
          // The system browser keeps its Tempo ID session after the app signs out, so the first
          // sign-in after a sign-out asks the user to sign in again, also after a restart of the app.
          // The flag only adds the prompt, so a failed read or removal of it never fails the sign-in.
          const store = DefaultStore.get(context.config.store)
          const started = signOuts.get(context.config) ?? 0
          // Each sign-out writes a flag of its own, so a sign-in removes only the flag that it read, not
          // a newer one that another instance on the same store wrote since.
          const own = signingOut.get(context.config)
          const stored = await store
            ?.getItem(signedOutKey(context.config))
            .catch(() => undefined)
          // A custom store may return `null` for a missing item.
          const signedOut = own !== undefined || stored != null
          const { pending, url } = await Actions.redirect.createUrl(config, {
            ...request,
            ...(signedOut ? { prompt: 'login' as const } : {}),
          })
          const callback = await open(url)
          if (!callback) return undefined
          const result = await Actions.redirect
            .handleCallback(config, { pending, url: callback })
            .catch(change.fail)
          const session = SignIn.toSession(result)
          await change.commit(session)
          if ((signOuts.get(context.config) ?? 0) !== started) return session
          signingOut.delete(context.config)
          if (!signedOut) return session
          await (async () => {
            const current = await store?.getItem(signedOutKey(context.config))
            if (current == null) return
            if (current !== stored && current !== own) return
            // A sign-out of this instance during the read writes a newer flag, which stays. The store
            // has no atomic removal, so another instance's sign-out at this moment can still lose its
            // flag.
            if ((signOuts.get(context.config) ?? 0) !== started) return
            await store?.removeItem(signedOutKey(context.config))
          })().catch(() => undefined)
          return session
        },
      }
    },
    hooks: {
      async beforeSignOut(context) {
        // A system browser's Tempo ID session outlives the app's sign-out, also one with
        // `everywhere`, since its logout sends the app's cookies, not the browser's. The flag is set
        // before the sign-out starts, so a sign-in that overlaps the sign-out, or follows a sign-out
        // that rejects, sends `prompt=login`. A failed write of the stored flag never fails the
        // sign-out.
        if (!open) return
        const flag = Hex.fromBytes(Bytes.random(16))
        signingOut.set(context.config, flag)
        signOuts.set(context.config, (signOuts.get(context.config) ?? 0) + 1)
        await DefaultStore.get(context.config.store)
          ?.setItem(signedOutKey(context.config), flag)
          .catch(() => undefined)
      },
      restore(context) {
        // Only a page in a window holds a redirect's callback.
        if (open || typeof location === 'undefined') return Promise.resolve()
        const pending = completing.get(context.config)
        if (pending) return pending
        const completion = (async () => {
          const change = context.session.change()
          const config = configOf(context)
          // A page holds one result for each app and chain, a failure too, which applies once.
          const result = await Actions.redirect
            .complete(config)
            .catch((error: unknown) => {
              if (typeof error === 'object' && error !== null) {
                if (applied.has(error)) return undefined
                applied.add(error)
              }
              return change.fail(error)
            })
          // `undefined` means the page is not a callback. The page holds one result for each app and
          // chain, which applies once, so an instance created after a sign-out restores no session.
          if (!result || applied.has(result)) return
          applied.add(result)
          await change.commit(SignIn.toSession(result))
        })().finally(() => {
          completing.set(context.config, Promise.resolve())
        })
        completing.set(context.config, completion)
        return completion
      },
    },
    id: 'redirect',
  })
}

export declare namespace redirect {
  type Options = {
    /**
     * Shows the sign-in URL, such as in a system browser, and resolves with the callback URL, or with
     * `undefined` when the user dismissed it. Absent, the page leaves for the URL.
     */
    open?: ((url: string) => Promise<string | undefined>) | undefined
    /** Whether each request goes to `/oauth2/par` first (RFC 9126). Defaults to the instance's. */
    par?: boolean | undefined
  }

  namespace signIn {
    type Parameters = {
      /**
       * The access key to request: what it may do, a function that returns it, or `false` for a
       * sign-in without an access key. Defaults to the instance's `accessKey`.
       */
      accessKey?: SignIn.AccessKeyOption
      /** A message whose EIP-191 hash the key authorization binds as its `witness`. */
      challenge?: string | undefined
      /** The amount that the app needs in the user's account, which opens the funding page. */
      funding?: Funding.Funding | undefined
    }
  }
}

/**
 * Returns the store's key of a sign-out in an app that signs in through a system browser. The key
 * names the deployment and the app, as the session's key does.
 */
function signedOutKey(config: Plugin.Context['config']) {
  return `tempo-id:signed-out:${JSON.stringify([new URL(config.url).origin, config.clientId])}`
}

/** The results and failures of `Actions.redirect.complete` that an instance applied, of every instance on the page. */
const applied = new WeakSet<object>()
