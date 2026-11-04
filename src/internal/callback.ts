/**
 * Reads the authorization response that Tempo ID adds to a redirect URI.
 * @module
 */
import { RequestError } from '../Accounts.js'

/** Rejects a callback whose final `state` does not match the pending sign-in. */
export function checkState(url: URL, options: checkState.Options) {
  // The issuer can append its state after a registered redirect URI's own state.
  if (url.searchParams.getAll('state').at(-1) !== options.state)
    throw new RequestError({
      code: 'invalid_request',
      field: 'state',
      message:
        'Invalid `state` in the callback URL. Start sign-in again from this app.',
      status: 400,
    })
}

export declare namespace checkState {
  type Options = {
    /** The state of the pending sign-in. */
    state: string
  }
}

/**
 * Returns the callback's denial, such as `error=access_denied`, as a `RequestError` with that
 * `code` and status 0. Returns `undefined` for a callback without an `error`.
 */
export function error(url: URL, options: error.Options) {
  const code = parameter(url, { ...options, name: 'error' })
  if (!code) return undefined
  return new RequestError({
    code,
    message: parameter(url, { ...options, name: 'error_description' }) ?? code,
    status: 0,
    uri: parameter(url, { ...options, name: 'error_uri' }),
  })
}

export declare namespace error {
  type Options = {
    /** The registered redirect URI that the callback URL extends. */
    redirectUri: string
  }
}

/**
 * Returns the first value of `name` that the authorization response added to the callback URL. The
 * issuer appends its parameters after the registered redirect URI's own.
 */
export function parameter(url: URL, options: parameter.Options) {
  const registered = new URL(options.redirectUri).searchParams.getAll(
    options.name,
  ).length
  return url.searchParams.getAll(options.name)[registered]
}

export declare namespace parameter {
  type Options = {
    /** The callback parameter, such as `error`. */
    name: string
    /** The registered redirect URI that the callback URL extends. */
    redirectUri: string
  }
}
