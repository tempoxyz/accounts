import { Account, Secp256k1 } from 'viem/tempo'

import * as Adapter from '../Adapter.js'
import { local } from './local.js'

/**
 * Creates a secp256k1 adapter that generates random private keys and persists them to storage.
 *
 * ⚠️ **Dangerous**: Private keys are stored in plaintext via the provider's storage adapter
 * (e.g. localStorage, cookies). Use only for development, testing, or when the threat model allows it.
 *
 * Wraps the {@link local} adapter with automatic key generation.
 *
 * @example
 * ```ts
 * import { dangerous_secp256k1, Provider } from '@tempoxyz/accounts'
 *
 * const provider = Provider.create({
 *   adapter: dangerous_secp256k1(),
 * })
 * ```
 */
export function dangerous_secp256k1(options: dangerous_secp256k1.Options = {}): Adapter.Adapter {
  const { icon, name, rdns } = options

  return Adapter.define({ icon, name, rdns }, (config) => {
    const { store } = config

    return local({
      async createAccount() {
        const privateKey = Secp256k1.randomPrivateKey()
        const account = Account.fromSecp256k1(privateKey)
        return {
          accounts: [{ address: account.address, keyType: 'secp256k1' as const, privateKey }],
        }
      },
      async loadAccounts() {
        return { accounts: [...store.getState().accounts] }
      },
    })(config)
  })
}

export declare namespace dangerous_secp256k1 {
  type Options = {
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
