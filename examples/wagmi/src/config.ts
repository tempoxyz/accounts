import { tempoAuth } from '@tempoxyz/accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'

export const config = createConfig({
  chains: [tempoModerato],
  connectors: [tempoAuth({ host: 'https://localhost:5174' })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempoModerato.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
