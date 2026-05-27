import { Expiry, Storage as AccountsStorage } from 'accounts'
import { parseUnits } from 'viem'
import { type Config, createConfig, createStorage, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const accountsStorage = AccountsStorage.idb()
const wagmiStorage = createStorage({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
})

export const wagmiConfig: Config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [tempoWallet({ storage: accountsStorage, testnet: true })],
  multiInjectedProviderDiscovery: false,
  storage: wagmiStorage,
  transports: {
    [tempoModerato.id]: http(),
    [tempo.id]: http(),
  },
})

export const spendPermissionsWagmiConfig: Config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [
    tempoWallet({
      mpp: true,
      storage: accountsStorage,
      testnet: true,
      authorizeAccessKey: () => ({
        expiry: Expiry.days(1),
        limits: [{ token: pathUsd, limit: parseUnits('100', 6) }],
        scopes: [{ address: pathUsd, selector: 'transfer(address,uint256)' }],
      }),
    }),
  ],
  multiInjectedProviderDiscovery: false,
  storage: wagmiStorage,
  transports: {
    [tempoModerato.id]: http(),
    [tempo.id]: http(),
  },
})

export const feeSponsorshipWagmiConfig: Config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [
    tempoWallet({
      authorizeAccessKey: () => ({
        expiry: Expiry.days(1),
        limits: [{ token: pathUsd, limit: parseUnits('100', 6) }],
        scopes: [{ address: pathUsd, selector: 'transfer(address,uint256)' }],
      }),
      feePayer: '/relay',
      storage: accountsStorage,
      testnet: true,
    }),
  ],
  multiInjectedProviderDiscovery: false,
  storage: wagmiStorage,
  transports: {
    [tempoModerato.id]: http(),
    [tempo.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
