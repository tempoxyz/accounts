import type * as Adapter from '../../Adapter.js'
import type * as Dialog from '../../Dialog.js'
import { postMessage } from './postMessage.js'

const icon =
  'data:image/svg+xml,<svg width="269" height="269" viewBox="0 0 269 269" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="269" height="269" fill="black"/><path d="M123.273 190.794H93.445L121.09 105.318H85.7334L93.445 80.2642H191.95L184.238 105.318H150.773L123.273 190.794Z" fill="white"/></svg>'

/** Creates the Tempo Wallet adapter using Wata postMessage. */
export function tempoWallet(options: tempoWallet.Options = {}): Adapter.Adapter {
  const { handoff, theme, ...rest } = options
  // Theme is a wallet-presentation concern, so it rides the page URL as the
  // wallet's `accent`/`radius`/`scheme` params — the generic `postMessage`
  // adapter stays theme-agnostic.
  const host = new URL('https://wallet.tempo.xyz/post-message')
  if (theme?.accent) host.searchParams.set('accent', theme.accent)
  if (theme?.radius) host.searchParams.set('radius', theme.radius)
  if (theme?.scheme) host.searchParams.set('scheme', theme.scheme)
  // Where a phone that approves a request lands also rides the page URL; the wallet only honors
  // a landing page on the origin it pinned for this app.
  if (handoff === false) host.searchParams.set('handoff', 'off')
  else if (handoff?.url)
    host.searchParams.set(
      'handoff_url',
      typeof window === 'undefined'
        ? handoff.url
        : new URL(handoff.url, window.location.href).toString(),
    )
  return postMessage({
    icon,
    ...rest,
    host: host.toString(),
    name: 'Tempo Wallet',
    rdns: 'xyz.tempo',
  })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<postMessage.Options, 'host' | 'name' | 'rdns'> & {
    /**
     * Continue requests on a phone. When this computer's browser has no passkey for the account,
     * the wallet shows a QR code; the phone that scans it approves the same request with its
     * passkey, and this tab receives the result either way (an access key, a signature).
     * `url` picks where the person lands afterwards: a page on this app's origin that the
     * phone's browser opens, with `#tempo_wallet=approved&account=0x…` (or `rejected`) in the
     * fragment. Without it, the phone shows the result and the person returns to this tab.
     * `false` hides the QR code.
     * @default {}
     */
    handoff?:
      | false
      | {
          /** Page on this app's origin (absolute or relative) that the phone opens after it answers. */
          url?: string | undefined
        }
      | undefined
    /** Visual theme overrides for the wallet page (accent, radius, scheme). */
    theme?: Dialog.Theme | undefined
  }
}
