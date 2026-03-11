import { Messenger } from '@tempoxyz/accounts'

/** Initializes the bridge messenger for the Tempo Connect app (the "remote" side). */
export function init(): Messenger.Bridge {
  if (typeof window === 'undefined') return Messenger.noop()

  const target = window.opener ?? window.parent
  if (!target || target === window) return Messenger.noop()

  return Messenger.bridge({
    from: Messenger.fromWindow(window, {
      expectedSource: target,
    }),
    to: Messenger.fromWindow(target),
  })
}
