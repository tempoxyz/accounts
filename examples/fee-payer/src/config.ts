import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/connectors'

const relay = await (async () => {
  if (import.meta.env.MODE === 'development') {
    const { getTunnelUrl } = await import('virtual:vite-plugin-cloudflare-tunnel')
    return `${getTunnelUrl()}/relay`
  }
  return '/relay'
})()

const relayTransport = (chainId: number) => http(`${relay.replace(/\/$/, '')}/${chainId}`)

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [tempoWallet({ testnet: true, relay })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: relayTransport(tempo.id),
    [tempoModerato.id]: relayTransport(tempoModerato.id),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
