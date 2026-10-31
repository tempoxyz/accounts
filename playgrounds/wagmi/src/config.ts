import { getAddress } from 'viem'
import { pathusd, usdce } from 'viem/tokens'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/connectors'

export const testnet = (() => {
  const param = new URLSearchParams(window.location.search).get('testnet')
  if (param !== null) return param !== 'false'
  if (window.location.hostname.startsWith('testnet.')) return true
  return import.meta.env.VITE_ENV === 'testnet'
})()

export const tokensMap = {
  testnet: {
    pathUSD: pathusd(42431).address,
    'USDC.e': usdce(42431).address,
  },
  mainnet: {
    pathUSD: pathusd(4217).address,
    'USDC.e': getAddress(usdce(4217).address),
  },
} as const

export const tokens = testnet ? tokensMap.testnet : tokensMap.mainnet

export const config = createConfig({
  chains: testnet ? [tempoModerato, tempo] : [tempo, tempoModerato],
  connectors: [tempoWallet({ mpp: true, relay: '/relay' })],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempo.id]: http(`/relay/${tempo.id}`),
    [tempoModerato.id]: http(`/relay/${tempoModerato.id}`),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
