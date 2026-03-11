import { Provider, webAuthn } from '@tempoxyz/accounts'
import { Events, Remote } from '@tempoxyz/accounts/remote'

import { router } from '../router.js'
import * as Messenger from './messenger.js'
import * as Store from './store.js'

/** Provider instance for executing confirmed requests. */
export const provider = Provider.create({
  adapter: webAuthn(),
  testnet: true,
})

/** Remote context singleton. */
export const remote = Remote.create({
  messenger: Messenger.init(),
  provider,
})

/** Dialog state store singleton. */
export const store = Store.create()

/** Wire messenger events. */
Events.onInitialized(remote, (payload) => {
  store.setState({ mode: payload.mode, referrer: payload.referrer })
})

Events.onRequests(remote, (requests) => {
  const pending = requests.find((r) => r.status === 'pending')
  if (!pending) return

  router.navigate({
    to: `/rpc/${pending.request.method}`,
    search: pending.request,
  } as never)
})

Remote.ready(remote)
