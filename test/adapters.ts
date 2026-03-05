import { local as core_local } from '../src/provider/adapters/local.js'
import type * as Store from '../src/provider/Store.js'
import { accounts, privateKeys } from './config.js'

/** Creates a `Store.Account` from a test account index. */
function toStoreAccount(index: number): Store.Account {
  return {
    address: accounts[index]!.address,
    keyType: 'secp256k1',
    privateKey: privateKeys[index]!,
  }
}

/** Creates a local adapter pre-configured with test accounts. */
export function local(options: local.Options = {}) {
  const {
    loadAccounts = async () => [toStoreAccount(0)],
    createAccount,
  } = options
  return core_local({
    loadAccounts,
    createAccount,
  })
}

export declare namespace local {
  type Options = {
    createAccount?: (() => Promise<readonly Store.Account[]>) | undefined
    loadAccounts?: (() => Promise<readonly Store.Account[]>) | undefined
  }
}
