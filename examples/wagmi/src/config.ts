import { createConfig, http } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'
import { webAuthn } from 'zyzz/wagmi'

export const config = createConfig({
  chains: [tempoModerato],
  connectors: [webAuthn()],
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
