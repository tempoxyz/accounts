import { tempoConnect } from 'accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

const feePayerUrl = await (async () => {
  if (import.meta.env.MODE === 'development') {
    const { getTunnelUrl } = await import('virtual:vite-plugin-cloudflare-tunnel')
    return `${getTunnelUrl()}/relay`
  }
  return '/relay'
})()

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [tempoConnect({ testnet: true, feePayer: feePayerUrl })],
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
