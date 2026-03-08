import type { Address } from 'viem'
import { Account } from 'viem/tempo'
import { Registration } from 'webauthx/client'

import { dangerous_secp256k1 } from '../src/provider/adapters/dangerous_secp256k1.js'
import { local as core_local } from '../src/provider/adapters/local.js'
import * as Ceremony from '../src/provider/Ceremony.js'
import type * as Store from '../src/provider/Store.js'
import { privateKeys, webAuthnAccounts } from './config.js'

/** Creates a `Store.Account` from a test account index. */
function toStoreAccount(index: number): Store.Account {
  return {
    address: webAuthnAccounts[index]!.address,
    keyType: 'webAuthn_headless',
    privateKey: privateKeys[index]!,
    rpId: 'example.com',
    origin: 'https://example.com',
  }
}

/** Creates a local adapter pre-configured with deterministic headless WebAuthn test accounts. */
export function headlessWebAuthn() {
  return core_local({
    loadAccounts: async () => ({ accounts: [toStoreAccount(0)] }),
    createAccount: async () => ({ accounts: [toStoreAccount(1)] }),
  })
}

/** Creates a `dangerous_secp256k1` adapter for testing. */
export function secp256k1() {
  return dangerous_secp256k1()
}

/** Creates a local adapter backed by real CDP passkeys. */
export function webAuthn(options: webAuthn.Options = {}) {
  let loadedAccount: (Store.Account & { address: Address }) | undefined

  const ceremony = Ceremony.local({
    origin: 'http://localhost',
    rpId: 'localhost',
  })

  /** Performs a real WebAuthn registration ceremony and returns a store account. */
  async function registerAccount(name: string): Promise<Store.Account & { address: Address }> {
    const { options } = await ceremony.getRegistrationOptions({ name })
    const credential = await Registration.create({ options })
    const { publicKey } = await ceremony.verifyRegistration(credential)
    const account = Account.fromWebAuthnP256({ id: credential.id, publicKey })
    return {
      address: account.address,
      keyType: 'webAuthn' as const,
      credential: { id: credential.id, publicKey },
    }
  }

  return core_local({
    async loadAccounts() {
      if (!loadedAccount) loadedAccount = await registerAccount('default')
      return { accounts: [loadedAccount] }
    },
    createAccount: options.withCreate
      ? async ({ name }) => {
          const account = await registerAccount(name)
          return { accounts: [account] }
        }
      : undefined,
  })
}

export declare namespace webAuthn {
  type Options = {
    withCreate?: boolean | undefined
  }
}
