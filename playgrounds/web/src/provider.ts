import Privy, {
  LocalStorage as PrivyLocalStorage,
  getAllUserEmbeddedEthereumWallets,
  getEntropyDetailsFromUser,
} from '@privy-io/js-sdk-core'
import { TurnkeyClient, generateWalletAccountsFromAddressFormat } from '@turnkey/core'
import type { CreateSubOrgParams } from '@turnkey/core'
import {
  type Dialog as DialogNs,
  WebAuthnCeremony,
  dialog,
  Dialog,
  local,
  privy,
  Provider,
  turnkey,
  webAuthn,
} from 'accounts'
import { Mppx } from 'mppx/client'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'

import { requestPrivyEmailOtp } from './privyOtpStore.js'
import { ensurePrivyReactLoggedIn, getPrivyReactAdapterClient } from './privyReactBridge.js'
import { requestTurnkeyEmailOtp, type TurnkeyEmailOtpClient } from './turnkeyOtpStore.js'

export type AdapterType =
  | 'secp256k1'
  | 'webAuthn'
  | 'turnkey'
  | 'privyCore'
  | 'privyReact'
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

export const host =
  new URLSearchParams(window.location.search).get('host') ?? import.meta.env.VITE_WALLET_HOST

export let dialogMode: DialogMode = 'iframe'
export let mppMode: MppMode = 'push'
export let theme: DialogNs.Theme | undefined
export let provider: ProviderValue = createProvider('tempoWallet')
let turnkeyClient: TurnkeyClient | undefined
let privyClient: Privy | undefined
let privyIframeReady: Promise<void> | undefined

function mpp() {
  return {
    maxDeposit: '0.05',
    mode: mppMode,
  } as const
}

export function createProvider(adapterType: AdapterType): ProviderValue {
  if (adapterType === 'tempoWallet')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host,
        theme,
      }),
      mpp: mpp(),
      testnet,
    })

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
      testnet,
    })
  }

  if (adapterType === 'privyCore') {
    const core = getPrivyCore()
    const client = makePrivyCoreClient(core)
    return Provider.create({
      adapter: privy({
        client,
        async createAccount() {
          await requestPrivyEmailOtp({ client: core.auth, mode: 'register' })
          const wallets = await client.loadEthereumWallets()
          const wallet = wallets[0]
          if (!wallet) throw new Error('No Privy embedded Ethereum wallet was created.')
          return wallet
        },
        async loadAccounts() {
          if (!(await core.getAccessToken().catch(() => null)))
            await requestPrivyEmailOtp({ client: core.auth, mode: 'login' })
          return await client.loadEthereumWallets()
        },
      }),
      mpp: true,
      testnet,
    })
  }

  if (adapterType === 'privyReact') {
    const client = getPrivyReactAdapterClient()
    return Provider.create({
      adapter: privy({
        client,
        async createAccount({ client }) {
          // Privy's modal handles signup vs login automatically; with
          // `createOnLogin: 'users-without-wallets'` configured on PrivyProvider,
          // a wallet is provisioned for new users as part of login.
          await ensurePrivyReactLoggedIn()
          const wallets = await client.loadEthereumWallets()
          const wallet = wallets[0]
          if (!wallet) throw new Error('No Privy embedded Ethereum wallet was created after login.')
          return wallet
        },
        async loadAccounts({ client }) {
          await ensurePrivyReactLoggedIn()
          return await client.loadEthereumWallets()
        },
      }),
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
    mpp: mpp(),
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

function createTurnkeySubOrgParams(name?: string | undefined) {
  return {
    ...(name ? { userName: name } : {}),
    customWallet: {
      walletName: 'Tempo Playground',
      walletAccounts: generateWalletAccountsFromAddressFormat({
        addresses: [turnkeyEthereumAddressFormat],
      }),
    },
  } satisfies CreateSubOrgParams
}

function getPrivyCore() {
  const appId = import.meta.env.VITE_PRIVY_APP_ID
  if (!appId) throw new Error('VITE_PRIVY_APP_ID is required for the Privy adapter.')

  if (!privyClient) {
    privyClient = new Privy({
      appId,
      ...(import.meta.env.VITE_PRIVY_CLIENT_ID
        ? { clientId: import.meta.env.VITE_PRIVY_CLIENT_ID }
        : {}),
      storage: new PrivyLocalStorage(),
    })
    mountPrivyEmbeddedWalletIframe(privyClient)
  }

  return privyClient
}

/** Mount the Privy secure-context iframe per https://docs.privy.io/recipes/core-js. */
function mountPrivyEmbeddedWalletIframe(client: Privy) {
  const iframe = document.createElement('iframe')
  iframe.src = client.embeddedWallet.getURL()
  iframe.title = 'Privy embedded wallet'
  iframe.style.display = 'none'

  privyIframeReady = new Promise<void>((resolve) => {
    iframe.addEventListener('load', () => resolve())
  })

  document.body.appendChild(iframe)

  client.setMessagePoster(
    iframe.contentWindow as unknown as Parameters<Privy['setMessagePoster']>[0],
  )

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
    client.embeddedWallet.onMessage(data)
  })
}

/**
 * Wires `@privy-io/js-sdk-core` into the minimal {@link privy.Client} surface the
 * accounts adapter expects. All Privy-specific wallet filtering and the per-wallet
 * `getEthereumProvider` plumbing lives here, in playground code — not in the adapter.
 */
function makePrivyCoreClient(client: Privy): privy.Client {
  return {
    initialize: () => client.initialize(),
    getAccessToken: () => client.getAccessToken(),
    async getCurrentUserId() {
      const { user } = await client.user.get()
      return user?.id ?? null
    },
    async loadEthereumWallets() {
      await privyIframeReady
      const { user } = await client.user.get()
      if (!user) return []
      const wallets = getAllUserEmbeddedEthereumWallets(user)
      const entropy = getEntropyDetailsFromUser(user)
      if (!entropy) return []
      const { entropyId, entropyIdVerifier } = entropy
      return await Promise.all(
        wallets.map(async (wallet) => ({
          address: wallet.address,
          provider: await client.embeddedWallet.getEthereumProvider({
            wallet,
            entropyId,
            entropyIdVerifier,
          }),
        })),
      )
    },
    logout: (parameters) => client.auth.logout(parameters),
  }
}

export function switchTheme(
  next: DialogNs.Theme | undefined,
  adapterType: AdapterType = 'tempoWallet',
) {
  theme = next
  Mppx.restore()
  provider = createProvider(adapterType)
}
