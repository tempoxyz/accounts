/**
 * A route that the app mounts on its server, as a function of the Fetch API. `handlers/` holds each
 * one, such as the relay route that the `relay` plugin serves.
 * @module
 */

/**
 * The path that `accounts.handler` serves its routes under by default, which the dialog's `backend`
 * also names by default.
 */
export const basePath = '/api'

/**
 * The path of the sign-in routes under `basePath`, such as `/api/auth/login`, apart from the
 * handler's other routes, such as `/api/relay`.
 */
export const authPath = '/auth'

/** A function of the Fetch API from a request to its response. */
export type Handler = {
  /** Serves `request`, and returns its response. */
  fetch: (request: Request) => Promise<Response>
}

/** Instantiates a {@link Handler}. */
export function from(value: Handler): Handler {
  return value
}
