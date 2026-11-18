/**
 * The Worker of the site. It serves the routes of the demos, under `/api/<topic>`. Cloudflare
 * serves each other path from the files of the build, and never calls the Worker for it.
 * @module
 */
import * as AccessKeys from './AccessKeys.ts'
import * as AccountProof from './AccountProof.ts'
import * as ApiAuthentication from './ApiAuthentication.ts'
import * as Backend from './Backend.ts'
import * as Connections from './Connections.ts'
import * as FeeSponsorship from './FeeSponsorship.ts'
import * as Identity from './Identity.ts'
import * as Mpp from './Mpp.ts'
import * as Payments from './Payments.ts'
import * as Sessions from './Sessions.ts'
import * as SignOut from './SignOut.ts'
import * as Siwe from './Siwe.ts'
import * as Subscriptions from './Subscriptions.ts'

/** A route of a topic, as a function of the Fetch API. */
type Route = (request: Request) => Promise<Response> | Response

/** The route of each topic, by the path that each of its routes starts with. */
const routes: Record<string, Route> = {
  [AccessKeys.path]: AccessKeys.fetch,
  [AccountProof.path]: AccountProof.fetch,
  [ApiAuthentication.path]: ApiAuthentication.fetch,
  [Backend.path]: Backend.fetch,
  [Connections.path]: Connections.fetch,
  [FeeSponsorship.path]: FeeSponsorship.fetch,
  [Identity.path]: Identity.fetch,
  [Mpp.path]: Mpp.fetch,
  [Payments.path]: Payments.fetch,
  [Sessions.path]: Sessions.fetch,
  [SignOut.path]: SignOut.fetch,
  [Siwe.path]: Siwe.fetch,
  [Subscriptions.path]: Subscriptions.fetch,
}

export default {
  fetch(request) {
    const { pathname } = new URL(request.url)
    const route = routes[pathname.split('/', 3).join('/')]
    if (!route) return Response.json({ error: 'not_found' }, { status: 404 })
    return route(request)
  },
} satisfies ExportedHandler
