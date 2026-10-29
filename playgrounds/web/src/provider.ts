import { TurnkeyClient, generateWalletAccountsFromAddressFormat } from '@turnkey/core'
import type { CreateSubOrgParams } from '@turnkey/core'
import {
  type Dialog as DialogNs,
  WebAuthnCeremony,
  dialog,
  Dialog,
  local,
  postMessage,
  Provider,
  Storage,
  turnkey,
  webAuthn,
} from 'accounts'
import { Mount } from 'accounts'
import { privy } from 'accounts/react/privy'
import { Mppx } from 'mppx/client'
import { getAddress } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { tempo, tempoDevnet, tempoModerato } from 'viem/tempo/chains'
import { alphausd, betausd, pathusd, thetausd, usdce } from 'viem/tokens'

import { requestTurnkeyEmailOtp, type TurnkeyEmailOtpClient } from './turnkeyOtpStore.js'

export type AdapterType =
  | 'secp256k1'
  | 'webAuthn'
  | 'turnkey'
  | 'privy'
  | 'dialog'
  | 'tempoWallet'
  | 'dialogRefImpl'
export type Env = 'mainnet' | 'testnet' | 'devnet'
export type DialogMode = 'iframe' | 'popup'
export type MppMode = 'push' | 'pull'
export type ProviderValue = ReturnType<typeof Provider.create>
type TurnkeyPlaygroundClient = turnkey.Client & TurnkeyEmailOtpClient

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

/**
 * Provider options of the selected network. On devnet, devnet's chain comes first, so the provider
 * starts on it and its requests name devnet (31318), where Tempo Wallet signs in with Tempo ID's
 * configurable accounts. Moderato and mainnet stay configured, so the worker's MPP challenges still
 * pay. Devnet keeps its own storage, so a chain that another network saved never replaces it.
 * Mainnet and testnet keep the provider's defaults.
 */
export const network =
  env === 'devnet'
    ? {
        chains: [tempoDevnet, tempoModerato, tempo] as const,
        storage: Storage.combine(Storage.idb({ key: 'tempo.devnet' }), Storage.memory()),
      }
    : {}

export const tokensMap = {
  testnet: {
    pathUSD: pathusd(42431).address,
    alphaUSD: alphausd(42431).address,
    betaUSD: betausd(42431).address,
    thetaUSD: thetausd(42431).address,
    'USDC.e': usdce(42431).address,
  },
  devnet: {
    pathUSD: pathusd(4217).address,
    alphaUSD: alphausd(42431).address,
    betaUSD: betausd(42431).address,
    thetaUSD: thetausd(42431).address,
  },
  mainnet: {
    pathUSD: pathusd(4217).address,
    'USDC.e': getAddress(usdce(4217).address),
  },
} as const

export const tokens =
  tokensMap[env === 'mainnet' ? 'mainnet' : env === 'devnet' ? 'devnet' : 'testnet']

export const host =
  new URLSearchParams(window.location.search).get('host') ?? import.meta.env.VITE_WALLET_HOST

/** Initial adapter, read from `?adapter=` so a reload keeps the selection. */
export const initialAdapter: AdapterType = (() => {
  const param = new URLSearchParams(window.location.search).get('adapter')
  const adapters: readonly AdapterType[] = [
    'secp256k1',
    'webAuthn',
    'turnkey',
    'privy',
    'dialog',
    'tempoWallet',
    'dialogRefImpl',
  ]
  return adapters.includes(param as AdapterType) ? (param as AdapterType) : 'tempoWallet'
})()

export let dialogMode: DialogMode =
  new URLSearchParams(window.location.search).get('mode') === 'popup' ? 'popup' : 'iframe'
export let mppMode: MppMode = 'push'
export let theme: DialogNs.Theme | undefined
export let provider: ProviderValue = createProvider(initialAdapter)
let turnkeyClient: TurnkeyClient | undefined

function mpp() {
  return {
    maxDeposit: '0.05',
    mode: mppMode,
  } as const
}

export function createProvider(adapterType: AdapterType): ProviderValue {
  if (adapterType === 'dialog')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host,
        theme,
      }),
      mpp: mpp(),
      ...network,
      testnet,
    })

  if (adapterType === 'tempoWallet') {
    const postMessageHost = new URL('/post-message', host)
    if (theme?.accent) postMessageHost.searchParams.set('accent', theme.accent)
    if (theme?.radius) postMessageHost.searchParams.set('radius', theme.radius)
    if (theme?.scheme) postMessageHost.searchParams.set('scheme', theme.scheme)
    return Provider.create({
      adapter: postMessage({
        host: postMessageHost.toString(),
        mount: dialogMode === 'popup' ? Mount.popup() : Mount.iframe(),
        name: 'Tempo Wallet',
        rdns: 'xyz.tempo',
      }),
      mpp: mpp(),
      ...network,
      testnet,
    })
  }

  if (adapterType === 'dialogRefImpl')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_REF_DIALOG_HOST,
        theme,
      }),
      mpp: mpp(),
      testnet,
    })

  if (adapterType === 'webAuthn') {
    const ceremony = WebAuthnCeremony.server({ url: '/webauthn' })
    return Provider.create({
      adapter: webAuthn({ ceremony }),
      mpp: mpp(),
      ...network,
      testnet,
    })
  }

  if (adapterType === 'turnkey') {
    const client = getTurnkeyAdapterClient()
    return Provider.create({
      adapter: turnkey({
        client,
        async loadAccounts({ client }) {
          await requestTurnkeyEmailOtp({
            client,
            createSubOrgParams: {
              customWallet: {
                walletName: 'Tempo Playground',
                walletAccounts: generateWalletAccountsFromAddressFormat({
                  addresses: ['ADDRESS_FORMAT_ETHEREUM'],
                }),
              },
            } satisfies CreateSubOrgParams,
          })
        },
      }),
      mpp: mpp(),
      ...network,
      testnet,
    })
  }

  if (adapterType === 'privy') {
    if (!import.meta.env.VITE_PRIVY_APP_ID)
      throw new Error('VITE_PRIVY_APP_ID is required for the Privy adapter.')

    return Provider.create({
      adapter: privy(),
      mpp: true,
      ...network,
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
    mpp: mpp(),
    ...network,
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

export function switchMppMode(mode: MppMode, adapterType: AdapterType = 'tempoWallet') {
  mppMode = mode
  Mppx.restore()
  provider = createProvider(adapterType)
}

function getTurnkeyAdapterClient() {
  const organizationId = import.meta.env.VITE_TURNKEY_ORGANIZATION_ID
  if (!organizationId)
    throw new Error('VITE_TURNKEY_ORGANIZATION_ID is required for the Turnkey adapter.')

  turnkeyClient ??= new TurnkeyClient({
    organizationId,
    authProxyConfigId: import.meta.env.VITE_TURNKEY_AUTH_PROXY_CONFIG_ID,
  })

  return turnkeyClient as TurnkeyPlaygroundClient
}

export function switchTheme(
  next: DialogNs.Theme | undefined,
  adapterType: AdapterType = 'tempoWallet',
) {
  theme = next
  Mppx.restore()
  provider = createProvider(adapterType)
}
