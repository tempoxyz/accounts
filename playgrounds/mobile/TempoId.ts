/**
 * The app's Tempo ID instance, which signs in on Tempo ID's pages in the system browser, saves the
 * session in the device's secure store, and sends with Viem.
 * @module
 */
import { Id } from 'accounts'
import { http } from 'viem'
import { tempo, tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import { expo } from 'accounts/expo'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'

/** OUSD, at its mainnet address on every Tempo chain. */
export const ousd = Tokens.ousd(tempo.id).address

/** A local node's RPC URL, such as the stack's, on whose chain the API playground's MPP routes charge. */
const rpcUrl = process.env.EXPO_PUBLIC_TEMPO_RPC_URL

/**
 * The instance. Each sign-in that names no `accessKey` requests an access key that may spend up to
 * $1,000 of OUSD for a day. Without `scopes`, the access key may call `transfer` and
 * `transferWithMemo` on OUSD, and `open` and `topUp` on the channel reserve, which MPP charges and
 * sessions call.
 * `expo` keeps the session in the device's secure store, and signs in on Tempo ID's pages in the
 * system browser, in an ephemeral session on iOS, which returns to the app's scheme from `app.json`.
 */
/** The app's registered redirect URI, which the sign-in and the deposit page return to. */
export const redirectUri = 'xyz.tempo.example.mobile:/callback'

export const tempoId = Id.create({
  accessKey: { expiry: '1d', limits: [{ limit: '1000', token: 'ousd' }] },
  // A local node, or Tempo testnet without a URL.
  chainId: rpcUrl ? tempoLocalnet.id : tempoTestnet.id,
  // The app that `scripts/seed.ts` registers.
  clientId: process.env.EXPO_PUBLIC_CLIENT_ID ?? 'tempo-example-mobile',
  plugins: [
    expo({ redirectUri }),
    // Without a URL, the transport uses the chain's own RPC.
    viem({ transport: http(rpcUrl) }),
    // Pays MPP endpoints with the session's access key.
    mpp(),
  ],
  url: process.env.EXPO_PUBLIC_TEMPO_ID_URL ?? 'http://localhost:5173',
})
