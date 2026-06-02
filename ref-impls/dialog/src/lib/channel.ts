import { Dialog } from 'accounts'

/** Initializes the postMessage channel for the dialog host app. */
export function init(): Dialog.channel.Host {
  if (typeof window === 'undefined') return Dialog.channel.noopHost()

  const target = window.opener ?? window.parent
  if (!target || target === window) return Dialog.channel.noopHost()

  return Dialog.channel.hostPostMessage({ target })
}
