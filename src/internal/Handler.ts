/**
 * A route that the app mounts on its server, as a function of the Fetch API. `handlers/` holds each
 * one, such as the relay route that the `relay` plugin serves.
 * @module
 */

/** A function of the Fetch API from a request to its response. */
export type Handler = {
  /** Serves `request`, and returns its response. */
  fetch: (request: Request) => Promise<Response>
}

/** Instantiates a {@link Handler}. */
export function from(value: Handler): Handler {
  return value
}
