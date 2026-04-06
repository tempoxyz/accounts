import { dangerous_secp256k1 } from '../src/core/adapters/dangerous_secp256k1.js'
import { local as core_local } from '../src/core/adapters/local.js'
import { webAuthn as core_webAuthn } from '../src/core/adapters/webAuthn.js'
import type * as Store from '../src/core/Store.js'
import * as WebAuthnCeremony from '../src/core/WebAuthnCeremony.js'
import { privateKeys, webAuthnAccounts } from './config.js'
import { url as webauthnUrl } from './webauthn.constants.js'

/** Creates a `Store.Account` from a test account index. */
function toStoreAccount(index: number): Store.Account {
  return {
    address: webAuthnAccounts[index]!.address,
    keyType: 'webAuthn_headless',
    privateKey: privateKeys[index]!,
    rpId: 'example.com',
    origin: 'https://example.com',
  }
}

/** Creates a local adapter pre-configured with deterministic headless WebAuthn test accounts. */
export function headlessWebAuthn() {
  return core_local({
    loadAccounts: async () => ({ accounts: [toStoreAccount(0)] }),
    createAccount: async () => ({ accounts: [toStoreAccount(1)] }),
  })
}

/** Creates a `dangerous_secp256k1` adapter for testing. */
export function secp256k1() {
  return dangerous_secp256k1()
}

/** Creates a WebAuthn adapter backed by a server-side ceremony via {@link WebAuthnCeremony.server}. */
export function webAuthn() {
  const ceremony = WebAuthnCeremony.server({ url: webauthnUrl })
  return core_webAuthn({ ceremony })
}
