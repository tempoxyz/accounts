/**
 * Runs Tempo ID's Admin API in a harness, and registers the suites' OAuth apps and realms through
 * it, as an operator does. Each request carries an assertion of the Cloudflare Access stand-in.
 * @module
 */
import type * as Apps from '../.tempo-id/src/internal/Apps.js'
import * as TempoId from './TempoId.js'

/** An Admin API harness of {@link create}. */
export type Instance = ReturnType<typeof TempoId.Harness.admin>

/** An app that the Admin API returns, without its client secret. */
export type App = {
  /** The client ID, which the app sends as `client_id`. */
  clientId: string
  /** The display name on the approval page. */
  name: string
  /** The URIs that the app returns to. */
  redirectUris: readonly string[]
}

/**
 * Creates an Admin API harness over the suite's database, or `databaseUrl`. Call `listen()` first,
 * `reset()` between tests, and `close()` last.
 */
export function create(options: create.Options = {}): Instance {
  return TempoId.Harness.admin(options)
}

export declare namespace create {
  type Options = {
    /** The database that the Admin API operates. Defaults to the suite's. */
    databaseUrl?: string | undefined
  }
}

/** Adds a realm without owner configurations. Throws on a refusal. */
export async function addRealm(admin: Instance, options: addRealm.Options) {
  await request(admin, { body: options, method: 'POST', path: '/realms' })
}

export declare namespace addRealm {
  type Options = {
    /** The realm's ID, in lowercase kebab case. */
    id: string
    /** The realm's display name. */
    name: string
  }
}

/**
 * Registers a first-party app, which skips consent for requests without an access key. Returns the
 * app and, for a confidential app, its client secret. Throws on a refusal.
 */
export async function createApp(admin: Instance, options: createApp.Options) {
  return (await request(admin, {
    body: options,
    method: 'POST',
    path: '/apps',
  })) as createApp.ReturnType
}

export declare namespace createApp {
  /** The body of `POST /apps`. */
  type Options = Omit<Apps.create.Options, 'referenceId' | 'registeredBy'>

  type ReturnType = {
    /** The registered app. */
    app: App
    /** The client secret, which only this response holds. Absent for a public app. */
    clientSecret?: string | undefined
  }
}

/**
 * Sends `body` with `method` to the Admin API's `path` as an admin. Returns the JSON body, or
 * `undefined` for none. Throws on a status other than 2xx.
 */
export async function request(admin: Instance, options: request.Options) {
  const token = await TempoId.Harness.accessToken(admin, {
    groups: ['everyone'],
    sub: 'tempo-id-test-admin',
  })
  const response = await admin.fetch(options.path, {
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    headers: {
      'cf-access-jwt-assertion': token,
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    method: options.method ?? 'GET',
  })
  const text = await response.text()
  if (response.status < 200 || response.status > 299)
    throw new Error(
      `${options.method ?? 'GET'} ${options.path} responded with ${response.status}: ${text}`,
    )
  return text ? (JSON.parse(text) as unknown) : undefined
}

export declare namespace request {
  type Options = {
    /** The JSON body. Defaults to none. */
    body?: unknown
    /** Defaults to `GET`. */
    method?: string | undefined
    /** The path, such as `/apps`. */
    path: string
  }
}

/**
 * Replaces the realms of the app `clientId`, in order. The first realm holds a user's first
 * account. An empty list resets the app to the `default` realm. Throws on a refusal.
 */
export async function setAppRealms(
  admin: Instance,
  options: setAppRealms.Options,
) {
  await request(admin, {
    body: { realms: options.realms },
    method: 'PUT',
    path: `/apps/${encodeURIComponent(options.clientId)}/realms`,
  })
}

export declare namespace setAppRealms {
  type Options = {
    /** The app's client ID. */
    clientId: string
    /** The realms' IDs, in order. */
    realms: readonly string[]
  }
}
