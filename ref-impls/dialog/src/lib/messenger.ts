import { Messenger } from 'accounts'

/** Initializes the bridge messenger for the dialog app (the "remote" side). */
export function init(): Messenger.Bridge {
  if (typeof window === 'undefined') return Messenger.noop()

  const target = window.opener ?? window.parent
  if (!target || target === window) return Messenger.noop()

  const transport = Messenger.fromPostMessage({ role: 'host', target })
  return Messenger.bridge({ from: transport, to: transport })
}
