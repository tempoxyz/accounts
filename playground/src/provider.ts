import { Ceremony, Dialog, local, Provider, tempoAuth, webAuthn } from 'tempox'
import { Mppx } from 'mppx/client'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'

export type AdapterType = 'secp256k1' | 'webAuthn' | 'auth'
export type DialogMode = 'iframe' | 'popup'

export let dialogMode: DialogMode = 'iframe'
export let provider = createProvider('auth')

export function createProvider(adapterType: AdapterType) {
  if (adapterType === 'auth')
    return Provider.create({
      adapter: tempoAuth({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_AUTH_HOST ?? 'https://localhost:5174',
      }),
      testnet: true,
    })

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

export function switchDialogMode(mode: DialogMode) {
  dialogMode = mode
  Mppx.restore()
  provider = createProvider('auth')
}
