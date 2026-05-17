import type { Hex } from 'viem'
import { hashMessage, verifyMessage } from 'viem'
import { tempoLocalnet } from 'viem/chains'
import { describe, expect, test } from 'vp/test'

import {
  accounts as core_accounts,
  getClient,
  privateKeys,
  webAuthnAccounts,
} from '../../../test/config.js'
import * as Account from '../Account.js'
import type * as Adapter from '../Adapter.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { local } from './local.js'

describe('local', () => {
  describe('loadAccounts', () => {
    test('default: loads accounts', async () => {
      const { adapter } = setup()

      const { accounts } = await adapter.actions.loadAccounts(undefined, {
        method: 'wallet_connect',
        params: undefined,
      })

      expect(accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0x1ecBa262e4510F333FB5051743e2a53a765deBD0",
        ]
      `)
    })

    test('default: authorizeAccessKey folds the key authorization digest into the ceremony', async () => {
      const captured: { digest: Hex | undefined }[] = []
      const { adapter } = setup({
        loadAccounts: makeLoadAccounts(0, captured),
      })

      const result = await adapter.actions.loadAccounts(
        {
          authorizeAccessKey: {
            address: core_accounts[1]!.address,
            expiry: 0,
            keyType: 'secp256k1',
          },
        },
        { method: 'wallet_connect', params: undefined },
      )

      expect({
        digest: captured[0]?.digest,
        hasSignature: typeof result.signature === 'string',
        keyAuthorizationSignature: result.keyAuthorization?.signature,
      }).toMatchInlineSnapshot(`
        {
          "digest": "0x64d5413088ae92221fde7900d29b540efc040ac134ccf50d3e916a9011f81bd0",
          "hasSignature": true,
          "keyAuthorizationSignature": {
            "r": "0x876bd6f1719bdffc65382322939303ef37a804df5011b73704e7f4d9e4603cc8",
            "s": "0x6c377e36d7a76b2dd15fdc9599ed663136a8e0faa33c3950e72c3b503bc18bab",
            "type": "secp256k1",
            "yParity": "0x1",
          },
        }
      `)
    })
  })

  describe('loadAccounts: personalSign', () => {
    test('default: signs hashMessage(message) and echoes the message back', async () => {
      const captured: { digest: Hex | undefined }[] = []
      const { adapter } = setup({
        loadAccounts: makeLoadAccounts(0, captured),
      })

      const result = await adapter.actions.loadAccounts(
        { personalSign: { message: 'hello' } },
        { method: 'wallet_connect', params: undefined },
      )

      expect(captured).toHaveLength(1)
      expect(captured[0]!.digest).toBe(hashMessage('hello'))
      expect(result.personalSign).toEqual({ message: 'hello' })

      // The signature is a real EIP-191 signature over 'hello' from
      // accounts[0], verifiable end-to-end with viem's verifyMessage.
      expect(
        await verifyMessage({
          address: core_accounts[0]!.address,
          message: 'hello',
          signature: result.signature!,
        }),
      ).toBe(true)
    })

    test('default: empty message still produces a verifiable signature', async () => {
      const captured: { digest: Hex | undefined }[] = []
      const { adapter } = setup({
        loadAccounts: makeLoadAccounts(0, captured),
      })

      const result = await adapter.actions.loadAccounts(
        { personalSign: { message: '' } },
        { method: 'wallet_connect', params: undefined },
      )

      expect(captured[0]!.digest).toBe(hashMessage(''))
      expect(result.personalSign).toEqual({ message: '' })
      expect(
        await verifyMessage({
          address: core_accounts[0]!.address,
          message: '',
          signature: result.signature!,
        }),
      ).toBe(true)
    })

    test('default: personalSign + authorizeAccessKey produces two distinct signatures', async () => {
      const captured: { digest: Hex | undefined }[] = []
      const { adapter } = setup({
        loadAccounts: makeLoadAccounts(0, captured),
      })

      const result = await adapter.actions.loadAccounts(
        {
          personalSign: { message: 'hello' },
          authorizeAccessKey: { expiry: 0 },
        },
        { method: 'wallet_connect', params: undefined },
      )

      // loadAccounts saw the personalSign digest, NOT the keyAuth digest.
      expect(captured[0]!.digest).toBe(hashMessage('hello'))

      // The personalSign signature is a real EIP-191 signature over 'hello'.
      expect(
        await verifyMessage({
          address: core_accounts[0]!.address,
          message: 'hello',
          signature: result.signature!,
        }),
      ).toBe(true)

      // The key-auth signature was produced by a *separate* ceremony — it
      // signs the key-auth digest, not the personalSign digest, so the two
      // signatures must differ.
      expect(result.keyAuthorization?.signature).toBeDefined()
      expect(result.keyAuthorization?.signature).not.toBe(result.signature)
    })

    test('error: rejects when personalSign and digest are both set', async () => {
      const { adapter } = setup()

      await expect(
        adapter.actions.loadAccounts(
          {
            digest: '0x1234',
            personalSign: { message: 'hello' },
          },
          { method: 'wallet_connect', params: undefined },
        ),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[ProviderRpcError: \`digest\` and \`personalSign\` cannot both be set on \`wallet_connect\`.]`,
      )
    })
  })

  describe('createAccount', () => {
    test('default: creates account', async () => {
      const { adapter } = setup({
        createAccount: async () => ({
          accounts: [
            {
              address: core_accounts[1].address,
              keyType: 'secp256k1',
              privateKey: privateKeys[1],
            },
          ],
        }),
      })

      const { accounts } = await adapter.actions.createAccount(
        { name: 'test' },
        { method: 'wallet_connect', params: undefined },
      )

      expect(accounts.map((a) => a.address)).toMatchInlineSnapshot(`
        [
          "0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650",
        ]
      `)
    })

    test('default: personalSign folds into the createAccount ceremony', async () => {
      const captured: { digest: Hex | undefined }[] = []
      const { adapter } = setup({
        createAccount: async (params) => {
          captured.push({ digest: params.digest })
          return {
            accounts: [
              {
                address: core_accounts[1].address,
                keyType: 'secp256k1' as const,
                privateKey: privateKeys[1]!,
              },
            ],
          }
        },
      })

      const result = await adapter.actions.createAccount(
        { name: 'test', personalSign: { message: 'hello' } },
        { method: 'wallet_connect', params: undefined },
      )

      expect(captured[0]!.digest).toBe(hashMessage('hello'))
      expect(result.personalSign).toEqual({ message: 'hello' })
      expect(
        await verifyMessage({
          address: core_accounts[1]!.address,
          message: 'hello',
          signature: result.signature!,
        }),
      ).toBe(true)
    })

    test('error: createAccount rejects when personalSign and digest are both set', async () => {
      const { adapter } = setup({
        createAccount: async () => ({
          accounts: [
            {
              address: core_accounts[1].address,
              keyType: 'secp256k1' as const,
              privateKey: privateKeys[1]!,
            },
          ],
        }),
      })

      await expect(
        adapter.actions.createAccount(
          { name: 'test', digest: '0x1234', personalSign: { message: 'hello' } },
          { method: 'wallet_connect', params: undefined },
        ),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[ProviderRpcError: \`digest\` and \`personalSign\` cannot both be set on \`wallet_connect\`.]`,
      )
    })

    test('error: throws when createAccount not configured', async () => {
      const { adapter } = setup()

      await expect(
        adapter.actions.createAccount(
          { name: 'test' },
          { method: 'wallet_connect', params: undefined },
        ),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`createAccount\` not configured on adapter.]`,
      )
    })
  })
})

