/**
 * The MPP plugin of an instance that receives no `mpp` plugin. It loads `accounts/mpp` from its own
 * chunk at the first payment, so an instance that pays nothing loads none of mppx.
 * @module
 */
import * as Accounts from '../Accounts.js'
import type { mpp } from '../mpp/index.js'
import * as Plugin from '../Plugin.js'
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
            // A manager created with a session pays with that session's access key alone, as the
            // loaded plugin's does. A sign-out before its first request ends it, also after a later
            // sign-in, and so does another access key, such as after `switchChain`.
            const held = overrides?.session ? undefined : context.session.get()
            // Whether a change of the session replaced or dropped its access key. One subscription
            // per manager holds it, and ends at the first such change.
            let ended = false
            if (held) {
              const keyId = held.accessKey?.keyAuthorization.keyId
              const unsubscribe = instance.session.subscribe((next) => {
                if (next?.accessKey?.keyAuthorization.keyId === keyId) return
                ended = true
                unsubscribe()
              })
            }
            return SessionManager.deferred(async () => {
              const payer = await get()
              if (ended) throw new Accounts.SignedOutError()
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
