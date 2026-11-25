/**
 * The MPP plugin of an instance that receives no `mpp` plugin. It loads `accounts/mpp` from its own
 * chunk at the first payment, so an instance that pays nothing loads none of mppx.
 * @module
 */
import * as Accounts from '../Accounts.js'
import type { mpp } from '../mpp/index.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as SessionManager from './mpp/SessionManager.js'

/** The MPP plugin, with its default options. */
export type Mpp = ReturnType<typeof mpp>

/** The members of the MPP plugin: `fetch` and `mpp`. */
type Members = ReturnType<NonNullable<Mpp['extend']>>

/**
 * Returns the MPP plugin, whose module loads at the first call of `fetch`, of a payer's `fetch`, or
 * of a request of a session manager or an MCP tool. A payer and a session manager return at once,
 * so a payer's refusal of its overrides, such as a malformed `maxAmount`, rejects that first call.
 */
export function plugin(): Mpp {
  return Plugin.from({
    extend(instance: Accounts.Accounts, context: Plugin.Context): Members {
      let loading: Promise<Members> | undefined
      // The changes that ended the instance's session, or replaced it with one of another user,
      // account, or start of a guest session. A guest session holds no access key, so only this
      // count tells a sign-out and a later guest session from the session that a manager holds.
      let ends = 0
      instance.session.subscribe((next, before) => {
        if (!before || !Session.same(next, before)) ends++
        // A sign-out keeps the guest key pair, so another start of the guest session, such as one
        // that a reload adopts from another process, holds the same account with a later revision.
        else if (
          Session.guest(before) &&
          Session.guest(next) &&
          next.revision !== before.revision
        )
          ends++
      })

      /** Loads the plugin once. A failed load, such as offline, lets the next call try again. */
      function load() {
        loading ??= import('../mpp/index.js')
          .then((module) => {
            const loaded = module.mpp()
            loaded.setup?.(context)
            return loaded.extend!(instance, context)
          })
          .catch((error: unknown) => {
            loading = undefined
            throw error
          })
        return loading
      }

      /** Returns the payer of `overrides`, whose loaded payer each call creates once. */
      function bind(overrides?: mpp.Overrides): mpp.Payer {
        let payer: Promise<mpp.Payer> | undefined
        const get = () => {
          payer ??= load()
            .then((members) => members.mpp(overrides))
            .catch((error: unknown) => {
              payer = undefined
              throw error
            })
          return payer
        }
        return {
          fetch: async (input, init) => (await get()).fetch(input, init),
          mcp: (client) => ({
            callTool: async (...args) =>
              (await get()).mcp(client).callTool(...args),
          }),
          session: (parameters) => {
            // A manager created with a session pays with that session alone, as the loaded plugin's
            // does. A sign-out or another session since its creation ends it. Each sign-in generates
            // a new access key, so another access key at its first request means `switchChain`.
            const held = overrides?.session ? undefined : context.session.get()
            const keyId = held?.accessKey?.keyAuthorization.keyId
            const started = ends
            return SessionManager.deferred(async () => {
              const payer = await get()
              const active =
                context.session.get()?.accessKey?.keyAuthorization.keyId
              if (held && (ends !== started || active !== keyId))
                throw new Accounts.SignedOutError()
              return payer.session(parameters)
            })
          },
        }
      }

      const current = bind()

      return {
        fetch: current.fetch,
        mpp: Object.assign(bind, { session: current.session }),
      }
    },
    id: 'mpp',
  }) as Mpp
}
