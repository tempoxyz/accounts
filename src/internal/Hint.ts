/**
 * The session hint: a cookie that marks a browser whose instance holds a session. A page reads it
 * synchronously at startup, since IndexedDB has no synchronous read, and loads the instance only for
 * a returning visitor. The cookie holds no token. The module imports nothing, so the `accounts/hint`
 * entry adds no code of the instance to a page's first bundle.
 * @module
 */

/** The cookie's name when `hint.cookie` of `Accounts.create` is `true`. */
export const cookie = 'tempo_session'

/** The seconds that the cookie lives after each sign-in or restore: Tempo ID's default refresh token lifetime. */
const maxAge = 30 * 24 * 60 * 60

/**
 * Returns the `document.cookie` assignment that removes the session hint.
 *
 * @example
 * ```ts
 * import { Hint } from 'accounts/hint'
 *
 * document.cookie = Hint.expire()
 * ```
 */
export function expire(options: expire.Options = {}) {
  return `${options.cookie ?? cookie}=; Max-Age=0; Path=/; SameSite=Lax`
}

export declare namespace expire {
  type Options = {
    /** The cookie's name, as `hint.cookie` of `Accounts.create` names it. Defaults to `tempo_session`. */
    cookie?: string | undefined
  }
}

/**
 * Returns whether a cookie string, such as `document.cookie` or a request's `Cookie` header, holds
 * the session hint that `Accounts.create` with `hint.cookie` sets. A hint is a guess: the session
 * can end in another context, such as through an expired refresh token. The instance then expires
 * the cookie when it reads no session.
 *
 * @example
 * ```ts
 * import { Hint } from 'accounts/hint'
 *
 * if (Hint.has(document.cookie)) {
 *   const { accounts } = await import('./tempo.config.js')
 *   await accounts.session.get()
 * }
 * ```
 */
export function has(value: string, options: has.Options = {}) {
  const name = options.cookie ?? cookie
  return value.split(/;\s*/).includes(`${name}=1`)
}

export declare namespace has {
  type Options = expire.Options
}

/**
 * Returns the `document.cookie` assignment that sets the session hint for 30 days, on every path
 * of the origin.
 *
 * @example
 * ```ts
 * import { Hint } from 'accounts/hint'
 *
 * document.cookie = Hint.serialize()
 * ```
 */
export function serialize(options: serialize.Options = {}) {
  return `${options.cookie ?? cookie}=1; Max-Age=${maxAge}; Path=/; SameSite=Lax`
}

export declare namespace serialize {
  type Options = has.Options
}
