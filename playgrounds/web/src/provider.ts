import { TurnkeyClient } from '@turnkey/core'
import {
  type Dialog as DialogNs,
  WebAuthnCeremony,
  dialog,
  Dialog,
  local,
  Provider,
  turnkey,
  webAuthn,
} from 'accounts'
import { Mppx } from 'mppx/client'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'

export type AdapterType = 'secp256k1' | 'webAuthn' | 'turnkey' | 'tempoWallet' | 'dialogRefImpl'
export type Env = 'mainnet' | 'testnet' | 'devnet'
export type DialogMode = 'iframe' | 'popup'
export type ProviderValue = ReturnType<typeof Provider.create>
type TurnkeyPlaygroundClient = turnkey.Client & {
  loginWithPasskey: () => Promise<unknown>
  signUpWithPasskey: () => Promise<unknown>
}

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
    const client = getTurnkeyClient()
    return Provider.create({
      adapter: turnkey({
        client,
        async createAccount({ client }) {
          const client_ = client as TurnkeyPlaygroundClient
          await client_.signUpWithPasskey()
          const account = (await getEthereumAccounts(client_))[0]
          if (!account) throw new Error('No Turnkey Ethereum account found.')
          return account
        },
        async loadAccounts({ client }) {
          const client_ = client as TurnkeyPlaygroundClient
          const session = await client_.getSession()
          if (!session || (session.expiry && session.expiry * 1000 <= Date.now()))
            await client_.loginWithPasskey()
          return await getEthereumAccounts(client_)
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

function getTurnkeyClient() {
  const organizationId = import.meta.env.VITE_TURNKEY_ORGANIZATION_ID
  if (!organizationId)
    throw new Error('VITE_TURNKEY_ORGANIZATION_ID is required for the Turnkey adapter.')

  turnkeyClient ??= new TurnkeyClient({
    organizationId,
    authProxyConfigId: import.meta.env.VITE_TURNKEY_AUTH_PROXY_CONFIG_ID,
    passkeyConfig: {
      rpId: import.meta.env.VITE_TURNKEY_RP_ID ?? window.location.hostname,
    },
  })

  return turnkeyClient as unknown as turnkey.Client
}

async function getEthereumAccounts(client: TurnkeyPlaygroundClient) {
  return (await client.fetchWallets())
    .flatMap((wallet) => wallet.accounts)
    .filter((account) => account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM')
}

export function switchTheme(
  next: DialogNs.Theme | undefined,
  adapterType: AdapterType = 'tempoWallet',
) {
  theme = next
  Mppx.restore()
  provider = createProvider(adapterType)
}
