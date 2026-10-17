import {
  type Adapter,
  Mount,
  postMessage,
  Provider,
  tempoWallet,
  webAuthn,
  WebAuthnCeremony,
} from 'accounts'
import { createClient, http } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoModerato } from 'viem/tempo/chains'

/** Benchmark target, selected by `?adapter=tempoWallet|webAuthn` and `?mode=popup|iframe`. */
const params = new URLSearchParams(window.location.search)
const adapter = params.get('adapter') === 'webAuthn' ? 'webAuthn' : 'tempoWallet'
const mode = params.get('mode') === 'iframe' ? 'iframe' : 'popup'
/**
 * Optional wallet page override (e.g. a local or preview Tempo Wallet). Only
 * `http:` and `https:` URLs are accepted, since the iframe mount loads it eagerly.
 */
const host = (() => {
  const value = params.get('host')
  if (!value) return null
  const url = URL.parse(value)
  if (url?.protocol !== 'https:' && url?.protocol !== 'http:')
    throw new Error(`Invalid host: ${value}. Use an http: or https: URL.`)
  return url.toString()
})()

const renderer = adapter === 'webAuthn' ? 'webAuthn' : `tempoWallet/${mode}`

/** Recipient of the benchmark transfer. */
const recipient = '0x000000000000000000000000000000000000dEaD'
const pathUsd = '0x20c0000000000000000000000000000000000000'

/** Timeline of the in-flight action, in milliseconds relative to the click. */
let marks: { events: [string, number][]; t0: number } | undefined

function mark(name: string) {
  if (!marks) return
  marks.events.push([name, Math.round(performance.now() - marks.t0)])
}

// Observe the wire without touching the SDK: popup open/close and wallet frames.
const open = window.open.bind(window)
window.open = (...args) => {
  mark('window.open')
  const win = open(...args)
  if (win) {
    const timer = setInterval(() => {
      if (!win.closed) return
      mark('popup closed')
      clearInterval(timer)
      flush()
    }, 5)
  }
  return win
}

const walletOrigin = new URL(host ?? 'https://wallet.tempo.xyz').origin
window.addEventListener('message', (event) => {
  if (event.origin !== walletOrigin) return
  const { type } = (event.data ?? {}) as { type?: string | undefined }
  mark(`wallet → ${type ?? 'frame'}`)
})

const provider = Provider.create({
  adapter: ((): Adapter.Adapter => {
    // Local ceremony keeps the bench a static app: the passkey prompt and signing
    // are timed without a relying-party server round trip.
    if (adapter === 'webAuthn') return webAuthn({ ceremony: WebAuthnCeremony.local() })
    const mount = mode === 'iframe' ? Mount.iframe() : Mount.popup()
    if (host) return postMessage({ host, mount, name: 'Tempo Wallet', rdns: 'xyz.tempo' })
    return tempoWallet({ mount })
  })(),
  testnet: true,
})

const client = createClient({ chain: tempoModerato, transport: http() })

/** One timed action. Exposed as `window.__bench` for `scripts/bench.ts`. */
type Entry = {
  action: string
  error?: string | undefined
  events: [string, number][]
  renderer: string
  result?: unknown
}

const results: Entry[] = []
;(window as never as { __bench: Entry[] }).__bench = results

const config = document.getElementById('config')!
const log = document.getElementById('log')!
const state = document.getElementById('state')!

config.textContent = `Renderer: ${renderer}. Chain: ${tempoModerato.name}.`

function flush() {
  log.textContent = JSON.stringify(results, null, 2)
}

async function render() {
  const accounts = await provider.request({ method: 'eth_accounts' })
  state.textContent = JSON.stringify({ accounts }, null, 2)
}

async function account() {
  const [address] = await provider.request({ method: 'eth_accounts' })
  if (!address) throw new Error('Not connected.')
  return address
}

async function run(action: string, fn: () => Promise<unknown>) {
  marks = { events: [], t0: performance.now() }
  const entry: Entry = { action, events: marks.events, renderer }
  results.push(entry)
  try {
    entry.result = await fn()
    mark('callback resolved')
  } catch (error) {
    mark('callback rejected')
    entry.error = (error as Error).message
  }
  marks = undefined
  flush()
  await render()
}

document.getElementById('register')!.addEventListener('click', () =>
  run('register', () =>
    provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: `bench-${Date.now()}` } }],
    }),
  ),
)

document.getElementById('login')!.addEventListener('click', () =>
  run('login', () =>
    provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    }),
  ),
)

// Untimed setup: a new account holds no fee tokens until the testnet faucet funds it.
document
  .getElementById('fund')!
  .addEventListener('click', async () =>
    run('fund', async () => Actions.faucet.fundSync(client, { account: await account() })),
  )

document.getElementById('send')!.addEventListener('click', () =>
  run('send', async () => {
    const call = Actions.token.transfer.call({ amount: 1n, to: recipient, token: pathUsd })
    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [call] }],
    })
    // A reverted transfer still resolves, so it must not score as a successful send.
    if (receipt.status !== '0x1')
      throw new Error(`Transaction reverted: ${receipt.transactionHash}`)
    return { status: receipt.status, transactionHash: receipt.transactionHash }
  }),
)

document
  .getElementById('disconnect')!
  .addEventListener('click', () =>
    run('disconnect', () => provider.request({ method: 'wallet_disconnect' })),
  )

document.getElementById('clear')!.addEventListener('click', () => {
  results.length = 0
  flush()
})

void render()
