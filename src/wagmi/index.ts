import * as wagmi_tempo from 'wagmi/tempo'

/**
 * Compatibility namespace for the deprecated `accounts/wagmi` entrypoint.
 *
 * @deprecated Import from `wagmi/tempo` instead.
 */
export const Connector = {
  ...wagmi_tempo,
  dialog: wagmi_tempo.tempoWallet,
} as const

/**
 * Compatibility alias for `wagmi/tempo`'s `tempoWallet` connector.
 *
 * @deprecated Import `tempoWallet` from `wagmi/tempo` instead.
 */
export { tempoWallet as dialog, type TempoWalletParameters as DialogOptions } from 'wagmi/tempo'

/**
 * Compatibility alias for `wagmi/tempo`'s `tempoWallet` connector.
 *
 * @deprecated Import `tempoWallet` from `wagmi/tempo` instead.
 */
export { tempoWallet, type TempoWalletParameters } from 'wagmi/tempo'

/**
 * Compatibility alias for `wagmi/tempo`'s `webAuthn` connector.
 *
 * @deprecated Import `webAuthn` from `wagmi/tempo` instead.
 */
export { webAuthn, type WebAuthnParameters } from 'wagmi/tempo'

/**
 * Compatibility alias for `wagmi/tempo`'s `dangerous_secp256k1` connector.
 *
 * @deprecated Import `dangerous_secp256k1` from `wagmi/tempo` instead.
 */
export { dangerous_secp256k1, type Dangerous_Secp256k1Parameters } from 'wagmi/tempo'
