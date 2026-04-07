import { webAuthn } from 'accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'

export const config = createConfig({
  chains: [tempoModerato],
  connectors: [webAuthn({ testnet: true, authUrl: '/auth', feePayerUrl: '/fee-payer' })],
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
