import type { Address } from 'viem'
import { Account } from 'viem/tempo'
import { Registration } from 'webauthx/client'

import { local as core_local } from '../src/provider/adapters/local.js'
import * as Ceremony from '../src/provider/Ceremony.js'
import type * as Store from '../src/provider/Store.js'
import { privateKeys, webAuthnAccounts } from './config.js'

/** Creates a `Store.Account` from a test account index. */
function toStoreAccount(index: number): Store.Account {
  return {
    address: webAuthnAccounts[index]!.address,
    keyType: 'headlessWebAuthn',
    privateKey: privateKeys[index]!,
    rpId: 'example.com',
    origin: 'https://example.com',
  }
}

/** Creates a local adapter pre-configured with deterministic headless WebAuthn test accounts. */
export function headlessWebAuthn(options: headlessWebAuthn.Options = {}) {
  const { createAccount, icon, loadAccounts = async () => [toStoreAccount(0)], name, rdns } = options
  return core_local({
    createAccount,
    icon,
    loadAccounts,
    name,
    rdns,
  })
}

export declare namespace headlessWebAuthn {
  type Options = {
    createAccount?: ((params: { name: string }) => Promise<readonly Store.Account[]>) | undefined
    icon?: `data:image/${string}` | undefined
    loadAccounts?: (() => Promise<readonly Store.Account[]>) | undefined
    name?: string | undefined
    rdns?: string | undefined
  }
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
      return [loadedAccount]
    },
    createAccount: options.withCreate
      ? async ({ name }) => {
          const account = await registerAccount(name)
          return [account]
        }
      : undefined,
  })
}

export declare namespace webAuthn {
  type Options = {
    withCreate?: boolean | undefined
  }
}
