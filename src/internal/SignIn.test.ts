/**
 * Tests \`SignIn.accessKey\`, which resolves a sign-in's access key, and \`SignIn.toSession\`, which
 * turns a sign-in's result into the session that the instance commits.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Plugin from '../Plugin.js'
import * as SignIn from './SignIn.js'

describe('accessKey', () => {
  const context = (options: Accounts.create.Options) => {
    let captured: Plugin.Context | undefined
    Accounts.create({
      ...options,
      clientId: 'client_acme',
      plugins: [
        Plugin.from({
          actions: (context) => {
            captured = context
            return {}
          },
          id: 'probe',
        }),
      ],
      store: false,
    })
    return captured!
  }

  const defaultKey = {
    expiry: '1d',
    limits: [{ limit: '5', token: 'ousd' }],
  }

  test.each([
    [
      'the default instance, for a call without an access key',
      {},
      undefined,
      {},
      defaultKey,
    ],
    ['the default instance, for `accessKey: false`', {}, false, {}, undefined],
    [
      "a `wallet` instance, for a call's own `provision: 'accessKey'`",
      { provision: 'wallet' },
      undefined,
      { provision: 'accessKey' },
      defaultKey,
    ],
    [
      "a `wallet` instance, for `accessKey: false` beside a call's own `provision: 'accessKey'`",
      { provision: 'wallet' },
      false,
      { provision: 'accessKey' },
      undefined,
    ],
    [
      'a `user` instance, for a call without an access key',
      { provision: 'user' },
      undefined,
      {},
      undefined,
    ],
  ] as const)(
    'resolves the access key of %s',
    (_, instance, value, options, expected) => {
      const accessKey = SignIn.accessKey(
        context(instance as Accounts.create.Options),
        value,
        options as SignIn.accessKey.Options,
      )

      expect(accessKey).toEqual(expected)
    },
  )
})

describe('toSession', () => {
  test('keeps when the instance received the tokens, so a refresh that overlaps the sign-in returns its tokens', () => {
    const result = {
      accessToken: 'access-token',
      expiresAt: 3_000,
      receivedAt: 2_000,
      refreshToken: 'refresh-token',
      user: { email: 'tempo-id-test+signin@example.org', id: 'user_1' },
    }

    const session = SignIn.toSession(result)

    expect(session.receivedAt).toMatchInlineSnapshot(`2000`)
  })
})
