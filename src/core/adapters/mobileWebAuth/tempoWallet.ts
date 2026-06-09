import type * as Adapter from '../../Adapter.js'
import { mobileWebAuth } from './mobileWebAuth.js'

/** Creates the Tempo Wallet adapter using Wata mobile web auth. */
export function tempoWallet(options: tempoWallet.Options): Adapter.Adapter {
  return mobileWebAuth({
    ...options,
    host: 'https://wallet.tempo.xyz',
    name: 'Tempo Wallet',
    rdns: 'xyz.tempo',
  })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<mobileWebAuth.BaseOptions, 'host' | 'name' | 'rdns'>
}
