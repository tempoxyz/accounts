/**
 * The server routes of an instance, in one handler: the access key endpoint and the metadata of an
 * API's `connections`,
 * the sign-in routes of the `backend` and `siwe` plugins, and, if the app opts in, the relay route of
 * the `relay` plugin. `accounts.handler` loads it at
 * its first request, so a page's bundle holds none of it.
 * @module
 */
import * as Handler from '../Handler.js'
import * as BackendHandler from './Backend.js'
import * as ResourceMetadata from './ResourceMetadata.js'

/**
 * Creates the handler of the instance's server routes, under `basePath`:
 *
 * | Route | Serves |
 * | --- | --- |
 * | `/access-keys` | The access key endpoint of `connections`, with the option |
 * | `/client.json` | The app's metadata document, with `connections.metadata` |
 * | `/auth/backchannel-logout`, `/auth/callback`, `/auth/login`, `/auth/logout`, `/auth/session` | The `backend` plugin's sign-in and logout routes, with the plugin |
 * | `/auth/siwe`, `/auth/siwe/challenge`, `/auth/siwe/verify` | The `siwe` plugin's sign-in routes, with the plugin |
 * | `/relay` | The `relay` plugin's route, with `relay` |
 *
 * With `connections.metadata`, the handler also serves the protected resource metadata at
 * `/.well-known/oauth-protected-resource` and the resource's path, outside `basePath`, so the app
 * routes that path to it too.
 *
 * Each route matches its exact path only, without a trailing slash, so a guard of the host's router
 * on the same path runs for every request that the route serves. Any other request receives 404.
 *
 * @example
 * ```ts
 * app.all('/api/*', (c) => accounts.handler.fetch(c.req.raw))
 * ```
 */
export function create(options: create.Options): Handler.Handler {
  const { accessKeys, relay } = options
  const base = (options.basePath ?? Handler.basePath).replace(/\/+$/, '')
  const metadata =
    options.metadata &&
    ResourceMetadata.create({
      ...options.metadata,
      // The path joins the origin as text. `Accounts.create` refuses a `basePath` without a leading `/`.
      accessKeyEndpoint: `${new URL(options.metadata.resource).origin}${base}/access-keys`,
    })
  // The sign-in routes of both plugins sit under one path, apart from `/access-keys` and `/relay`.
  const auth = `${base}${Handler.authPath}`
  const backend = options.backend
    ? BackendHandler.create({
        backend: options.backend,
        basePath: auth,
        redirectUri: options.redirectUri,
        siwe: options.siwe,
      })
    : undefined
  const backendPaths = new Set(
    [
      '/backchannel-logout',
      '/callback',
      '/login',
      '/logout',
      '/session',
      ...(options.siwe ? ['/siwe', '/siwe/challenge', '/siwe/verify'] : []),
    ].map((path) => `${auth}${path}`),
  )

  return Handler.from({
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (accessKeys && pathname === `${base}/access-keys`)
        return (await accessKeys()).fetch(request)
      if (metadata?.paths.has(pathname)) return metadata.fetch(request)
      if (backend && backendPaths.has(pathname)) return backend.fetch(request)
      if (relay && pathname === `${base}/relay`) return relay().fetch(request)
      return Response.json({ error: 'not_found' }, { status: 404 })
    },
  })
}

export declare namespace create {
  type Options = {
    /** Returns the access key endpoint's handler. Absent without `connections`. */
    accessKeys?: (() => Promise<Handler.Handler>) | undefined
    /** The `backend` plugin's actions, which serve the sign-in routes. Absent without the plugin. */
    backend?: BackendHandler.create.Actions | undefined
    /** The path that the routes sit under, such as `/accounts`. Defaults to `/api`. `''` is the root. */
    basePath?: string | undefined
    /** The policy, key, and identity of an API that Tempo ID discovers. Absent without `connections.metadata`. */
    metadata?:
      | Omit<ResourceMetadata.create.Options, 'accessKeyEndpoint'>
      | undefined
    /** The redirect URI of the `backend` plugin's sign-in. Defaults to `/auth/callback` under `basePath`. */
    redirectUri?: string | undefined
    /** Returns the relay route's handler. Absent without the `relay` plugin and `handler.relay`. */
    relay?: (() => Handler.Handler) | undefined
    /** The `siwe` plugin's actions, which serve the SIWE routes. Absent without the plugin. */
    siwe?: BackendHandler.create.Siwe | undefined
  }
}
