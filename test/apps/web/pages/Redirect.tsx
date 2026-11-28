/**
 * The redirect page of the web test app, at `/redirect/`: a sign-in that leaves the page for Tempo
 * ID's sign-in, and returns to it. The page is its own redirect URI, which Tempo ID matches exactly,
 * so the page returns without its query. A query thus sets only the request items of "Sign in", which
 * Tempo ID holds until the return. `useSession` completes the callback as the page loads. With
 * `memory` under `tempo-id-test:store` in the tab's `sessionStorage`, the instance keeps its state
 * in `Store.memory`, which "Sign in" refuses, since each page load empties it. With `lossy`, a
 * store that a page load empties without `local` keeps it, which the return then lacks. A query under
 * `tempo-id-test:redirect-query` extends the redirect URI, such as `?error=app_notice`. "Switch to
 * the second chain" selects the chain of the second node, which a `lossy` store loses at the return.
 * With `lossy` under `tempo-id-test:second`, a second instance of the app on that chain completes
 * each page load first. With `redis`, the instance keeps its state in `Store.redis`, whose client
 * runs each command in the origin's `localStorage` under one lock of all its tabs, so a `GETDEL` of
 * one tab is atomic.
 * @module
 */
import { Accounts, Store } from 'accounts'
import { redirect } from 'accounts/plugins'
import { tempoDevnet } from 'viem/tempo/chains'
import * as App from '../App.js'

/** Creates the page's instance, and renders the page. */
export async function start() {
  await second(sessionStorage.getItem('tempo-id-test:second'))

  const { accessKey, ...options } = await App.options()
  const accounts = Accounts.create({
    ...options,
    // An app can name the access key only in its sign-in, so a renewal derives it from the session.
    ...(App.query.get('signInKey') === '1' ? {} : { accessKey }),
    plugins: [redirect(), ...App.plugins()],
    redirectUri: `${window.location.origin}/redirect/${sessionStorage.getItem('tempo-id-test:redirect-query') ?? ''}`,
    ...store(sessionStorage.getItem('tempo-id-test:store')),
  })

  App.mount(accounts, {
    actions: {
      Prefetch: () => accounts.redirect.prefetch(),
      'Sign in': async () =>
        App.describe(
          await accounts.redirect.signIn({
            ...App.request(),
            ...App.funding(),
          }),
        ),
      'Switch to the second chain': () =>
        accounts.switchChain({ chainId: tempoDevnet.id }),
    },
  })
}

/**
 * With `mode` `lossy`, completes the page load with a second instance of the app on the second chain,
 * whose store a page load empties too, before the page's own instance. Writes its outcome under
 * `tempo-id-test:second-outcome` in the tab's `sessionStorage`.
 */
async function second(mode: string | null) {
  if (mode !== 'lossy') return
  const accounts = Accounts.create({
    ...(await App.options()),
    chain: tempoDevnet.id,
    plugins: [redirect()],
    redirectUri: `${window.location.origin}/redirect/`,
    ...store(mode),
  })
  const outcome = await accounts.session.get().then(
    (session) => (session ? 'signedIn' : 'signedOut'),
    (error: unknown) =>
      error instanceof Accounts.RequestError ? error.code : 'error',
  )
  sessionStorage.setItem('tempo-id-test:second-outcome', outcome)
}

/**
 * Returns the store of `mode`: `Store.memory` for `memory`, the same store without `local` for
 * `lossy`, which a page load empties too, `Store.redis` for `redis`, or none for the default store.
 */
function store(mode: string | null) {
  if (mode === 'memory') return { store: Store.memory() }
  if (mode === 'lossy')
    return { store: Store.from({ ...Store.memory(), local: false }) }
  if (mode === 'redis') return { store: Store.redis({ sendCommand }) }
  return {}
}

/**
 * Runs the Redis command `args` in the origin's `localStorage`, under the lock that each tab of the
 * origin takes, as a Redis server runs one command at a time. Each command and its reply take
 * `latency`, as on a network, so the commands of two tabs that load at once interleave.
 */
async function sendCommand(args: readonly string[]) {
  await new Promise((resolve) => setTimeout(resolve, latency))
  const reply = await navigator.locks.request('tempo-id-test:redis', () => {
    const [command, key = '', value = ''] = args
    const item = `tempo-id-test:redis:${key}`
    const stored = localStorage.getItem(item)
    if (command === 'DEL') localStorage.removeItem(item)
    if (command === 'GETDEL') localStorage.removeItem(item)
    if (command === 'SET') localStorage.setItem(item, value)
    if (command === 'DEL') return stored === null ? 0 : 1
    if (command === 'SET') return 'OK'
    return stored
  })
  await new Promise((resolve) => setTimeout(resolve, latency))
  return reply
}

/** The time that a Redis command, or its reply, takes in one direction, in milliseconds. */
const latency = 200
