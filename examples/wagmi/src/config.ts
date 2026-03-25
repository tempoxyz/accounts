import { tempoWallet } from 'tempodk/wagmi'
import { createConfig, http } from 'wagmi'
import { tempoModerato } from 'wagmi/chains'

export const config = createConfig({
  chains: [tempoModerato],
  connectors: [
    tempoWallet({
      host: import.meta.env.VITE_AUTH_HOST ?? 'https://app.moderato.tempo.local:3001/embed',
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
