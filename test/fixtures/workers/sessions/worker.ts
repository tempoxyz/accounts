/**
 * Runs `DurableObject.sessions` and `Plugins.backend({ namespace })` for
 * `src/cloudflare/DurableObject.test.ts`. `POST /` calls one action of `tempoId.backend`, whose
 * sessions live in the Durable Object of each session ID, and responds with its result, or its
 * error's name and fields.
 * @module
 */
import { DurableObject, Id } from 'accounts/cloudflare'
import * as Plugins from 'accounts/plugins'

/** The bindings of the Worker. */
type Bindings = {
  /** The app's client ID. */
  CLIENT_ID: string
  /** The app's client secret. */
  CLIENT_SECRET: string
  /** The Durable Object of each session ID. */
  SESSIONS: Plugins.backend.Namespace
  /** Where the harness serves Tempo ID. */
  URL: string
}

/** The sessions of the app, one Durable Object for each session ID, which refuses another app. */
export const SESSIONS = DurableObject.sessions(
  (env: Bindings, options: { clientId: string }) => {
    if (options.clientId !== env.CLIENT_ID)
      throw new Error(`Unknown client ID: ${options.clientId}.`)
    return { clientSecret: env.CLIENT_SECRET, url: env.URL }
  },
)

export default {
  async fetch(request: Request, env: Bindings) {
    const { action, parameters } = (await request.json()) as {
      action: 'complete' | 'end' | 'fetch' | 'get' | 'start'
      parameters: Record<string, unknown>
    }
    // The instance names its chain and redirect URI, which the Durable Object's configuration
    // leaves out, so `backend.start` sends both.
    const tempoId = Id.create({
      chainId: 42431,
      clientId: env.CLIENT_ID,
      clientSecret: env.CLIENT_SECRET,
      plugins: [Plugins.backend({ namespace: env.SESSIONS })],
      redirectUri: 'https://app.example.com/callback',
      url: env.URL,
    })
    try {
      // A response does not serialize, so `fetch` returns its status and its JSON body.
      if (action === 'fetch') {
        const response = await tempoId.backend.fetch(
          parameters as { id: string; url: string },
        )
        return Response.json({
          result: response
            ? { body: await response.json(), status: response.status }
            : null,
        })
      }
      const run = tempoId.backend[action] as (
        parameters: unknown,
      ) => Promise<unknown>
      return Response.json({ result: (await run(parameters)) ?? null })
    } catch (error) {
      const { name, reason, signedIn } = error as Id.RequestError
      return Response.json({ error: { name, reason, signedIn } })
    }
  },
}
