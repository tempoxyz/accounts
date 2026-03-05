import type { LocalAccount } from 'viem/accounts'

import { local as core_local } from '../src/provider/adapters/local.js'
import { accounts } from './config.js'

/** Creates a local adapter pre-configured with test accounts. */
export function local(options: local.Options = {}) {
  const { accounts: accounts_ = [accounts[0]], createAccounts } = options
  return core_local({
    loadAccounts: async () => accounts_,
    createAccount: createAccounts ? async () => createAccounts : undefined,
  })
}

export declare namespace local {
  type Options = {
    accounts?: readonly LocalAccount[] | undefined
    createAccounts?: readonly LocalAccount[] | undefined
  }
}