/**
 * Builds a `loadAccounts` callback backed by `privateKeys[index]` (secp256k1)
 * that records each `digest` it receives into `captured`. Returns the account
 * but no signature, so the local adapter signs the digest itself via
 * `account.sign({ hash })` — exercising the real signing path end-to-end.
 */
function makeLoadAccounts(
  index: number,
  captured: { digest: Hex | undefined }[],
): (params?: Adapter.loadAccounts.Parameters) => Promise<Adapter.loadAccounts.ReturnType> {
  return async (params) => {
    captured.push({ digest: params?.digest })
    return {
      accounts: [
        {
          address: core_accounts[index]!.address,
          keyType: 'secp256k1' as const,
          privateKey: privateKeys[index]!,
        },
      ],
    }
  }
}

function setup(overrides: Partial<local.Options> = {}) {
  const storage = Storage.memory()
  const store = Store.create({ chainId: tempoLocalnet.id, storage })
  const adapter = local({
    loadAccounts: async () => ({
      accounts: [
        {
          address: webAuthnAccounts[0]!.address,
          keyType: 'webAuthn_headless' as const,
          privateKey: privateKeys[0]!,
          rpId: 'example.com',
          origin: 'https://example.com',
        },
      ],
    }),
    ...overrides,
  })({
    getAccount: (options) => Account.find({ ...options, signable: true, store }),
    getClient: () => getClient({ chain: tempoLocalnet }) as never,
    storage,
    store,
  })
  return { adapter, store }
}
