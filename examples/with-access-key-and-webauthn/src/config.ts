import { Expiry } from 'accounts'
import { webAuthn } from 'accounts/wagmi'
import { parseUnits } from 'viem'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [
    webAuthn({
      testnet: true,
      authUrl: '/auth',
      authorizeAccessKey: () => ({
        expiry: Expiry.days(1),
        limits: [{ token: pathUsd, limit: parseUnits('100', 6) }],
      }),
    }),
  ],
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
