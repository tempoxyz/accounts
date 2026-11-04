/**
 * Lists the realms that the app reaches.
 * @module
 */
import type { Config } from '../Accounts.js'
import * as Api from '../internal/api.js'

/**
 * Lists the realms that the app reaches, in its settings' order. The first holds a user's first
 * account.
 *
 * @example
 * ```ts
 * const realms = await Actions.realm.list(auth)
 * // [{ id: 'default', name: 'Tempo' }]
 * ```
 */
export async function list(auth: Config): Promise<list.ReturnType> {
  const { realms } = await Api.json<{ realms: list.ReturnType }>(
    await (auth.fetch ?? fetch)(
      new URL(
        `/v1/realms?${new URLSearchParams({ client_id: auth.clientId })}`,
        auth.url,
      ),
    ),
  )
  return realms
}

export declare namespace list {
  type ReturnType = readonly {
    /** The realm ID, such as `default` or `tempo-cash`. */
    id: string
    /** The display name, such as `Tempo Cash`. */
    name: string
  }[]
}
