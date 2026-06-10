import type * as Adapter from '../../Adapter.js'
import { postMessage } from './postMessage.js'

const icon =
  'data:image/svg+xml,<svg width="269" height="269" viewBox="0 0 269 269" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="269" height="269" fill="black"/><path d="M123.273 190.794H93.445L121.09 105.318H85.7334L93.445 80.2642H191.95L184.238 105.318H150.773L123.273 190.794Z" fill="white"/></svg>'

/** Creates the Tempo Wallet adapter using Wata postMessage. */
export function tempoWallet(options: tempoWallet.Options = {}): Adapter.Adapter {
  return postMessage({
    icon,
    ...options,
    host: 'https://wallet.tempo.xyz/post-message',
    name: 'Tempo Wallet',
    rdns: 'xyz.tempo',
  })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<postMessage.Options, 'host' | 'name' | 'rdns'>
}
