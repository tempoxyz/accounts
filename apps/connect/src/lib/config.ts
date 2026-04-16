import { getConnectors } from '@wagmi/core'
import { Remote, Storage, TrustedHosts } from 'accounts'
import { webAuthn } from 'accounts/wagmi'
import { http } from 'viem'
import type { Capabilities } from 'viem/tempo'
import { createConfig } from 'wagmi'
import { tempo, tempoDevnet, tempoModerato } from 'wagmi/chains'

import * as Messenger from './messenger.js'

/** Provider instance for executing confirmed requests. */
export const wagmiConfig = createConfig({
  chains: [tempo, tempoDevnet, tempoModerato],
  connectors: [
    webAuthn({
      authUrl: '/api/webauthn',
      storage: Storage.combine(Storage.cookie(), Storage.localStorage()),
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(`/api/relay/${tempo.id}`),
    [tempoDevnet.id]: http(`/api/relay/${tempoDevnet.id}`),
    [tempoModerato.id]: http(`/api/relay/${tempoModerato.id}`),
  },
})

/** Remote context singleton. */
export const remote = Remote.create({
  messenger: Messenger.init(),
  provider: await getConnectors(wagmiConfig as any)[0]!.getProvider(),
  trustedHosts: TrustedHosts.hosts['tempo.xyz'],
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}

declare module 'viem' {
  interface Register {
    CapabilitiesSchema: Capabilities.Schema
  }
}
