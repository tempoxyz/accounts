import { Mount, Provider, tempoWallet } from 'accounts'

const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')

/** Timeline of the in-flight action, relative to the click. */
let marks: { t0: number; events: [string, number][] } | undefined

function mark(name: string) {
  if (!marks) return
  marks.events.push([name, Math.round(performance.now() - marks.t0)])
}

// Observe the wire without touching the SDK: popup open, wallet frames, popup close.
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
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://wallet.tempo.xyz') return
  const { type } = (event.data ?? {}) as { type?: string | undefined }
  mark(`wallet → ${type ?? 'frame'}`)
})

const provider = Provider.create({
  adapter: tempoWallet({
    ...(mode === 'popup' ? { mount: Mount.popup() } : {}),
    ...(mode === 'iframe' ? { mount: Mount.iframe() } : {}),
  }),
  testnet: params.get('testnet') !== 'false',
})

const log = document.getElementById('log')!
const state = document.getElementById('state')!

const results: Record<string, unknown>[] = []
;(window as never as { __perf: unknown }).__perf = results

function flush() {
  log.textContent = JSON.stringify(results, null, 2)
}

async function run(name: string, fn: () => Promise<unknown>) {
  marks = { t0: performance.now(), events: [] }
  const entry: Record<string, unknown> = { action: name, events: marks.events }
  results.push(entry)
  try {
    const result = await fn()
    mark('callback resolved')
    entry.result = result
  } catch (error) {
    mark('callback rejected')
    entry.error = (error as Error).message
  }
  flush()
  render()
}

async function render() {
  const accounts = await provider.request({ method: 'eth_accounts' })
  state.textContent = JSON.stringify({ accounts }, null, 2)
}

document.getElementById('connect')!.addEventListener('click', () =>
  run('connect', () =>
    provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: `perf-${Date.now()}` } }],
    }),
  ),
)
document.getElementById('sign')!.addEventListener('click', () =>
  run('personal_sign', async () => {
    const [account] = await provider.request({ method: 'eth_accounts' })
    return provider.request({ method: 'personal_sign', params: ['0x68656c6c6f', account!] })
  }),
)
document
  .getElementById('disconnect')!
  .addEventListener('click', () =>
    run('disconnect', () => provider.request({ method: 'wallet_disconnect' } as never)),
  )
document.getElementById('clear')!.addEventListener('click', () => {
  results.length = 0
  flush()
})

render()
