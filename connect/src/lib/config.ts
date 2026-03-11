import { Provider, Storage, webAuthn } from '@tempoxyz/accounts'
import { Remote } from '@tempoxyz/accounts'

import * as Messenger from './messenger.js'

/** Provider instance for executing confirmed requests. */
export const provider = Provider.create({
  adapter: webAuthn(),
  storage: Storage.combine(Storage.cookie(), Storage.localStorage()),
})

/** Remote context singleton. */
export const remote = Remote.create({
  messenger: Messenger.init(),
  provider,
})