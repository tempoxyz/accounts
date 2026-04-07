import { webAuthn } from 'accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [webAuthn({ testnet: true, authUrl: '/auth', feePayerUrl: '/fee-payer' })],
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
