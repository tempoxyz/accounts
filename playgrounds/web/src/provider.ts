import Privy, {
  LocalStorage as PrivyLocalStorage,
  getAllUserEmbeddedEthereumWallets,
} from '@privy-io/js-sdk-core'
import { TurnkeyClient, generateWalletAccountsFromAddressFormat } from '@turnkey/core'
import type { CreateSubOrgParams } from '@turnkey/core'
import type { TurnkeyClientMethods } from '@turnkey/core'
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
import { Hex } from 'ox'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'

import { requestPrivyEmailOtp } from './privyOtpStore.js'
import { requestTurnkeyEmailOtp, type TurnkeyEmailOtpClient } from './turnkeyOtpStore.js'

export type AdapterType =
  | 'secp256k1'
  | 'webAuthn'
  | 'turnkey'
  | 'privy'
  | 'tempoWallet'
  | 'dialogRefImpl'
export type Env = 'mainnet' | 'testnet' | 'devnet'
export type DialogMode = 'iframe' | 'popup'
export type ProviderValue = ReturnType<typeof Provider.create>
type TurnkeyPlaygroundClient = turnkey.Client &
  TurnkeyEmailOtpClient & {
    createWallet: TurnkeyClientMethods['createWallet']
  }
const turnkeyEthereumAddressFormat = 'ADDRESS_FORMAT_ETHEREUM'

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
export let theme: DialogNs.Theme | undefined
export let provider: ProviderValue = createProvider('tempoWallet')
let turnkeyClient: TurnkeyClient | undefined
let privyClient: Privy | undefined

export function createProvider(adapterType: AdapterType): ProviderValue {
  if (adapterType === 'tempoWallet')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host,
        theme,
      }),
      mpp: true,
      testnet,
    })

  if (adapterType === 'dialogRefImpl')
    return Provider.create({
      adapter: dialog({
        dialog: dialogMode === 'popup' ? Dialog.popup() : Dialog.iframe(),
        host: import.meta.env.VITE_REF_DIALOG_HOST,
        theme,
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

  if (adapterType === 'turnkey') {
    const client = getTurnkeyAdapterClient()
    return Provider.create({
      adapter: turnkey({
        client,
        async createAccount({ client, parameters }) {
          const client_ = client as TurnkeyPlaygroundClient
          await requestTurnkeyEmailOtp({
            client: client_,
            createSubOrgParams: createTurnkeySubOrgParams(parameters.name),
            mode: 'register',
          })
          const account = (await getOrCreateEthereumAccounts(client_))[0]
          return account
        },
        async loadAccounts({ client }) {
          const client_ = client as TurnkeyPlaygroundClient
          await requestTurnkeyEmailOtp({
            client: client_,
            createSubOrgParams: createTurnkeySubOrgParams(),
            mode: 'login',
          })
          return await getOrCreateEthereumAccounts(client_)
        },
      }),
      mpp: true,
      testnet,
    })
  }

  if (adapterType === 'privy') {
    const client = getPrivyAdapterClient()
    return Provider.create({
      adapter: privy({
        client,
        async createAccount({ client }) {
          const client_ = client as Privy
          await requestPrivyEmailOtp({ client: client_.auth, mode: 'register' })
          const wallets = await getPrivyEmbeddedWallets(client_)
          const wallet = wallets[0]
          if (!wallet) throw new Error('No Privy embedded Ethereum wallet was created.')
          return wallet
        },
        async loadAccounts({ client }) {
          const client_ = client as Privy
          if (!(await client_.getAccessToken().catch(() => null)))
            await requestPrivyEmailOtp({ client: client_.auth, mode: 'login' })
          return await getPrivyEmbeddedWallets(client_)
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

async function getEthereumAccounts(client: TurnkeyPlaygroundClient) {
  return (await client.fetchWallets())
    .flatMap((wallet) => wallet.accounts)
    .filter((account) => account.addressFormat === turnkeyEthereumAddressFormat)
}

async function getOrCreateEthereumAccounts(client: TurnkeyPlaygroundClient) {
  const existing = await getEthereumAccounts(client)
  if (existing.length > 0) return existing

  await client.createWallet({
    walletName: 'Tempo Playground',
    accounts: [turnkeyEthereumAddressFormat],
  })

  const created = await getEthereumAccounts(client)
  if (created.length > 0) return created

  throw new Error('No Turnkey Ethereum account found after creating a wallet.')
}

function getPrivyAdapterClient() {
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

/**
 * Mount the Privy embedded-wallet iframe and wire it to the SDK so signing works.
 *
 * `@privy-io/js-sdk-core` does not ship its own iframe — that is normally provided
 * by `PrivyProvider` in `@privy-io/react-auth`. Without an iframe, any signing call
 * fails with `Embedded wallet proxy not initialized`. The React provider does the
 * exact same wiring under the hood.
 */
function mountPrivyEmbeddedWalletIframe(client: Privy) {
  const iframe = document.createElement('iframe')
  iframe.src = client.embeddedWallet.getURL()
  iframe.title = 'Privy embedded wallet'
  iframe.allow = 'publickey-credentials-get *; clipboard-write *'
  iframe.style.position = 'fixed'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'

  iframe.addEventListener('load', () => {
    if (!iframe.contentWindow) return
    const targetOrigin = new URL(iframe.src).origin
    client.setMessagePoster({
      postMessage: (message, _targetOrigin, transfer) =>
        iframe.contentWindow!.postMessage(
          message,
          targetOrigin,
          transfer ? [transfer] : undefined,
        ),
      reload: () => {
        iframe.src = client.embeddedWallet.getURL()
      },
    })
  })

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return
    client.embeddedWallet.onMessage(event.data)
  })

  document.body.appendChild(iframe)
}

async function getPrivyEmbeddedWallets(client: Privy): Promise<readonly privy.EmbeddedWallet[]> {
  const { user } = await client.user.get()
  const wallets = getAllUserEmbeddedEthereumWallets(user)
  return Promise.all(
    wallets.map(async (wallet) => {
      const provider = await client.embeddedWallet.getProvider(wallet)
      return {
        address: wallet.address,
        signRawHash: async (hash) =>
          (await provider.request({
            method: 'secp256k1_sign',
            params: [hash],
          })) as Hex.Hex,
      }
    }),
  )
}

export function switchTheme(
  next: DialogNs.Theme | undefined,
  adapterType: AdapterType = 'tempoWallet',
) {
  theme = next
  Mppx.restore()
  provider = createProvider(adapterType)
}
