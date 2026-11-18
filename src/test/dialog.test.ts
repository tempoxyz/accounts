/**
 * Runs the `dialog` stand-in of `accounts/test` without a server: the session that its sign-in
 * commits, and the access key that the plugin's account authorizes.
 * @module
 */
import { Address, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Permissions from '../Permissions.js'
import * as Plugin from '../Plugin.js'
import * as Store from '../Store.js'
import { dialog } from './dialog.js'

describe('dialog', () => {
  test('commits a session whose access key the account authorized, runs afterSignIn, and keeps the account at the next sign-in', async () => {
    const privateKey =
      '0x5c6d5b2a9d3e4f1a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c'
    const address = Address.checksum(
      Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    )
    const signedIn: string[] = []
    const accounts = Accounts.create({
      chain: 'testnet',
      clientId: 'https://app.example',
      plugins: [
        dialog({ privateKey }),
        Plugin.from({
          hooks: {
            afterSignIn: (_context, session) => {
              signedIn.push(session.user.id)
            },
          },
          id: 'record',
        }),
      ],
      store: Store.memory(),
    })

    const session = await accounts.dialog.signIn({
      accessKey: { expiry: '1h', limits: [{ limit: '10', token: 'alphausd' }] },
    })
    const again = await accounts.dialog.signIn({ accessKey: false })

    const authorization = KeyAuthorization.fromRpc(
      session.accessKey!.keyAuthorization,
    )
    const signer = Secp256k1.recoverAddress({
      payload: KeyAuthorization.getSignPayload(authorization),
      signature: (
        authorization.signature as {
          signature: Secp256k1.recoverAddress.Options['signature']
        }
      ).signature,
    })
    expect(Address.checksum(signer)).toBe(address)
    expect(session.accessKey!.account).toBe(address)
    expect(session.account!.address).toBe(address)
    expect(session.user).toEqual({
      email: 'test@example.com',
      id: `test:${address}`,
    })
    expect(Permissions.fromAccessKey(session.accessKey!).limits)
      .toMatchInlineSnapshot(`
      [
        {
          "limit": 10000000n,
          "period": undefined,
          "token": "0x20C0000000000000000000000000000000000001",
        },
      ]
    `)
    expect(authorization.expiry! - Date.now() / 1000).toBeGreaterThan(3590)
    expect(authorization.expiry! - Date.now() / 1000).toBeLessThanOrEqual(3600)
    expect(again.accessKey).toBeUndefined()
    expect(again.account!.address).toBe(address)
    expect(accounts.session.status.get().session).toBe(again)
    expect(signedIn).toEqual([`test:${address}`, `test:${address}`])
  })

  test('throws the refusal of permissions that Tempo ID refuses, and commits no session', async () => {
    const accounts = Accounts.create({
      clientId: 'https://app.example',
      plugins: [dialog()],
      store: Store.memory(),
    })

    const error = await accounts.dialog
      .signIn({ accessKey: { expiry: 60, scopes: 'any' } })
      .catch((error: unknown) => error)

    expect((error as Accounts.RequestError).reason).toBe('expiry_passed')
    expect(await accounts.session.get()).toBeUndefined()
  })
})
