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
  const { accounts: accounts_ = [toStoreAccount(0)], createAccounts } = options
  return core_local({
    loadAccounts: async () => accounts_,
    createAccount: createAccounts ? async () => createAccounts : undefined,
  })
}

export declare namespace local {
  type Options = {
    accounts?: readonly Store.Account[] | undefined
    createAccounts?: readonly Store.Account[] | undefined
  }
}
