/**
 * The wagmi playground's Tempo ID instance. Its `wagmi` member is the page's wagmi config, whose one
 * connector is the instance itself, so each sign-in through the instance connects wagmi.
 * @module
 */
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { dialog, email, passkey, redirect, viem } from 'accounts/plugins'
import { wagmi } from 'accounts/wagmi'
import { http } from 'viem'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import * as Chain from '../web/Chain.tsx'

/** OUSD, at its mainnet address on every Tempo chain. */
export const ousd = Tokens.ousd(tempo.id).address

const rpcUrl = import.meta.env.TEMPO_RPC_URL as string | undefined

/** The tab's `?client_id=`, kept across redirects, or the build's own. */
export const clientId = (() => {
  const requested = new URLSearchParams(location.search).get('client_id')
  if (requested) sessionStorage.setItem('client_id', requested)
  return (
    requested ??
    sessionStorage.getItem('client_id') ??
    import.meta.env.VITE_CLIENT_ID ??
    'tempo-example-wagmi'
  )
})()

/** Tempo ID's URL. */
export const tempoIdUrl =
  import.meta.env.TEMPO_ID_URL ?? 'http://localhost:5173'

/**
 * The instance, on a local node with `TEMPO_RPC_URL`, else on the network that the page's toggle
 * selects, Tempo mainnet by default. Its dialog's frame loads
 * hidden with the page, so "Sign in via dialog" shows a ready sign-in. `VITE_PAR`: `true` pushes each
 * authorization request to `/oauth2/par`. `VITE_PRELOAD`: `false` loads the frame only at the click.
 * The `wagmi` plugin reads the chains and transports of the `viem` plugin.
 */
export const accounts = Accounts.create({
  chainId: Chain.chain.id,
  // The app that `scripts/seed.ts` registers.
  clientId,
  plugins: [
    dialog({
      par: import.meta.env.VITE_PAR === 'true' ? true : undefined,
      preload: import.meta.env.VITE_PRELOAD !== 'false',
    }),
    email(),
    passkey(),
    redirect(),
    // A deployed page sends through the Worker's `/rpc` relay, whose node URL can hold a key, since a
    // chain's public RPC sends no CORS headers. The dev server has no relay.
    viem((chainId) => {
      if (rpcUrl) return { transport: http(rpcUrl) }
      if (import.meta.env.PROD)
        return { transport: http(`${location.origin}/rpc/${chainId}`) }
      return {}
    }),
    wagmi(),
    // Pays MPP endpoints with the session's access key, on the viem plugin's chains.
    mpp(),
  ],
  url: tempoIdUrl,
})
