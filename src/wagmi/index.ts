import * as wagmi_tempo from '@wagmi/core/tempo'

/**
 * Compatibility object for legacy `accounts/wagmi` `Connector.*` access.
 *
 * @deprecated Import named exports from `wagmi/tempo` or `@wagmi/core/tempo` instead. If you only need `tempoWallet`, you can also import it from `wagmi/connectors`.
 */
export const Connector = {
  ...wagmi_tempo,
  dialog: wagmi_tempo.tempoWallet,
} as const

export {
  /**
   * Compatibility alias for the Tempo Wallet connector.
   *
   * @deprecated Import `tempoWallet` from `wagmi/connectors`, `wagmi/tempo`, or `@wagmi/core/tempo` instead.
   */
  tempoWallet as dialog,
  /**
   * Compatibility alias for the Tempo `dangerous_secp256k1` connector.
   *
   * @deprecated Import `dangerous_secp256k1` from `wagmi/tempo` or `@wagmi/core/tempo` instead.
   */
  dangerous_secp256k1,
  /**
   * Compatibility alias for the Tempo Wallet connector.
   *
   * @deprecated Import `tempoWallet` from `wagmi/connectors`, `wagmi/tempo`, or `@wagmi/core/tempo` instead.
   */
  tempoWallet,
  /**
   * Compatibility alias for the Tempo `webAuthn` connector.
   *
   * @deprecated Import `webAuthn` from `wagmi/tempo` or `@wagmi/core/tempo` instead.
   */
  webAuthn,
} from '@wagmi/core/tempo'
