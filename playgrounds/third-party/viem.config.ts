/** The third-party playground's Tempo ID configuration and Viem client. @module */
import { Id, Store } from 'accounts'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { type Chain, custom, http } from 'viem'
import { createClient } from 'viem/tempo'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import * as Network from '../web/Chain.tsx'
import * as Metadata from './metadata.ts'

/** OUSD, at its mainnet address on every Tempo chain. */
export const ousd = Tokens.ousd(tempo.id).address

const rpcUrl = import.meta.env.TEMPO_RPC_URL as string | undefined

/** The chain the page funds and sends on, which the page's toggle selects. */
const { chain } = Network

/** The storage key of the chosen kind of client ID. */
export const clientIdKey = 'clientId'

/** Whether the client ID is the origin, whose manifest names the app. */
export const byOrigin = (() => {
  try {
    return localStorage.getItem(clientIdKey) === 'origin'
  } catch {
    // A browser that blocks storage keeps the metadata document.
    return false
  }
})()

/** The origin, or the URL of the metadata document. */
export const clientId = byOrigin
  ? location.origin
  : `${location.origin}${Metadata.path}`

/** Tempo ID's URL. */
export const tempoIdUrl =
  import.meta.env.TEMPO_ID_URL ?? 'http://localhost:5173'

/**
 * The configuration of the actions, on the page's chain. The page holds its sign-in itself, so it
 * calls the actions without an instance.
 */
export const auth = Id.from({
  chainId: chain.id,
  clientId,
  url: tempoIdUrl,
})

/**
 * The instance that pays MPP endpoints, through each chain's client of {@link on}. The page holds its
 * sign-in itself, so each payment names the page's session, and the instance keeps none.
 */
export const payments = Id.create({
  chainId: chain.id,
  clientId,
  plugins: [viem((chainId) => ({ transport: custom(on(chainId)) })), mpp()],
  store: Store.memory(),
  url: tempoIdUrl,
})

/** The client, without an account, so a sign-out leaves no key to sign with. */
export const client = createClient({
  chain,
  feeToken: ousd,
  // Without a URL, the transport uses the chain's own RPC.
  transport: http(rpcUrl),
})

/**
 * Returns the client that sends and reads on a key's chain: the page's own, or one on another Tempo
 * chain through the Worker's `/rpc` relay, whose node URL can hold a key. A chain without a
 * definition keeps the page's.
 */
export function on(chainId: number) {
  const chains: readonly Chain[] = [
    tempo,
    tempoTestnet,
    tempoDevnet,
    tempoLocalnet,
  ]
  const other =
    chainId === chain.id
      ? undefined
      : chains.find((entry) => entry.id === chainId)
  if (!other) return client
  return createClient({
    chain: other,
    feeToken: ousd,
    transport: http(`${location.origin}/rpc/${chainId}`),
  })
}
