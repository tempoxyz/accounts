/**
 * Runs the `email` plugin without a server: what `email.sendCode` and `email.signIn` throw for a
 * request without a response, in a browser and on a backend.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Store from '../Store.js'
import { email } from './index.js'

describe('email', () => {
  // Nothing listens at the URL, so each request rejects with a network error.
  function create() {
    return Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      plugins: [email()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
  }

  test('sendCode throws RequestError with status 0 when the request receives no response', async () => {
    const accounts = create()

    const error = await accounts.email
      .sendCode({ email: 'user@example.com' })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The code request received no response. Check the connection, and request the code again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  })

  test('signIn throws RequestError with status 0, and keeps the user signed out, when the request receives no response', async () => {
    const accounts = create()

    const error = await accounts.email
      .signIn({ code: '123456', email: 'user@example.com' })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The sign-in received no response. Check the connection, and sign in again. If the code is refused, request a new code.]`,
    )
    expect({
      session: await accounts.session.get(),
      signedIn: (error as Accounts.RequestError).signedIn,
      status: (error as Accounts.RequestError).status,
    }).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "signedIn": false,
        "status": 0,
      }
    `)
  })

  test('sendCode and signIn throw RequestError with status 0 on a backend when the request receives no response', async () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      clientSecret: 'client-secret',
      plugins: [email()],
      url: 'http://127.0.0.1:9',
    })

    const errors = await Promise.all([
      accounts.email
        .sendCode({ email: 'user@example.com', userIp: '203.0.113.1' })
        .catch((error: unknown) => error),
      accounts.email
        .signIn({ code: '123456', email: 'user@example.com' })
        .catch((error: unknown) => error),
    ])

    expect(
      errors.map((error) => [
        String(error),
        (error as Accounts.RequestError).signedIn,
        (error as Accounts.RequestError).status,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Accounts.RequestError: The code request received no response. Check the connection, and request the code again.",
          false,
          0,
        ],
        [
          "Accounts.RequestError: The sign-in received no response. Check the connection, and sign in again. If the code is refused, request a new code.",
          false,
          0,
        ],
      ]
    `)
  })

  test('signIn drops the characters other than digits of a pasted code, on a page and on a backend, before its request', async () => {
    const codes: unknown[] = []
    // Records the code of each sign-in request, which then fails with a network error.
    const record = (async (input, init) => {
      const body = init?.body
      codes.push(
        body instanceof URLSearchParams
          ? body.get('code')
          : (JSON.parse(String(body)) as { code?: unknown }).code,
      )
      return fetch(input, init)
    }) satisfies typeof fetch
    const page = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: record,
      plugins: [email()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const backend = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      clientSecret: 'client-secret',
      fetch: record,
      plugins: [email()],
      url: 'http://127.0.0.1:9',
    })

    await Promise.allSettled([
      page.email.signIn({ code: ' 468 883\n', email: 'user@example.com' }),
      backend.email.signIn({ code: '468883.', email: 'user@example.com' }),
    ])

    expect(codes).toMatchInlineSnapshot(`
      [
        "468883",
        "468883",
      ]
    `)
  })

  test('signIn refuses a code without exactly 6 digits with invalid_field and status 0, on a page and on a backend, before any request or prompt', async () => {
    const paths: string[] = []
    // Records the path of each request, which then fails with a network error.
    const record = (async (input, init) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname)
      return fetch(input, init)
    }) satisfies typeof fetch
    const page = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      fetch: record,
      plugins: [email()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const backend = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      clientSecret: 'client-secret',
      fetch: record,
      plugins: [email()],
      url: 'http://127.0.0.1:9',
    })

    const errors = await Promise.all(
      [
        page.email.signIn({ code: '', email: 'user@example.com' }),
        page.email.signIn({ code: '46888', email: 'user@example.com' }),
        // With `link`, a typo would otherwise prompt for the passkey before the code is refused.
        page.email.signIn({
          code: '4688831',
          email: 'user@example.com',
          link: 'link',
        }),
        backend.email.signIn({ code: 'abc', email: 'user@example.com' }),
      ].map((promise) =>
        promise.then(
          () => undefined,
          (error: Accounts.RequestError) => ({
            field: error.field,
            message: error.message,
            reason: error.reason,
            signedIn: error.signedIn,
            status: error.status,
          }),
        ),
      ),
    )

    expect({ errors, paths }).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "field": "code",
            "message": "Invalid \`code\`: it holds 0 digits. Pass the 6 digits of the emailed code.",
            "reason": "invalid_field",
            "signedIn": false,
            "status": 0,
          },
          {
            "field": "code",
            "message": "Invalid \`code\`: it holds 5 digits. Pass the 6 digits of the emailed code.",
            "reason": "invalid_field",
            "signedIn": false,
            "status": 0,
          },
          {
            "field": "code",
            "message": "Invalid \`code\`: it holds 7 digits. Pass the 6 digits of the emailed code.",
            "reason": "invalid_field",
            "signedIn": false,
            "status": 0,
          },
          {
            "field": "code",
            "message": "Invalid \`code\`: it holds 0 digits. Pass the 6 digits of the emailed code.",
            "reason": "invalid_field",
            "signedIn": false,
            "status": 0,
          },
        ],
        "paths": [],
      }
    `)
  })

  test('sendCode and signIn refuse a third-party client ID with rejected and status 400, before any request', async () => {
    const paths: string[] = []
    // Records the path of each request, which then fails with a network error.
    const record = (async (input, init) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname)
      return fetch(input, init)
    }) satisfies typeof fetch
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com/client.json',
      fetch: record,
      plugins: [email()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const errors = await Promise.all(
      [
        accounts.email.sendCode({ email: 'user@example.com' }),
        accounts.email.signIn({ code: '123456', email: 'user@example.com' }),
      ].map((promise) =>
        promise.then(
          () => undefined,
          (error: Accounts.RequestError) => ({
            message: error.message,
            reason: error.reason,
            signedIn: error.signedIn,
            status: error.status,
          }),
        ),
      ),
    )

    expect({ errors, paths }).toMatchInlineSnapshot(`
      {
        "errors": [
          {
            "message": "Email sign-in refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with \`dialog.signIn\` or \`redirect.signIn\`.",
            "reason": "rejected",
            "signedIn": false,
            "status": 400,
          },
          {
            "message": "Email sign-in refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with \`dialog.signIn\` or \`redirect.signIn\`.",
            "reason": "rejected",
            "signedIn": false,
            "status": 400,
          },
        ],
        "paths": [],
      }
    `)
  })

  test('sendCode refuses the page origin, the client ID of a page without `clientId`, with a message that names `clientId`', async () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'http://localhost:5173',
      plugins: [email()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts.email
      .sendCode({ email: 'user@example.com' })
      .catch((error: Accounts.RequestError) => error.message)

    expect(error).toMatchInlineSnapshot(
      `"Email sign-in refused: the client ID is an origin, which names a third-party app. Pass \`clientId\`, the ID of the app's first-party registration, or sign in with \`dialog.signIn\` or \`redirect.signIn\`."`,
    )
  })

  test('signIn throws RequestError, not TypeError, for a code that is no string, such as from an untyped request body', async () => {
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'tempo-example-web',
      plugins: [email()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await accounts.email
      .signIn({ code: null as never, email: 'user@example.com' })
      .catch((error: unknown) => error)

    expect(error instanceof Accounts.RequestError).toMatchInlineSnapshot(`true`)
  })
})
