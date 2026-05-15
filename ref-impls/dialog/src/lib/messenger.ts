import { Messenger } from 'accounts'

/** Initializes the bridge messenger for the dialog app (the "remote" side). */
export function init(): Messenger.Bridge {
  if (typeof window === 'undefined') return Messenger.noop()

  const target = window.opener ?? window.parent
  if (!target || target === window) return Messenger.noop()
  const targetOrigin = resolveTargetOrigin()
  if (!targetOrigin) return Messenger.noop()

  return Messenger.bridge({
    from: Messenger.fromWindow(window, { targetOrigin }),
    to: Messenger.fromWindow(target, { targetOrigin }),
  })
}

function resolveTargetOrigin() {
  const origin = new URLSearchParams(window.location.search).get('origin')
  if (origin) return new URL(origin).origin
  if (document.referrer) return new URL(document.referrer).origin
  return undefined
}
