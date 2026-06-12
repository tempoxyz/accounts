import type * as Adapter from '../../Adapter.js'
import { deviceCode } from './deviceCode.js'

/** Creates the Tempo Wallet adapter using Wata device code. */
export function tempoWallet(options: tempoWallet.Options): Adapter.Adapter {
  return deviceCode({
    ...options,
    host: 'https://wallet.tempo.xyz',
    name: 'Tempo Wallet',
    rdns: 'xyz.tempo',
  })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<deviceCode.BaseOptions, 'host' | 'name' | 'rdns'>
}
