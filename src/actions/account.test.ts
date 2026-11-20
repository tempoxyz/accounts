/**
 * Tests that the account actions that send a credential to Tempo ID follow no redirect, so a redirect never
 * sends the request on to another origin.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as AccountActions from './account.js'

describe('Actions.account.connection', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await AccountActions.connection(auth, { accessToken: 'token' }).catch(
      () => undefined,
    )

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/connection redirect=manual",
      ]
    `)
  })
})

describe('Actions.account.connections', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await AccountActions.connections(auth).catch(() => undefined)

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/account/connections redirect=manual",
      ]
    `)
  })
})

describe('Actions.account.get', () => {
  test('follows no redirect', async () => {
    const { auth, requests } = recording()

    await AccountActions.get(auth, { accessToken: 'token' }).catch(
      () => undefined,
    )

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/account redirect=manual",
      ]
    `)
  })
})

describe('Actions.account.updateAccessKey', () => {
  test('refuses a negative limit and a repeated token before any request', async () => {
    const { auth, requests } = recording()
    const token = '0x20c0000000000000000000000000000000000000'
    const options = {
      accessKey: '0x9f1000000000000000000000000000000000f08',
      account: '0xff5deded16eb46018387144ff8bf41f26afb41af',
      chainId: 42431,
    } as const

    const errors = await Promise.all(
      [
        [{ limit: -1n, token }],
        [
          { limit: 1n, token },
          { limit: 2n, token: token.toUpperCase().replace('0X', '0x') },
        ],
      ].map((limits) =>
        AccountActions.updateAccessKey(auth, {
          ...options,
          limits: limits as { limit: bigint; token: `0x${string}` }[],
        }).catch((error: unknown) =>
          error instanceof Accounts.RequestError
            ? { field: error.field, reason: error.reason }
            : String(error),
        ),
      ),
    )

    expect({ errors, requests }).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "field": "limits.0.limit",
            "reason": "invalid_field",
          },
          {
            "field": "limits.1.token",
            "reason": "invalid_field",
          },
        ],
        "requests": [],
      }
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
