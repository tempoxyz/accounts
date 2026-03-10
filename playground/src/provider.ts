import { Mppx } from 'mppx/client'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { Ceremony, local, Provider, webAuthn } from '@tempoxyz/accounts'

export type AdapterType = 'secp256k1' | 'webAuthn'

export let provider = createProvider('secp256k1')

export function createProvider(adapterType: AdapterType) {
  if (adapterType === 'webAuthn') {
    const ceremony = Ceremony.server({ url: '/webauthn' })
    return Provider.create({
      adapter: webAuthn({ ceremony }),
      feePayerUrl: '/fee-payer',
      testnet: true,
    })
  }

  const privateKey = generatePrivateKey()
  const account = Account.fromSecp256k1(privateKey)
  return Provider.create({
    adapter: local({
      loadAccounts: async () => ({ accounts: [account] }),
      createAccount: async () => {
        const key = generatePrivateKey()
        const newAccount = Account.fromSecp256k1(key)
        return { accounts: [newAccount] }
      },
    }),
    feePayerUrl: '/fee-payer',
    testnet: true,
  })
}

export function switchAdapter(adapterType: AdapterType) {
  Mppx.restore()
  provider = createProvider(adapterType)
}
