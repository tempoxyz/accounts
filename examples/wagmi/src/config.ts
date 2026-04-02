import { tempoWallet } from 'accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'

export const testnet = (() => {
  const param = new URLSearchParams(window.location.search).get('testnet')
  if (param !== null) return param !== 'false'
  if (window.location.hostname.startsWith('testnet.')) return true
  return import.meta.env.VITE_ENV === 'testnet'
})()

export const tokensMap = {
  testnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    'USDC.e': '0x20c0000000000000000000009e8d7eb59b783726',
  },
  mainnet: {
    pathUSD: '0x20c0000000000000000000000000000000000000',
    'USDC.e': '0x20C000000000000000000000b9537d11c60E8b50',
  },
} as const

export const tokens = testnet ? tokensMap.testnet : tokensMap.mainnet

export const config = createConfig({
  chains: testnet ? [tempoModerato, tempo] : [tempo, tempoModerato],
  connectors: [tempoWallet()],
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
