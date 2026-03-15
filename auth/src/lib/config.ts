import { getConnectors } from '@wagmi/core'
import { Storage } from 'tempox'
import { Remote } from 'tempox'
import { webAuthn } from 'tempox/wagmi'
import { defineChain, http } from 'viem'
import { tempo, tempoLocalnet, tempoModerato } from 'viem/chains'
import { createConfig } from 'wagmi'

import * as Messenger from './messenger.js'

const chains = (() => {
  const rpcUrl = import.meta.env.VITE_RPC_URL
  if (!rpcUrl) return [tempo, tempoModerato] as const
  return [
    defineChain({ ...tempoLocalnet, rpcUrls: { default: { http: [rpcUrl] } } }),
    tempo,
    tempoModerato,
  ] as const
})()

/** Provider instance for executing confirmed requests. */
export const wagmiConfig = createConfig({
  chains,
  connectors: [
    webAuthn({
      storage: Storage.combine(Storage.cookie(), Storage.localStorage()),
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(),
    [tempoModerato.id]: http(),
    [tempoLocalnet.id]: http(),
  },
})

/** Remote context singleton. */
export const remote = Remote.create({
  messenger: Messenger.init(),
  provider: await getConnectors(wagmiConfig)[0].getProvider(),
})
