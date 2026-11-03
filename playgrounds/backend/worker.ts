/**
 * Runs the backend playground on Cloudflare Workers. Each app's session ID names a Durable Object,
 * which serves every request of that session and holds the session in its storage.
 * @module
 */
import { DurableObject } from 'accounts/cloudflare'
import type { backend } from 'accounts/plugins'
import stylesheet from '../web/style.css'
import { create, type Env, instance, settings } from './app.ts'

/** The Worker's bindings. */
type Bindings = Env & {
  /** The Durable Object of each app's session ID, of the class {@link SESSIONS}. */
  SESSIONS: backend.Namespace
}

/**
 * The session of one app's session ID, in the object's storage. Refuses an app that `CLIENT_ID` does
 * not list.
 */
export const SESSIONS = DurableObject.sessions(settings)

// Each request creates its instance, since the session's Durable Object shares its refreshes.
export default create({
  stylesheet,
  tempoId: (env, options) =>
    instance(env, {
      backend: { namespace: (env as Bindings).SESSIONS },
      clientId: options.clientId,
    }),
})
