import { getConnectors } from '@wagmi/core'
import { Remote, Storage, TrustedHosts } from 'accounts'
import { webAuthn } from 'accounts/wagmi'
import { http } from 'viem'
import { createConfig } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

import * as Messenger from './messenger.js'

/** Provider instance for executing confirmed requests. */
export const wagmiConfig = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [
    webAuthn({
      authUrl: '/api/webauthn',
      storage: Storage.combine(Storage.cookie(), Storage.localStorage()),
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(),
    [tempoModerato.id]: http(),
  },
})

/** Remote context singleton. */
export const remote = Remote.create({
  messenger: Messenger.init(),
  provider: await getConnectors(wagmiConfig as any)[0]!.getProvider(),
  trustedHosts: TrustedHosts.hosts['tempo.xyz'],
})
