/**
 * Runs the API playground on Node.
 *
 * ```sh
 * node index.ts
 * ```
 * @module
 */
import { serve } from '@hono/node-server'
import { app } from './app.ts'

// Docker Compose sets `HOST` to `0.0.0.0`, so the published port reaches the container.
const hostname = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 5176)

serve(
  {
    // The Node entry runs only locally, so its MPP routes generate the keys that the environment omits.
    fetch: (request) =>
      app.fetch(request, { MPP_LOCAL: 'true', ...process.env }),
    hostname,
    port,
  },
  (info) => console.log(`API listening on http://${hostname}:${info.port}`),
)
