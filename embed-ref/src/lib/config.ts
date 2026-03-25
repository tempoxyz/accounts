import { getConnectors } from '@wagmi/core'
import { Remote, Storage } from 'tempodk'
import { webAuthn } from 'tempodk/wagmi'
import { http } from 'viem'
import { createConfig } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

import * as Messenger from './messenger.js'

/** Provider instance for executing confirmed requests. */
export const wagmiConfig = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [
    webAuthn({
      // WARNING: A server ceremony must be passed in production.
      // Uncomment this to use the server ceremony for webauthn.
      // ceremony: Ceremony.server({ url: '/webauthn' }),
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
  provider: await getConnectors(wagmiConfig)[0]!.getProvider(),
})
