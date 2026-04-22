import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { webAuthn } from 'wagmi/tempo'

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [webAuthn({ testnet: true, authUrl: '/auth' })],
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
