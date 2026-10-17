import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Authenticator from '../../../test/authenticator.js'
import { chain } from '../../../test/config.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import { webAuthn } from './webAuthn.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webAuthn', () => {
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
})

describe('background registration', () => {
  const origin = 'http://localhost'

  /**
   * Provider with a local ceremony that verifies registrations in the
   * background, settled by the test through `verifications`.
   */
  function setup() {
    const authenticator = Authenticator.create({ origin, rpId: 'localhost' })
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        location: { hostname: 'localhost', origin },
        navigator: { credentials: authenticator.credentials },
      }),
    )
    const storage = Storage.memory()
    const local = WebAuthnCeremony.local({ rpId: 'localhost', storage })
    const verifications: { reject: (error: Error) => void; resolve: () => void }[] = []
    const ceremony = WebAuthnCeremony.from({
      ...local,
      async verifyRegistration(credential, options) {
        const result = await local.verifyRegistration(credential, options)
        const verified = new Promise<void>((resolve, reject) =>
          verifications.push({ reject, resolve }),
        )
        return { ...result, verified }
      },
    })
    const provider = Provider.create({
      adapter: webAuthn({ ceremony }),
      chains: [chain],
      storage,
    })
    return { provider, storage, verifications }
  }

  async function register(provider: ReturnType<typeof setup>['provider']) {
    const { accounts } = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'alice' } }],
    })
    const [stored] = provider.store.getState().accounts
    const id = stored && 'credential' in stored ? stored.credential?.id : undefined
    if (!id) throw new Error('No credential stored.')
    return { address: accounts[0]!.address, key: `registration:${id}` }
  }

  test('behavior: keeps the public key in storage until the server stores the credential', async () => {
    const { provider, storage, verifications } = setup()

    const account = await register(provider)

    // Connected while the server verification is still pending.
    expect(verifications).toHaveLength(1)
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])
    const keys = async () => Object.keys((await storage.getItem<object>(account.key)) ?? {}).sort()
    await vi.waitFor(async () => expect(await keys()).toEqual(['name', 'publicKey']))

    verifications[0]!.resolve()
    await vi.waitFor(async () => expect(await keys()).toEqual([]))
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address])
  })

  test('behavior: removes the account when the server rejects the registration', async () => {
    const { provider, storage, verifications } = setup()

    const account = await register(provider)
    verifications[0]!.reject(new Error('Missing or expired challenge'))

    await vi.waitFor(async () =>
      expect(await provider.request({ method: 'eth_accounts' })).toEqual([]),
    )
    // Its public key stays on the device.
    expect(Object.keys((await storage.getItem<object>(account.key)) ?? {}).sort())
      .toMatchInlineSnapshot(`
        [
          "name",
          "publicKey",
        ]
      `)
  })
})
