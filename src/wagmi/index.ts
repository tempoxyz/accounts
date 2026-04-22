import {
  dangerous_secp256k1 as wagmi_dangerous_secp256k1,
  tempoWallet as wagmi_tempoWallet,
  webAuthn as wagmi_webAuthn,
} from 'wagmi/tempo'
import type {
  Dangerous_Secp256k1Parameters,
  TempoWalletParameters,
  WebAuthnParameters,
} from 'wagmi/tempo'
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
export function dialog(parameters: dialog.Options = {}) {
  return wagmi_tempoWallet(parameters)
}

export declare namespace dialog {
  /**
   * Compatibility alias for `TempoWalletParameters`.
   *
   * @deprecated Import `TempoWalletParameters` from `wagmi/tempo` instead.
   */
  type Options = TempoWalletParameters
}

/**
 * Compatibility alias for `wagmi/tempo`'s `tempoWallet` connector.
 *
 * @deprecated Import `tempoWallet` from `wagmi/tempo` instead.
 */
export function tempoWallet(parameters: tempoWallet.Options = {}) {
  return wagmi_tempoWallet(parameters)
}

export declare namespace tempoWallet {
  /**
   * Compatibility alias for `TempoWalletParameters`.
   *
   * @deprecated Import `TempoWalletParameters` from `wagmi/tempo` instead.
   */
  type Options = TempoWalletParameters
}

/**
 * Compatibility alias for `wagmi/tempo`'s `webAuthn` connector.
 *
 * @deprecated Import `webAuthn` from `wagmi/tempo` instead.
 */
export function webAuthn(parameters: webAuthn.Options = {}) {
  return wagmi_webAuthn(parameters)
}

export declare namespace webAuthn {
  /**
   * Compatibility alias for `WebAuthnParameters`.
   *
   * @deprecated Import `WebAuthnParameters` from `wagmi/tempo` instead.
   */
  type Options = WebAuthnParameters
}

/**
 * Compatibility alias for `wagmi/tempo`'s `dangerous_secp256k1` connector.
 *
 * @deprecated Import `dangerous_secp256k1` from `wagmi/tempo` instead.
 */
export function dangerous_secp256k1(parameters: dangerous_secp256k1.Options = {}) {
  return wagmi_dangerous_secp256k1(parameters)
}

export declare namespace dangerous_secp256k1 {
  /**
   * Compatibility alias for `Dangerous_Secp256k1Parameters`.
   *
   * @deprecated Import `Dangerous_Secp256k1Parameters` from `wagmi/tempo` instead.
   */
  type Options = Dangerous_Secp256k1Parameters
}
