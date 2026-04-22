import * as wagmi_tempo from '@wagmi/core/tempo'

/**
 * Compatibility object for legacy `accounts/wagmi` `Connector.*` access.
 *
 * @deprecated Import named exports from `@wagmi/core/tempo` or `wagmi/tempo` instead. If you only need `tempoWallet`, you can also import it from `wagmi/connectors`.
 *
 * Migrate from `'accounts/wagmi'` to named imports from `'@wagmi/core/tempo'` or `'wagmi/tempo'`.
 *
 * @example
 * ```ts
 * import { tempoWallet } from '@wagmi/core/tempo'
 *
 * const connector = tempoWallet()
 * ```
 *
 * @example
 * ```ts
 * import { tempoWallet } from 'wagmi/connectors'
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
   * Compatibility alias for the Tempo Wallet connector.
   *
   * @deprecated Import `tempoWallet` from `@wagmi/core/tempo`, `wagmi/tempo`, or `wagmi/connectors` instead.
   */
  tempoWallet as dialog,
  /**
   * Compatibility alias for the Tempo `dangerous_secp256k1` connector.
   *
   * @deprecated Import `dangerous_secp256k1` from `@wagmi/core/tempo` or `wagmi/tempo` instead.
   */
  dangerous_secp256k1,
  /**
   * Compatibility alias for the Tempo Wallet connector.
   *
   * @deprecated Import `tempoWallet` from `@wagmi/core/tempo`, `wagmi/tempo`, or `wagmi/connectors` instead.
   */
  tempoWallet,
  /**
   * Compatibility alias for the Tempo `webAuthn` connector.
   *
   * @deprecated Import `webAuthn` from `@wagmi/core/tempo` or `wagmi/tempo` instead.
   */
  webAuthn,
} from '@wagmi/core/tempo'
