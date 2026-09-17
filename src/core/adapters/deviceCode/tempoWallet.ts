import type * as Adapter from '../../Adapter.js'
import { deviceCode } from './deviceCode.js'

/** Creates the Tempo Wallet adapter using the Wata device-code transport. */
export function tempoWallet(options: tempoWallet.Options): Adapter.Adapter {
  return deviceCode({
    ...options,
    name: 'Tempo Wallet',
    rdns: 'xyz.tempo',
    url: 'https://wallet.tempo.xyz/api/auth/device',
  })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<deviceCode.Options, 'name' | 'rdns' | 'url'>
}
