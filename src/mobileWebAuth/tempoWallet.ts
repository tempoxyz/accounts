import type * as Adapter from '../core/Adapter.js'
import { mobileWebAuth } from './adapter.js'

/** Creates the Tempo Wallet adapter using Wata mobile web auth. */
export function tempoWallet(options: tempoWallet.Options): Adapter.Adapter {
  const {
    baseUrl = 'https://wallet.tempo.xyz',
    host = 'https://wallet.tempo.xyz',
    name = 'Tempo Wallet',
    rdns = 'xyz.tempo',
    ...rest
  } = options
  return mobileWebAuth({ ...rest, baseUrl, host, name, rdns })
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<mobileWebAuth.BaseOptions, 'baseUrl' | 'host' | 'name' | 'rdns'> &
    mobileWebAuth.OpenOptions & {
      /** Consumer discovery origin. @default "https://wallet.tempo.xyz" */
      baseUrl?: mobileWebAuth.Options['baseUrl'] | undefined
      /** Tempo Wallet discovery origin or preloaded Wata host document. @default "https://wallet.tempo.xyz" */
      host?: mobileWebAuth.Options['host'] | undefined
      /** Provider display name. @default "Tempo Wallet" */
      name?: mobileWebAuth.Options['name'] | undefined
      /** Reverse-DNS provider identifier. @default "xyz.tempo" */
      rdns?: mobileWebAuth.Options['rdns'] | undefined
    }
}
