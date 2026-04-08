import { WebAuthnCeremony, dialog, Dialog, local, Provider, webAuthn } from 'accounts'
import { Mppx } from 'mppx/client'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'

export type AdapterType = 'secp256k1' | 'webAuthn' | 'tempoWallet' | 'dialogRefImpl'
export type DialogMode = 'iframe' | 'popup'
export type ProviderValue = ReturnType<typeof Provider.create>

export const testnet = (() => {
  const param = new URLSearchParams(window.location.search).get('testnet')
  if (param !== null) return param !== 'false'
  if (window.location.hostname.startsWith('testnet.')) return true
  return import.meta.env.VITE_ENV === 'testnet'
})()

export const tokensMap = {
  testnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    alphaUSD: '0x20c0000000000000000000000000000000000001',
    betaUSD: '0x20c0000000000000000000000000000000000002',
    thetaUSD: '0x20c0000000000000000000000000000000000003',
    'USDC.e': '0x20c0000000000000000000009e8d7eb59b783726',
  },
  mainnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    'USDC.e': '0x20C000000000000000000000b9537d11c60E8b50',
  },
} as const

export const tokens = testnet ? tokensMap.testnet : tokensMap.mainnet

export let dialogMode: DialogMode = 'iframe'
export let provider: ProviderValue = createProvider('tempoWallet')

export function createProvider(adapterType: AdapterType): ProviderValue {
  if (adapterType === 'tempoWallet')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_WALLET_DIALOG_HOST,
      }),
      feePayerUrl: '/fee-payer',
      mpp: true,
      testnet,
    })

  if (adapterType === 'dialogRefImpl')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_REF_DIALOG_HOST,
      }),
      feePayerUrl: '/fee-payer',
      mpp: true,
      testnet,
    })

  if (adapterType === 'webAuthn') {
    const ceremony = WebAuthnCeremony.server({ url: '/webauthn' })
    return Provider.create({
      adapter: webAuthn({ ceremony }),
      feePayerUrl: '/fee-payer',
      mpp: true,
      testnet,
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
    mpp: true,
    testnet,
  })
}

export function switchAdapter(adapterType: AdapterType) {
  Mppx.restore()
  provider = createProvider(adapterType)
}

export function switchDialogMode(mode: DialogMode, adapterType: AdapterType = 'tempoWallet') {
  dialogMode = mode
  Mppx.restore()
  provider = createProvider(adapterType)
}
