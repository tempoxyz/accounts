import { Expiry } from 'accounts'
import { parseUnits } from 'viem'
import { type Config, createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

export const wagmiConfig: Config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [tempoWallet({ mpp: true })],
  multiInjectedProviderDiscovery: false,
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
      testnet: true,
      authorizeAccessKey: () => ({
        expiry: Expiry.days(1),
        limits: [{ token: pathUsd, limit: parseUnits('100', 6) }],
        scopes: [
          { address: pathUsd, selector: 'transfer(address,uint256)' },
        ],
      }),
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempoModerato.id]: http(),
    [tempo.id]: http(),
  },
})

export const themingWagmiConfig: Config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [
    tempoWallet({
      mpp: true,
      testnet: true,
      theme: {
        accent: '#ff007a',
        radius: 'full',
      },
    }),
  ],
  multiInjectedProviderDiscovery: false,
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
