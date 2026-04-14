import { hc } from 'hono/client'

import type { App } from '../../worker/index.js'

/** Type-safe Hono RPC client for the connect worker API. */
export const api = hc<App>('/')
