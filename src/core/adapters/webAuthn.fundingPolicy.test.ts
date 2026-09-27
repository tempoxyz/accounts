import { Bytes, Cbor, Hex, P256, PublicKey, Signature } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { custom } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'

import { accounts, privateKeys, webAuthnAccounts } from '../../../test/config.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import type * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import { webAuthn } from './webAuthn.js'

const rules = { maxSlippageBps: 100, sources: {} }
const root = webAuthnAccounts[1]
const publicKey = PublicKey.toHex(P256.getPublicKey({ privateKey: privateKeys[1] }))

afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const get = vi.fn(async (options: CredentialRequestOptions) => {
    const challenge = Hex.fromBytes(new Uint8Array(options.publicKey!.challenge as ArrayBuffer))
    const envelope = SignatureEnvelope.from(await root.sign({ hash: challenge }))
    if (envelope.type !== 'webAuthn') throw new Error('Expected WebAuthn signature')
    return {
      id: 'selected',
      type: 'public-key',
      rawId: new ArrayBuffer(1),
      response: {
        authenticatorData: Bytes.fromHex(envelope.metadata.authenticatorData).buffer,
        clientDataJSON: Bytes.fromString(envelope.metadata.clientDataJSON).buffer,
        signature: Signature.toDerBytes(envelope.signature).buffer,
      },
    }
  })
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(Bytes.fromHex(publicKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  )
  const spki = await crypto.subtle.exportKey('spki', key)
  const registration = vi.fn(async () => ({
    id: 'selected',
    type: 'public-key',
    rawId: new ArrayBuffer(1),
    response: {
      attestationObject: Cbor.encode({ authData: new Uint8Array(37) }, { as: 'Bytes' }).buffer,
      clientDataJSON: Bytes.fromString('{}').buffer,
      getPublicKey: () => spki,
    },
  }))
  const authenticate = vi.fn<WebAuthnCeremony.WebAuthnCeremony['getAuthenticationOptions']>(
    async (parameters) => {
      const challenge = parameters?.challenge ?? Hex.random(32)
      return { options: { publicKey: { rpId: 'example.com', challenge } } }
    },
  )
  const ceremony: WebAuthnCeremony.WebAuthnCeremony = {
    getAuthenticationOptions: authenticate,
    verifyAuthentication: async () => ({ credentialId: 'selected', publicKey }),
    getRegistrationOptions: async () => ({
      options: {
        publicKey: {
          rp: { id: 'example.com', name: 'Example' },
          user: { id: '0x01', name: 'new', displayName: 'new' },
          challenge: '0x01',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
      },
    }),
    verifyRegistration: async () => ({ credentialId: 'selected', publicKey }),
  }
  const storage = Storage.memory()
  storage.setItem('lastCredentialId', 'cached')
  const provider = Provider.create({
    adapter: webAuthn({ ceremony }),
    chains: [tempoModerato],
    transports: {
      [tempoModerato.id]: custom(
        {
          async request({ method, params }) {
            expect(method).toMatchInlineSnapshot(`"eth_fillKeyAuthorization"`)
            const [request] = params as [
              { account: Hex.Hex; keyAuthorization: KeyAuthorization.UnsignedRpc },
            ]
            expect(request.account).toBe(root.address)
            return { keyAuthorization: { ...request.keyAuthorization, fundingPolicy: '0x7' } }
          },
        },
        { retryCount: 0 },
      ),
    },
    storage,
  })
  provider.store.setState({
    accounts: [
      {
        address: webAuthnAccounts[0].address,
        keyType: 'webAuthn',
        credential: {
          id: 'cached',
          publicKey: PublicKey.toHex(P256.getPublicKey({ privateKey: privateKeys[0] })),
          rpId: 'example.com',
        },
      },
    ],
    activeAccount: 0,
  })
  vi.stubGlobal('window', {
    navigator: { credentials: { get, create: registration } },
    location: { hostname: 'example.com', origin: 'https://example.com' },
  })
  return { provider, get, registration, authenticate }
}

describe('WebAuthn funding authorization', () => {
  for (const method of ['login', 'register'] as const)
    for (const admins of [undefined, [accounts[2].address]] as const)
      test(`${method} with ${admins ? 'explicit' : 'default'} admins`, async () => {
        const { provider, get, registration, authenticate } = await setup()
        const result = await provider.request({
          method: 'wallet_connect',
          params: [
            {
              capabilities: {
                method,
                ...(method === 'register' ? { name: 'new' } : { selectAccount: true }),
                personalSign: { message: 'Sign in' },
                authorizeAccessKey: {
                  address: accounts[3].address,
                  keyType: 'p256',
                  expiry: 123,
                  fundingPolicy: { ...(admins ? { admins } : {}), rules },
                },
              },
            },
          ],
        })
        const capabilities = result.accounts[0]!.capabilities
        const authorization = KeyAuthorization.fromRpc(capabilities.keyAuthorization!)
        expect(authorization.fundingPolicy).toEqual({ admins: admins ?? [root.address], rules })
        expect(
          SignatureEnvelope.verify(authorization.signature, {
            address: root.address,
            payload: KeyAuthorization.getSignPayload(authorization),
          }),
        ).toMatchInlineSnapshot(`true`)
        expect(authenticate.mock.calls.length).toBe(method === 'login' ? 1 : 0)
        expect(registration.mock.calls.length).toBe(method === 'register' ? 1 : 0)
        expect(get.mock.calls.length).toBe(admins ? 1 : 2)
        if (method === 'login') {
          expect(authenticate.mock.calls[0]?.[0]?.credentialId).toBeUndefined()
          expect(
            authenticate.mock.calls[0]?.[0]?.challenge ===
              KeyAuthorization.getSignPayload(authorization),
          ).toBe(!!admins)
        }
        if (admins) {
          expect(authorization.witness).toBeDefined()
          expect(capabilities.personalSign!.keyAuthorization).toBe(
            KeyAuthorization.serialize(authorization),
          )
        }
      })

  test('cached credential login still resolves the authenticated root before defaulting admins', async () => {
    const { provider, authenticate, get } = await setup()
    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: {
              address: accounts[3].address,
              expiry: 123,
              fundingPolicy: { rules },
            },
          },
        },
      ],
    })
    expect(authenticate.mock.calls[0]?.[0]?.credentialId).toMatchInlineSnapshot(`"cached"`)
    expect(authenticate.mock.calls[0]?.[0]?.challenge).toBeUndefined()
    expect(get.mock.calls.length).toMatchInlineSnapshot(`2`)
    expect(result.accounts[0]!.capabilities.keyAuthorization!.fundingPolicy).toEqual({
      admins: [root.address],
      rules,
    })
  })
})

for (const method of ['login', 'register'] as const)
  test(`${method} resolves the default policy after discovering the root`, async () => {
    const { provider, get, authenticate } = await setup()
    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            method,
            ...(method === 'register' ? { name: 'new' } : { selectAccount: true }),
            authorizeAccessKey: {
              address: accounts[3].address,
              keyType: 'p256',
              expiry: 123,
              fundingPolicy: true,
            },
          },
        },
      ],
    })
    const authorization = KeyAuthorization.fromRpc(
      result.accounts[0]!.capabilities.keyAuthorization!,
    )
    expect(authorization.fundingPolicy).toMatchInlineSnapshot(`7n`)
    expect(
      SignatureEnvelope.verify(authorization.signature, {
        address: root.address,
        payload: KeyAuthorization.getSignPayload(authorization),
      }),
    ).toMatchInlineSnapshot(`true`)
    expect(authenticate.mock.calls[0]?.[0]?.challenge).toBeUndefined()
    expect(get.mock.calls.length).toBe(method === 'login' ? 2 : 1)
  })
