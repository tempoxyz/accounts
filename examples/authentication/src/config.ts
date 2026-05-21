import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/connectors'

const auth = await (async () => {
  if (import.meta.env.MODE === 'development') {
    const { getTunnelUrl } = await import('virtual:vite-plugin-cloudflare-tunnel')
    return `${getTunnelUrl()}/auth`
  }
  return '/auth'
})()

export const config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [tempoWallet({ auth })],
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
