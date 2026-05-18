import { Expiry } from 'accounts'
import { parseUnits } from 'viem'
import { type Config, createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/tempo'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const relay = '/relay'

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
        scopes: [{ address: pathUsd, selector: 'transfer(address,uint256)' }],
      }),
    }),
  ],
  multiInjectedProviderDiscovery: false,
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
      relay,
      testnet: true,
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempoModerato.id]: http(`/relay/${tempoModerato.id}`),
    [tempo.id]: http(`/relay/${tempo.id}`),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
