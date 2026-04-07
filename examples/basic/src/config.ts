import { tempoWallet } from 'accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [tempoWallet({ testnet: true })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(),
    [tempoModerato.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
