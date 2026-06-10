import type * as Adapter from '../../Adapter.js'
import { postMessage } from './postMessage.js'

/** Creates the Tempo Wallet adapter using Wata postMessage. */
export function tempoWallet(options: tempoWallet.Options = {}): Adapter.Adapter {
  return postMessage({
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
