/**
 * Tests `Actions.fetch` and `Actions.authorize` without a server: the URL that a request outside a
 * page names, the DPoP token that no key of the instance binds, and the refusal of an access key.
 * @module
 */
import { Base64 } from 'ox'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Actions from './Actions.js'
import * as Dpop from './Dpop.js'

describe('fetch', () => {
  test('throws for a relative URL outside a page, such as in React Native, and the parse error of a malformed absolute URL, before any request', async () => {
    const auth = Accounts.from({ clientId: 'client_test' })

    // A request that went out would reject with a parse error of another message.
    const errors = await Promise.all(
      ['/me', 'https://'].map((url) =>
        Actions.fetch(auth, { accessToken: 'access-token', url }).catch(
          (error: Error) => `${error.name}: ${error.message}`,
        ),
      ),
    )

    expect(errors).toMatchInlineSnapshot(`
      [
        "TypeError: Invalid URL: the URL is relative, and no page resolves it. Pass an absolute URL.",
        "TypeError: Invalid URL: the URL is malformed. Pass a valid absolute URL.",
      ]
    `)
  })

  test('throws a relative or malformed URL outside a page without the URL, whose userinfo, query, or fragment can hold a token', async () => {
    const auth = Accounts.from({ clientId: 'client_test' })
    const urls = [
      '/files?signature=secret#token=secret',
      '//user:secret@ api.example.com/files',
      'https://user:secret@[bad/files?signature=secret#token=secret',
      'https://user:prefix@secret@[bad/files',
      'https:///user:secret@[bad/files',
    ]

    const errors = await Promise.all(
      urls.map((url) =>
        Actions.fetch(auth, { accessToken: 'access-token', url }).then(
          () => 'resolved',
          (error: Error) =>
            JSON.stringify({
              ...error,
              message: error.message,
              name: error.name,
            }),
        ),
      ),
    )

    expect(
      errors.filter((error) => error.includes('secret')),
    ).toMatchInlineSnapshot(`[]`)
    expect(new Set(errors)).toMatchInlineSnapshot(`
      Set {
        "{"message":"Invalid URL: the URL is relative, and no page resolves it. Pass an absolute URL.","name":"TypeError"}",
        "{"message":"Invalid URL: the URL is malformed. Pass a valid absolute URL.","name":"TypeError"}",
      }
    `)
  })

  test('throws invalid_dpop_proof, and sends no request, for a DPoP token that no key or another key of the instance binds', async () => {
    const requests: string[] = []
    const fetch: typeof globalThis.fetch = (input, init) => {
      const headers = new Headers(init?.headers)
      requests.push(
        `${headers.get('authorization')?.split(' ')[0]} dpop=${headers.has('dpop')}`,
      )
      return globalThis.fetch(input, init)
    }
    const bound = await Dpop.create()
    // A DPoP token names the thumbprint of its key in `cnf.jkt`.
    const accessToken = [
      { alg: 'RS256', typ: 'at+jwt' },
      { cnf: { jkt: Dpop.thumbprint(bound) }, sub: 'user_1' },
    ]
      .map((part) =>
        Base64.fromString(JSON.stringify(part), { pad: false, url: true }),
      )
      .concat('signature')
      .join('.')
    const instances = [
      Accounts.from({ clientId: 'client_test', fetch }),
      Accounts.from({
        clientId: 'client_test',
        dpop: await Dpop.create(),
        fetch,
      }),
    ]

    // Nothing listens at the URL, so a request that went out rejects with a network error.
    const errors = await Promise.all(
      instances.map((auth) =>
        Actions.fetch(auth, {
          accessToken,
          url: 'http://127.0.0.1:9/me',
        }).catch((error: Accounts.RequestError) => error.reason ?? error.name),
      ),
    )

    expect({ errors, requests }).toMatchInlineSnapshot(`
      {
        "errors": [
          "invalid_dpop_proof",
          "invalid_dpop_proof",
        ],
        "requests": [],
      }
    `)
  })
})

describe('authorize', () => {
  test('throws the refusal of an access key with empty limits, a passed expiry, or a malformed public key before any request, also without a session', async () => {
    const requests: string[] = []
    const fetch: typeof globalThis.fetch = (input, init) => {
      requests.push(String(input))
      return globalThis.fetch(input, init)
    }
    // Nothing listens at the URL, so a session check that went out rejects with `server_error`.
    const auth = Accounts.from({
      clientId: 'client_test',
      fetch,
      url: 'http://127.0.0.1:9',
    })

    const errors = await Promise.all(
      (
        [
          { expiry: '1d', limits: [] },
          { expiry: 1, limits: [{ limit: '1', token: 'ousd' }] },
          {
            expiry: '1d',
            limits: [{ limit: '1', token: 'ousd' }],
            publicKey: '0x1234',
          },
        ] as const
      ).map((accessKey) =>
        Actions.authorize(auth, { accessKey }).catch(
          (error: Accounts.RequestError) => [error.reason, error.status],
        ),
      ),
    )

    expect({ errors, requests }).toMatchInlineSnapshot(`
      {
        "errors": [
          [
            "empty_limits",
            0,
          ],
          [
            "expiry_passed",
            0,
          ],
          [
            "invalid_public_key",
            0,
          ],
        ],
        "requests": [],
      }
    `)
  })

  test('follows no redirect in the session check', async () => {
    const requests: string[] = []
    const fetch: typeof globalThis.fetch = (input, init) => {
      requests.push(
        `${new URL(String(input)).pathname} redirect=${init?.redirect ?? 'follow'}`,
      )
      return globalThis.fetch(input, init)
    }
    // Nothing listens at the URL, so the session check rejects with `server_error`.
    const auth = Accounts.from({
      clientId: 'client_test',
      fetch,
      url: 'http://127.0.0.1:9',
    })

    await Actions.authorize(auth).catch(() => undefined)

    expect(requests).toMatchInlineSnapshot(`
      [
        "/v1/auth/session redirect=manual",
      ]
    `)
  })
})
