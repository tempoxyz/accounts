/**
 * Runs the backend playground on Node, with one instance for each app, whose `backend` holds
 * its sessions in memory.
 *
 * ```sh
 * node --import tsx --env-file-if-exists=.env index.ts
 * ```
 * @module
 */
import * as fs from 'node:fs'
import { serve } from '@hono/node-server'
import { Store } from 'accounts'
import { create, instance } from './app.ts'

// Docker Compose sets `HOST` to `0.0.0.0`, so the published port reaches the container.
const hostname = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 5175)

// One instance serves every request of an app, so concurrent requests of a session share one
// refresh. A restart signs every user out of the app.
const instances = new Map<string, ReturnType<typeof instance>>()
const app = create({
  stylesheet: fs.readFileSync(
    new URL('../web/style.css', import.meta.url),
    'utf8',
  ),
  tempoId: (env, options) => {
    const existing = instances.get(options.clientId)
    if (existing) return existing
    const tempoId = instance(env, {
      backend: { store: Store.memory() },
      clientId: options.clientId,
    })
    instances.set(options.clientId, tempoId)
    return tempoId
  },
})

serve(
  {
    fetch: (request) => app.fetch(request, process.env),
    hostname,
    port,
  },
  (info) =>
    console.log(
      `Backend playground listening on http://${hostname}:${info.port}`,
    ),
)
