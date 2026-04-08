import { Storage } from 'accounts'
import { webAuthn } from 'accounts/wagmi'
import { createConfig, http } from 'wagmi'
import { tempoMainnet, tempoTestnet } from 'wagmi/chains'

/**
 * Wagmi config for the private fee-payer demo.
 *
 * This example keeps connector state in memory so a stale persisted account
 * cannot outlive the fee-payer's HttpOnly session cookie and appear connected
 * without a valid `/fee-payer` session.
 */
export const config = createConfig({
  chains: [tempoMainnet, tempoTestnet],
  connectors: [
    webAuthn({
      testnet: true,
      authUrl: '/auth',
      feePayerUrl: '/fee-payer',
      storage: Storage.memory({ key: 'with-private-fee-payer' }),
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempoMainnet.id]: http(),
    [tempoTestnet.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
