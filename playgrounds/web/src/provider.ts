import { WebAuthnCeremony, dialog, Dialog, local, Provider, webAuthn } from 'accounts'
import { Mppx } from 'mppx/client'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'

export type AdapterType = 'secp256k1' | 'webAuthn' | 'tempoConnect' | 'dialogRefImpl'
export type Env = 'mainnet' | 'testnet' | 'devnet'
export type DialogMode = 'iframe' | 'popup'
export type ProviderValue = ReturnType<typeof Provider.create>

export const env: Env = (() => {
  const param = new URLSearchParams(window.location.search).get('env')
  if (param === 'devnet' || param === 'testnet' || param === 'mainnet') return param
  // Legacy ?testnet= support
  const testnetParam = new URLSearchParams(window.location.search).get('testnet')
  if (testnetParam !== null) return testnetParam !== 'false' ? 'testnet' : 'mainnet'
  if (window.location.hostname.startsWith('testnet.')) return 'testnet'
  if (import.meta.env.VITE_ENV === 'testnet') return 'testnet'
  if (import.meta.env.VITE_ENV === 'devnet') return 'devnet'
  return 'mainnet'
})()

export const testnet = env !== 'mainnet'

export const tokensMap = {
  testnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    alphaUSD: '0x20c0000000000000000000000000000000000001',
    betaUSD: '0x20c0000000000000000000000000000000000002',
    thetaUSD: '0x20c0000000000000000000000000000000000003',
    'USDC.e': '0x20c0000000000000000000009e8d7eb59b783726',
  },
  devnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    alphaUSD: '0x20c0000000000000000000000000000000000001',
    betaUSD: '0x20c0000000000000000000000000000000000002',
    thetaUSD: '0x20c0000000000000000000000000000000000003',
  },
  mainnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    'USDC.e': '0x20C000000000000000000000b9537d11c60E8b50',
  },
} as const

export const tokens =
  tokensMap[env === 'mainnet' ? 'mainnet' : env === 'devnet' ? 'devnet' : 'testnet']

export let dialogMode: DialogMode = 'iframe'
export let provider: ProviderValue = createProvider('tempoConnect')

export function createProvider(adapterType: AdapterType): ProviderValue {
  if (adapterType === 'tempoConnect')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_CONNECT_HOST,
      }),
      mpp: true,
      testnet,
    })

  if (adapterType === 'dialogRefImpl')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_REF_DIALOG_HOST,
      }),
      mpp: true,
      testnet,
    })

  if (adapterType === 'webAuthn') {
    const ceremony = WebAuthnCeremony.server({ url: '/webauthn' })
    return Provider.create({
      adapter: webAuthn({ ceremony }),
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
    mpp: true,
    testnet,
  })
}

export function switchAdapter(adapterType: AdapterType) {
  Mppx.restore()
  provider = createProvider(adapterType)
}

export function switchDialogMode(mode: DialogMode, adapterType: AdapterType = 'tempoConnect') {
  dialogMode = mode
  Mppx.restore()
  provider = createProvider(adapterType)
}
