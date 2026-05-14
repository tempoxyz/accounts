import type { Hex } from 'viem'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'

import * as Adapter from '../Adapter.js'
import { local } from './local.js'

/**
 * Creates a secp256k1 adapter that signs in-process with a `secp256k1` private key.
 *
 * If `privateKey` is provided, the adapter pins that key as the signer (useful
 * for server-side use, where the key is supplied by the host environment).
 *
 * If `privateKey` is omitted, the adapter generates a random key on first
 * connect and persists it via the provider's storage adapter (e.g.
 * `localStorage`, cookies). Storing keys in browser storage in plaintext is
 * dangerous — only use the unpinned form for development, testing, or when the
 * threat model allows it.
 *
 * Wraps the {@link local} adapter.
 *
 * @example
 * ```ts
 * import { secp256k1, Provider } from 'accounts'
 *
 * // Server-side (pinned key):
 * const provider = Provider.create({
 *   adapter: secp256k1({ privateKey: process.env.PRIVATE_KEY }),
 * })
 *
 * // Client-side (random key, persisted to storage):
 * const provider = Provider.create({
 *   adapter: secp256k1(),
 * })
 * ```
 */
export function secp256k1(options: secp256k1.Options = {}): Adapter.Adapter {
  const { icon, name, privateKey, rdns } = options
  const fixed = privateKey
    ? {
        address: TempoAccount.fromSecp256k1(privateKey).address,
        keyType: 'secp256k1' as const,
        privateKey,
      }
    : undefined

  return Adapter.define({ icon, name, rdns }, (config) => {
    const { store } = config

    return local({
      async createAccount() {
        if (fixed) return { accounts: [fixed] }

        const privateKey = Secp256k1.randomPrivateKey()
        const generated = TempoAccount.fromSecp256k1(privateKey)
        return {
          accounts: [{ address: generated.address, keyType: 'secp256k1' as const, privateKey }],
        }
      },
      async loadAccounts() {
        if (fixed) return { accounts: [fixed] }
        return { accounts: [...store.getState().accounts] }
      },
    })(config)
  })
}

export declare namespace secp256k1 {
  type Options = {
    /** Data URI of the provider icon. @default Black 1×1 SVG. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider (e.g. `"My Wallet"`). @default "Injected Wallet" */
    name?: string | undefined
    /** Fixed private key to expose instead of generating/loading one from storage. */
    privateKey?: Hex | undefined
    /** Reverse DNS identifier. @default `com.{lowercase name}` */
    rdns?: string | undefined
  }
}
