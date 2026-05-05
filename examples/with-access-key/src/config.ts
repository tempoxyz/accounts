import { Expiry } from 'accounts'
import { parseUnits } from 'viem'
import { createConfig, http } from 'wagmi'
import { tempo, tempoModerato } from 'wagmi/chains'
import { tempoWallet } from 'wagmi/connectors'

const pathUsd = '0x20c0000000000000000000000000000000000000' as const

export const config = createConfig({
  chains: [tempo, tempoModerato],
  connectors: [
    tempoWallet({
      testnet: true,
      mpp: true,
      authorizeAccessKey: () => ({
        expiry: Expiry.days(1),
        limits: [{ token: pathUsd, limit: parseUnits('100', 6) }],
        scopes: [
          { address: pathUsd, selector: 'transfer(address,uint256)' },
          { address: pathUsd, selector: 'transferWithMemo(address,uint256,bytes32)' },
        ],
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
