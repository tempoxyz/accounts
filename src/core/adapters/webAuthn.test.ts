import { P256, PublicKey } from 'ox'
import { vi } from 'vitest'
import { afterEach, describe, expect, test } from 'vp/test'

const webauthn_mock = vi.hoisted(() => ({
  create: vi.fn(),
  sign: vi.fn(),
}))

vi.mock('webauthx/client', () => ({
  Authentication: { sign: webauthn_mock.sign },
  Registration: { create: webauthn_mock.create },
}))

import { chain } from '../../../test/config.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import { webAuthn } from './webAuthn.js'

describe('webAuthn', () => {
  afterEach(() => {
    webauthn_mock.create.mockReset()
    webauthn_mock.sign.mockReset()
  })

  function setup(ceremony: WebAuthnCeremony.WebAuthnCeremony) {
    return webAuthn({ ceremony })({
      getAccount() {
        throw new Error('Unexpected getAccount call.')
      },
      getClient() {
        return { chain } as never
      },
      storage: Storage.memory({ key: crypto.randomUUID() }),
      store: {} as never,
    })
  }

  function publicKey() {
    return PublicKey.toHex(P256.getPublicKey({ privateKey: P256.randomPrivateKey() }))
  }

  test('behavior: does not hydrate account without credential', async () => {
    const storage = Storage.memory({ key: 'webauthn-invalid-account' })
    storage.setItem('store', {
      state: {
        accounts: [
          {
            address: '0x0000000000000000000000000000000000000001',
            keyType: 'webAuthn',
          },
        ],
        activeAccount: 0,
        chainId: chain.id,
      },
      version: 0,
    })
    const provider = Provider.create({ adapter: webAuthn(), chains: [chain], storage })

    await Store.waitForHydration(provider.store)

    await expect(provider.request({ method: 'eth_accounts' })).resolves.toMatchInlineSnapshot(`[]`)
  })

  test('behavior: createAccount returns ceremony extensions', async () => {
    const publicKey_ = publicKey()
    webauthn_mock.create.mockResolvedValue({ id: 'cred-1' })
    const instance = setup(
      WebAuthnCeremony.from({
        async getRegistrationOptions() {
          return { options: { publicKey: { rp: { id: 'localhost' } } } as never }
        },
        async verifyRegistration() {
          return {
            credentialId: 'cred-1',
            extensions: { hostContext: { id: 'context-1' } },
            publicKey: publicKey_,
          }
        },
        async getAuthenticationOptions() {
          return { options: {} as never }
        },
        async verifyAuthentication() {
          throw new Error('Unexpected verifyAuthentication call.')
        },
      }),
    )

    const result = await instance.actions.createAccount(
      { name: 'Test' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(result.extensions).toMatchInlineSnapshot(`
      {
        "hostContext": {
          "id": "context-1",
        },
      }
    `)
  })

  test('behavior: loadAccounts returns ceremony extensions', async () => {
    const publicKey_ = publicKey()
    webauthn_mock.sign.mockResolvedValue({ id: 'cred-1' })
    const instance = setup(
      WebAuthnCeremony.from({
        async getRegistrationOptions() {
          return { options: {} as never }
        },
        async verifyRegistration() {
          throw new Error('Unexpected verifyRegistration call.')
        },
        async getAuthenticationOptions() {
          return { options: { publicKey: { rpId: 'localhost' } } as never }
        },
        async verifyAuthentication() {
          return {
            credentialId: 'cred-1',
            extensions: { hostContext: { id: 'context-1' } },
            publicKey: publicKey_,
          }
        },
      }),
    )

    const result = await instance.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: undefined,
    })

    expect(result.extensions).toMatchInlineSnapshot(`
      {
        "hostContext": {
          "id": "context-1",
        },
      }
    `)
  })
})
