import { createConfig, http } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'
import { webAuthn } from '@tempoxyz/accounts/wagmi'

export const config = createConfig({
  chains: [tempoModerato],
  connectors: [
    webAuthn({
      authUrl: '/auth',
      feePayerUrl: '/fee-payer',
    }),
  ],
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
