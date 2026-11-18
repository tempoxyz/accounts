/**
 * The signed-in user.
 * @module
 */
/** The signed-in user. */
export type User = {
  /** The user's verified email address. */
  email: string
  /** The `sub` of every token, such as `user_…`. */
  id: string
}

/**
 * Instantiates a {@link User}.
 *
 * @example
 * ```ts
 * const user = User.from({ email: claims.email, id: claims.sub })
 * ```
 */
export function from(value: User): User {
  return value
}
