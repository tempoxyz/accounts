/**
 * Tests \`SignIn.accessKey\` and \`SignIn.withAccount\`, which resolve what a sign-in returns beside
 * the user, and \`SignIn.toSession\`, which turns a sign-in's result into the session that the
 * instance commits.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Permissions from '../Permissions.js'
import * as Plugin from '../Plugin.js'
import * as SignIn from './SignIn.js'

/** Returns the plugin context of an instance with `options`. */
function context(options: Accounts.create.Options) {
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

const defaultAccessKey = {
  expiry: '1d',
  limits: [{ limit: '5', token: 'ousd' }],
}
const permissions = Permissions.from({
  expiry: '7d',
  limits: [{ limit: '1', token: 'ousd' }],
})

describe('accessKey', () => {
  test.each([
    [
      'the default instance, for a call without options',
      {},
      {},
      defaultAccessKey,
    ],
    [
      'the default instance, for `accessKey: false`',
      {},
      { accessKey: false },
      undefined,
    ],
    [
      'the default instance, for `account: false`',
      {},
      { account: false },
      undefined,
    ],
    [
      'an `account: false` instance, for a call without options',
      { account: false },
      {},
      undefined,
    ],
    [
      "an `account: false` instance, for a call's own access key",
      { account: false },
      { accessKey: permissions },
      permissions,
    ],
    [
      'an instance whose `accessKey` function returns none',
      { accessKey: () => undefined },
      {},
      undefined,
    ],
  ] as const)(
    'resolves the access key of %s',
    (_, instance, call, expected) => {
      const parameters = call as SignIn.AccountOption<SignIn.AccessKeyOption>

      const accessKey = SignIn.accessKey(
        context(instance as Accounts.create.Options),
        parameters.accessKey,
        { account: parameters.account },
      )

      expect(accessKey).toEqual(expected)
    },
  )

  test('throws a TypeError for an access key beside `account: false`', () => {
    expect(() =>
      SignIn.accessKey(context({}), permissions, { account: false }),
    ).toThrow(TypeError)
  })
})

describe('withAccount', () => {
  test.each([
    ['the default instance, for a call without options', {}, {}, true],
    [
      'the default instance, for `account: false`',
      {},
      { account: false },
      false,
    ],
    [
      'an `account: false` instance, for a call without options',
      { account: false },
      {},
      false,
    ],
    [
      'an `account: false` instance, for `account: true`',
      { account: false },
      { account: true },
      true,
    ],
    [
      "an `account: false` instance, for a call's own access key",
      { account: false },
      { accessKey: permissions },
      true,
    ],
  ] as const)(
    'returns whether a sign-in returns the Tempo Account for %s',
    (_, instance, call, expected) => {
      const withAccount = SignIn.withAccount(
        context(instance as Accounts.create.Options),
        call,
      )

      expect(withAccount).toBe(expected)
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
