/**
 * The chain of the browser playgrounds: Tempo mainnet by default, Tempo testnet when the tab's
 * toggle selects it, or the local node at `TEMPO_RPC_URL`, which the end-to-end suite runs.
 * @module
 */
import { tempo, tempoLocalnet, tempoTestnet } from 'viem/tempo/chains'

/** The storage key of the selected network, which every tab of the playground's origin shares. */
const storageKey = 'chain'

/** The networks that the toggle selects, in the order that it lists them. */
const networks = {
  mainnet: tempo,
  testnet: tempoTestnet,
} as const

/** A network that the toggle selects. */
export type Network = keyof typeof networks

const rpcUrl = import.meta.env.TEMPO_RPC_URL as string | undefined

/**
 * The selected network: the tab's `?chain=`, kept in storage, or `mainnet`. Absent with
 * `TEMPO_RPC_URL`, whose local node the page uses.
 */
export const network: Network | undefined = (() => {
  if (rpcUrl) return undefined
  const requested = new URLSearchParams(location.search).get('chain')
  if (requested === 'mainnet' || requested === 'testnet') {
    write(requested)
    return requested
  }
  const stored = read()
  return stored === 'testnet' ? 'testnet' : 'mainnet'
})()

/** The chain that the page signs in, funds, and sends on. */
export const chain = network ? networks[network] : tempoLocalnet

/**
 * The toggle of the network, beside the page's title. A change reloads the page on the selected
 * network. With `TEMPO_RPC_URL`, it renders nothing.
 */
export function Toggle() {
  if (!network) return null
  return (
    <label className="chain">
      <span className="muted">Network</span>
      <select
        defaultValue={network}
        onChange={(event) =>
          select({ network: event.currentTarget.value as Network })
        }
      >
        {Object.keys(networks).map((name) => (
          <option key={name} value={name}>
            {name === 'mainnet' ? 'Mainnet' : 'Testnet'}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Stores the network and reloads the page on it, since the instance takes its chain when it loads.
 * The reload drops the tab's `?chain=`, which would select the earlier network again.
 */
export function select(options: select.Options) {
  write(options.network)
  const url = new URL(location.href)
  url.searchParams.delete('chain')
  location.assign(url.href)
}

export declare namespace select {
  type Options = {
    /** The network to load the page on. */
    network: Network
  }
}

/** Returns the stored network, or `null` when storage holds none or the browser blocks it. */
function read() {
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

/** Stores the network. A browser that blocks storage keeps the default on the next load. */
function write(value: string) {
  try {
    localStorage.setItem(storageKey, value)
  } catch {}
}
