import * as wagmi_tempo from 'wagmi/tempo'

/**
 * Compatibility object for legacy `accounts/wagmi` `Connector.*` access.
 *
 * @deprecated Import from `wagmi/tempo` instead.
 *
 * Migrate from `'accounts/wagmi'` entrypoint to `'wagmi/tempo'` entrypoint with named imports.
 *
 * @example
 * ```ts
 * import { tempoWallet } from 'wagmi/tempo'
 *
 * const connector = tempoWallet()
 * ```
 */
export const Connector = {
  ...wagmi_tempo,
  dialog: wagmi_tempo.tempoWallet,
} as const

export {
  /**
   * Compatibility alias for `wagmi/tempo`'s `tempoWallet` connector.
   *
   * @deprecated Import `tempoWallet` from `wagmi/tempo` instead.
   */
  tempoWallet as dialog,
  /**
   * Compatibility alias for `wagmi/tempo`'s `dangerous_secp256k1` connector.
   *
   * @deprecated Import `dangerous_secp256k1` from `wagmi/tempo` instead.
   */
  dangerous_secp256k1,
  /**
   * Compatibility alias for `wagmi/tempo`'s `tempoWallet` connector.
   *
   * @deprecated Import `tempoWallet` from `wagmi/tempo` instead.
   */
  tempoWallet,
  /**
   * Compatibility alias for `wagmi/tempo`'s `webAuthn` connector.
   *
   * @deprecated Import `webAuthn` from `wagmi/tempo` instead.
   */
  webAuthn,
} from 'wagmi/tempo'
