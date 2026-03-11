import { Messenger as Core_Messenger } from '@tempoxyz/accounts'

/** Initializes the bridge messenger for the Tempo Connect app (the "remote" side). */
export function init(): Core_Messenger.Bridge {
  if (typeof window === 'undefined') return Core_Messenger.noop()

  const target = window.opener ?? window.parent
  if (!target || target === window) return Core_Messenger.noop()

  return Core_Messenger.bridge({
    from: Core_Messenger.fromWindow(window, {
      expectedSource: target,
    }),
    to: Core_Messenger.fromWindow(target),
  })
}
