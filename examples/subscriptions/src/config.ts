import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/tempo'

export const config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [tempoWallet()],
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
