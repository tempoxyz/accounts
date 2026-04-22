import { getConnectors } from '@wagmi/core'
import { Remote, Storage } from 'accounts'
import { http } from 'viem'
import { createConfig } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { webAuthn } from 'wagmi/tempo'

import * as Messenger from './messenger.js'

/** Provider instance for executing confirmed requests. */
export const wagmiConfig = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [
    webAuthn({
      // WARNING: An `authUrl` must be passed in production.
      // authUrl: '/webauthn',
      persistCredentials: false,
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
})
