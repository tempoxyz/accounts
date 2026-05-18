import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { webAuthn } from 'wagmi/tempo'

const relay = '/relay'

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [webAuthn({ testnet: true, authUrl: '/auth', relay })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(`${relay}/${tempo.id}`),
    [tempoModerato.id]: http(`${relay}/${tempoModerato.id}`),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
