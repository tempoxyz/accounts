import * as Account from '../Account.js'
import * as Adapter from '../Adapter.js'
import { base } from './base.js'

/**
 * Creates a local adapter where the app manages keys and signing in-process.
 *
 * @example
 * ```ts
 * import { local, Provider } from 'accounts'
 *
 * const Provider = Provider.create({
 *   adapter: local({
 *     loadAccounts: async () => ({
 *       accounts: [{ address: '0x...' }],
 *     }),
 *   }),
 * })
 * ```
 */
export function local(options: local.Options): Adapter.Adapter {
  const { createAccount, icon, loadAccounts, name, rdns } = options

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { getAccount } = parameters

    function withAccount(
      result: Adapter.createAccount.ReturnType | Adapter.loadAccounts.ReturnType,
    ) {
      const account = result.accounts[0]
      return {
        ...result,
        ...(account ? { account: Account.hydrate(account, { signable: true }) } : {}),
      }
    }

    return base({
      ...parameters,
      ...(createAccount
        ? {
            async createAccount(parameters) {
              const {
                authorizeAccessKey: _authorizeAccessKey,
                personalSign: _personalSign,
                ...rest
              } = parameters
              return withAccount(await createAccount(rest))
            },
          }
        : {}),
      async loadAccounts(parameters = {}) {
        const {
          authorizeAccessKey: _authorizeAccessKey,
          personalSign: _personalSign,
          ...rest
        } = parameters
        return withAccount(await loadAccounts(rest))
      },
      async resolveAccount(parameters = {}) {
        return getAccount({ ...parameters, signable: true })
      },
    })
  })
}

export declare namespace local {
  type Options = {
    /** Create a new account. Optional — omit for login-only flows. */
    createAccount?:
      | ((params: Adapter.createAccount.Parameters) => Promise<Adapter.createAccount.ReturnType>)
      | undefined
    /** Discover existing accounts (e.g. WebAuthn assertion). */
    loadAccounts: (
      params?: Adapter.loadAccounts.Parameters | undefined,
    ) => Promise<Adapter.loadAccounts.ReturnType>
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
