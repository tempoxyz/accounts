import type * as Adapter from '../core/Adapter.js'
import { mobileWebAuth } from './adapter.js'

/** Creates the Tempo Wallet adapter using Wata mobile web auth. */
export function tempoWallet(options: tempoWallet.Options): Adapter.Adapter {
  return mobileWebAuth({
    ...options,
    baseUrl: 'https://wallet.tempo.xyz',
    host: 'https://wallet.tempo.xyz',
    name: 'Tempo Wallet',
    rdns: 'xyz.tempo',
  })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<mobileWebAuth.BaseOptions, 'baseUrl' | 'host' | 'name' | 'rdns'> &
    mobileWebAuth.OpenOptions
}
