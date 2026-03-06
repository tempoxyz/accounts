import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { local, Provider } from 'zyzz/provider'

const privateKey = generatePrivateKey()
export const account = Account.fromSecp256k1(privateKey)

export const provider = Provider.create({
  adapter: local({
    loadAccounts: async () => [account],
    createAccount: async () => {
      const key = generatePrivateKey()
      const account = Account.fromSecp256k1(key)
      return [account]
    },
  }),
  testnet: true,
})

