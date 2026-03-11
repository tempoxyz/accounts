import { Provider, Storage, webAuthn } from '@tempoxyz/accounts'
import { Remote } from '@tempoxyz/accounts'
import { defineChain } from 'viem'
import { tempo, tempoLocalnet, tempoModerato } from 'viem/chains'

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
export const provider = Provider.create({
  adapter: webAuthn(),
  chains,
  storage: Storage.combine(Storage.cookie(), Storage.localStorage()),
})

/** Remote context singleton. */
export const remote = Remote.create({
  messenger: Messenger.init(),
  provider,
})