import { cli as cli_adapter } from '../src/cli/adapter.js'
import { local as core_local } from '../src/core/adapters/local.js'
import { secp256k1 as core_secp256k1 } from '../src/core/adapters/secp256k1.js'
import { webAuthn as core_webAuthn } from '../src/core/adapters/webAuthn.js'
import type * as Provider from '../src/core/Provider.js'
import type * as Store from '../src/core/Store.js'
import * as WebAuthnCeremony from '../src/core/WebAuthnCeremony.js'
import { privateKeys, webAuthnAccounts } from './config.js'
import { createDeviceCodeHost, submitVerify } from './deviceCode.js'
import { createServer, type Server } from './utils.js'
import { url as webauthnUrl } from './webauthn.constants.js'

type ProviderOptions = Omit<Provider.create.Options, 'adapter'>

const host_cli = createDeviceCodeHost({ privateKey: privateKeys[19] })
let server_cli: Server | undefined

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
export function headlessWebAuthn(_options: ProviderOptions = {}) {
  return core_local({
    loadAccounts: async () => ({ accounts: [toStoreAccount(0)] }),
    createAccount: async () => ({ accounts: [toStoreAccount(1)] }),
  })
}

/** Creates a `secp256k1` adapter for testing. */
export function secp256k1(_options: ProviderOptions = {}) {
  return core_secp256k1()
}

/** Creates a WebAuthn adapter backed by a server-side ceremony via {@link WebAuthnCeremony.server}. */
export function webAuthn(_options: ProviderOptions = {}) {
  const ceremony = WebAuthnCeremony.server({ url: webauthnUrl })
  return core_webAuthn({ ceremony })
}

/** Creates a CLI adapter backed by the shared device-code test host. */
export function cli(options: ProviderOptions = {}) {
  if (!server_cli) throw new Error('CLI test adapter is not set up.')
  host_cli.setProviderOptions({ feePayer: options.feePayer, identity: options.identity })
  return cli_adapter({
    host: `${server_cli.url}/auth/device`,
    open: async (_url, prompt) => {
      await submitVerify(prompt)
    },
  })
}

export namespace cli {
  export async function setup() {
    server_cli = await createServer(host_cli.listener)
  }

  export async function teardown() {
    await server_cli?.closeAsync()
    server_cli = undefined
  }
}
