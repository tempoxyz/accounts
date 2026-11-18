/**
 * Tests \`SignIn.toSession\`, which turns a sign-in's result into the session that the instance commits.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as SignIn from './SignIn.js'

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
