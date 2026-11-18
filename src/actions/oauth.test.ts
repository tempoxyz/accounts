/**
 * Tests that the OAuth actions that send a credential to Tempo ID follow no redirect, so a redirect never
 * sends the request on to another origin.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as OauthActions from './oauth.js'

describe('Actions.oauth.userInfo', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await OauthActions.userInfo(auth, { accessToken: 'token' }).catch(
      () => undefined,
    )

    expect(requests).toMatchInlineSnapshot(`
      [
        "/oauth2/userinfo redirect=manual",
      ]
    `)
  })
})

/**
 * Returns an instance whose `fetch` records each request's path and redirect mode, then sends it to
 * an address where nothing listens, so each call rejects with no response.
 */
function recording() {
  const requests: string[] = []
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push(
      `${new URL(String(input)).pathname} redirect=${init?.redirect ?? 'follow'}`,
    )
    return globalThis.fetch(input, init)
  }
  const auth = Accounts.from({
    clientId: 'client_test',
    fetch,
    url: 'http://127.0.0.1:9',
  })
  return { auth, requests }
}
