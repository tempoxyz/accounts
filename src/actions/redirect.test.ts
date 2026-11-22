/**
 * Tests the refusals of `redirect` that need no server: a callback's denial, a forged `state`, a
 * posted refusal, a body without a token response, a token response whose ID token is absent or
 * unreadable, a callback without the app's own access key, a pushed request without a response, and
 * the index read of `start` after its pushed request. Also the result of a redirect for another
 * party's access key, without the access key at the callback.
 * @module
 */
import { Address, Base64, Secp256k1 } from 'ox'
import { AccountConfig, KeyAuthorization } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import { from, RequestError } from '../Accounts.js'
import * as Pending from '../internal/Pending.js'
import * as Store from '../Store.js'
import { createUrl, handleCallback, handleResult, start } from './redirect.js'

const pending = Pending.from({
  accessKey: false,
  redirectUri: 'https://app.example.com/',
  state: 'af0ifjsldkj',
  verifier: 'verifier',
})

/** Returns the error that `handleResult` throws for `options`. */
function refusal(options: Omit<handleResult.Options, 'pending'>) {
  try {
    handleResult({ ...options, pending })
  } catch (error) {
    if (error instanceof RequestError)
      return {
        code: error.code,
        field: error.field,
        reason: error.reason,
        signedIn: error.signedIn,
      }
    throw error
  }
  throw new Error('handleResult did not throw.')
}

describe('handleCallback', () => {
  test("throws a callback's denial with status 0, its error_uri, and no field, as the page's callback does", async () => {
    const auth = from({ clientId: 'app', url: 'https://id.example.com' })
    const url = new URL(pending.redirectUri)
    url.search = new URLSearchParams({
      error: 'access_denied',
      error_description: 'The user denied the request.',
      error_uri: 'https://id.example.com/docs/errors#access_denied',
      state: pending.state,
    }).toString()

    const error = await handleCallback(auth, { pending, url }).catch(
      (error: unknown) => error,
    )

    expect(
      error instanceof RequestError && {
        code: error.code,
        field: error.field,
        message: error.message,
        signedIn: error.signedIn,
        status: error.status,
        uri: error.uri,
      },
    ).toMatchInlineSnapshot(`
      {
        "code": "access_denied",
        "field": undefined,
        "message": "The user denied the request.",
        "signedIn": false,
        "status": 0,
        "uri": "https://id.example.com/docs/errors#access_denied",
      }
    `)
  })

  test('states the fault and the fix for a denial without error_description, as the Cancel of an access key page returns it', async () => {
    const auth = from({ clientId: 'app', url: 'https://id.example.com' })
    const url = (error: string) => {
      const value = new URL(pending.redirectUri)
      value.search = new URLSearchParams({
        error,
        state: pending.state,
      }).toString()
      return value
    }

    const messages = await Promise.all(
      [
        'access_denied',
        'login_required',
        'temporarily_unavailable',
        'constructor',
      ].map(
        async (error) =>
          (
            (await handleCallback(auth, { pending, url: url(error) }).catch(
              (error: unknown) => error,
            )) as Error
          ).message,
      ),
    )

    expect(messages).toMatchInlineSnapshot(`
      [
        "The user denied the request. Start the request again to ask once more.",
        "The browser holds no session. Sign in, then start the request again.",
        "Refused callback: \`temporarily_unavailable\`, without a description. Start the request again.",
        "Refused callback: \`constructor\`, without a description. Start the request again.",
      ]
    `)
  })

  test('throws the denial, and redeems no code, for a registered redirect URI that holds its own code', async () => {
    // Nothing listens at the URL, so a code exchange would reject with no response.
    const auth = from({ clientId: 'app', url: 'http://127.0.0.1:9' })
    const registered = Pending.from({
      ...pending,
      redirectUri: 'https://app.example.com/?code=registered',
    })
    const url = new URL(registered.redirectUri)
    url.searchParams.append('error', 'access_denied')
    url.searchParams.append('state', registered.state)

    const error = await handleCallback(auth, {
      pending: registered,
      url,
    }).catch((error: unknown) => error)

    expect(
      error instanceof RequestError && {
        code: error.code,
        signedIn: error.signedIn,
        status: error.status,
      },
    ).toMatchInlineSnapshot(`
      {
        "code": "access_denied",
        "signedIn": false,
        "status": 0,
      }
    `)
  })
  test('refuses a relative callback URL as invalid_request, before any request, and quotes none of its code', async () => {
    // Nothing listens at the URL, so a code exchange would reject with no response.
    const auth = from({ clientId: 'app', url: 'http://127.0.0.1:9' })
    const code = 'SplxlOBeZQQYbYS6WxSbIA'
    const url = `/callback?code=${code}&state=${pending.state}`

    const error = (await handleCallback(auth, { pending, url }).then(
      () => undefined,
      (error: unknown) => error,
    )) as Error

    expect({
      code: error instanceof RequestError ? error.code : undefined,
      field: error instanceof RequestError ? error.field : undefined,
      message: error.message,
      name: error.name,
      quoted: [error.message, error.stack, ...Object.values(error)].some(
        (value) => String(value).includes(code),
      ),
      signedIn: error instanceof RequestError ? error.signedIn : undefined,
    }).toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": "url",
        "message": "Invalid callback URL: it is not a valid absolute URL. Pass the full URL that the authorization server redirected to.",
        "name": "Accounts.RequestError",
        "quoted": false,
        "signedIn": false,
      }
    `)
  })
  test('keeps the message of a client assertion that fails before the code exchange, as a refusal after the sign-in', async () => {
    // Nothing listens at the URL, so only the client assertion's fault ends the exchange.
    const auth = from({
      clientAssertion: () =>
        Promise.reject(new Error('The signer refused the client assertion.')),
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const url = new URL(pending.redirectUri)
    url.search = new URLSearchParams({
      code: 'code',
      state: pending.state,
    }).toString()

    const error = await handleCallback(auth, { pending, url }).catch(
      (error: unknown) => error,
    )

    expect(
      error instanceof RequestError
        ? {
            cause: String(error.cause),
            code: error.code,
            message: error.message,
            signedIn: error.signedIn,
            status: error.status,
          }
        : String(error),
    ).toMatchInlineSnapshot(`
      {
        "cause": "Error: The signer refused the client assertion.",
        "code": "server_error",
        "message": "The signer refused the client assertion.",
        "signedIn": true,
        "status": 0,
      }
    `)
  })

  test('throws RequestError with status 0 and `signedIn` when the code exchange receives no response', async () => {
    // Nothing listens at the URL, so the exchange rejects with a network error.
    const auth = from({
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    const url = new URL(pending.redirectUri)
    url.search = new URLSearchParams({
      code: 'code',
      state: pending.state,
    }).toString()

    const error = await handleCallback(auth, { pending, url }).catch(
      (error: unknown) => error,
    )

    expect(
      error instanceof RequestError
        ? {
            code: error.code,
            message: error.message,
            signedIn: error.signedIn,
            status: error.status,
          }
        : String(error),
    ).toMatchInlineSnapshot(`
      {
        "code": "server_error",
        "message": "The code exchange received no response. Check the connection, and sign in again.",
        "signedIn": true,
        "status": 0,
      }
    `)
  })
})

describe('handleResult', () => {
  test('refuses a forged state, before the user is signed in', () => {
    expect(refusal({ authorization: { access_token: 'a' }, state: 'forged' }))
      .toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": "state",
        "reason": undefined,
        "signedIn": false,
      }
    `)
  })

  test('keeps a posted refusal, with its reason, as a refusal after the sign-in', () => {
    expect(
      refusal({
        authorization: {
          error: 'invalid_request',
          error_description: 'Too many token requests.',
          reason: 'rate_limited',
        },
        state: pending.state,
      }),
    ).toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": undefined,
        "reason": "rate_limited",
        "signedIn": true,
      }
    `)
  })

  test('refuses a body without a token response, as a refusal after the sign-in', () => {
    expect(
      refusal({ authorization: { access_token: 'a' }, state: pending.state }),
    ).toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": undefined,
        "reason": undefined,
        "signedIn": true,
      }
    `)
  })

  test('refuses a token response without an ID token, as a refusal after the sign-in', () => {
    expect(
      refusal({
        authorization: { access_token: 'a', expires_in: 3600 },
        state: pending.state,
      }),
    ).toMatchInlineSnapshot(`
      {
        "code": "server_error",
        "field": undefined,
        "reason": undefined,
        "signedIn": true,
      }
    `)
  })

  test('refuses a token response whose ID token names no user, as a refusal after the sign-in', () => {
    expect(
      refusal({
        authorization: {
          access_token: 'a',
          expires_in: 3600,
          id_token: 'header.!.signature',
        },
        state: pending.state,
      }),
    ).toMatchInlineSnapshot(`
      {
        "code": "server_error",
        "field": undefined,
        "reason": undefined,
        "signedIn": true,
      }
    `)
  })
})

describe("handleResult with the app's own access key", () => {
  test('throws the missing signer of a callback without `accessKey` as it is, which is no refusal of the token response', async () => {
    const auth = from({
      chain: 42431,
      clientId: 'https://app.example.com',
      url: 'https://id.example.com',
    })
    const owner = Secp256k1.randomPrivateKey()
    const own = Account.fromSecp256k1(Secp256k1.randomPrivateKey())
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const authorization = KeyAuthorization.from({
      address: own.address,
      chainId: 42431n,
      expiry,
      type: 'secp256k1',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(authorization),
      privateKey: owner,
    })
    const started = await createUrl(auth, {
      accessKey: { account: own, expiry },
      redirectUri: 'https://app.example.com/',
    })

    const error = (() => {
      try {
        return handleResult({
          authorization: {
            access_token: 'access-token',
            account: Address.fromPublicKey(
              Secp256k1.getPublicKey({ privateKey: owner }),
            ),
            expires_in: 3600,
            id_token: 'e30.e30.signature',
            key_authorization: KeyAuthorization.toRpc(
              KeyAuthorization.from(authorization, { signature }),
            ),
          },
          pending: started.pending,
          state: started.pending.state,
        })
      } catch (error) {
        return error
      }
    })()

    expect(
      error instanceof Error && {
        message: error.message,
        name: error.name,
        request: error instanceof RequestError,
      },
    ).toMatchInlineSnapshot(`
      {
        "message": "The access key has no signer here. Pass the \`signer\` that the app supplied, or sign where the app holds the private key.",
        "name": "AccessKey.SignerRequiredError",
        "request": false,
      }
    `)
  })

  test("throws the key type error of a configurable account's authorization as it is, which is no refusal of the token response", async () => {
    const auth = from({
      chain: 42431,
      clientId: 'https://app.example.com',
      url: 'https://id.example.com',
    })
    const owner = Secp256k1.randomPrivateKey()
    const account = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: owner }),
    )
    const own = Account.fromSecp256k1(Secp256k1.randomPrivateKey())
    const config = AccountConfig.from({
      owners: [{ owner: account, weight: 1 }],
      threshold: 1,
    })
    const address = AccountConfig.getAddress(config)
    const authorization = KeyAuthorization.from({
      address,
      chainId: 42431n,
      type: 'configurable',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(authorization),
      privateKey: owner,
    })
    const started = await createUrl(auth, {
      accessKey: { account: own },
      redirectUri: 'https://app.example.com/',
    })

    const error = (() => {
      try {
        return handleResult({
          accessKey: { account: own },
          authorization: {
            access_token: 'access-token',
            account,
            expires_in: 3600,
            id_token: 'e30.e30.signature',
            key_authorization: KeyAuthorization.toRpc(
              KeyAuthorization.from(authorization, {
                signature: {
                  account: address,
                  config,
                  signatures: [{ signature, type: 'secp256k1' }],
                  type: 'configurable',
                },
              }),
            ),
          },
          pending: started.pending,
          state: started.pending.state,
        })
      } catch (error) {
        return error
      }
    })()

    expect(
      error instanceof Error && {
        message: error.message,
        name: error.name,
        request: error instanceof RequestError,
      },
    ).toMatchInlineSnapshot(`
      {
        "message": "The authorization is for a configurable account, not an access key. Sign in again for an access key.",
        "name": "AccessKey.KeyTypeError",
        "request": false,
      }
    `)
  })
})

describe('handleResult with an addressed access key', () => {
  test("returns the addressed authorization of another party's access key, without `accessKey` at the callback", async () => {
    const auth = from({
      chain: 42431,
      clientId: 'https://app.example.com',
      url: 'https://id.example.com',
    })
    const owner = Secp256k1.randomPrivateKey()
    const account = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: owner }),
    )
    const address = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const authorization = KeyAuthorization.from({
      address,
      chainId: 42431n,
      expiry,
      type: 'secp256k1',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(authorization),
      privateKey: owner,
    })
    const claims = Base64.fromString(
      JSON.stringify({ email: 'user@example.com', sub: 'user_1' }),
      { pad: false, url: true },
    )
    const started = await createUrl(auth, {
      accessKey: { address, expiry },
      redirectUri: 'https://app.example.com/',
    })

    const result = handleResult({
      authorization: {
        access_token: 'access-token',
        account,
        expires_in: 3600,
        id_token: `e30.${claims}.signature`,
        key_authorization: KeyAuthorization.toRpc(
          KeyAuthorization.from(authorization, { signature }),
        ),
      },
      pending: started.pending,
      state: started.pending.state,
    })

    expect(started.pending.accessKey).toMatchInlineSnapshot(`"address"`)
    expect({
      account: Address.isEqual(result.accessKey.account, account),
      address: Address.isEqual(
        KeyAuthorization.fromRpc(result.accessKey.keyAuthorization).address,
        address,
      ),
      signer: 'signer' in result,
      user: result.user,
    }).toMatchInlineSnapshot(`
      {
        "account": true,
        "address": true,
        "signer": false,
        "user": {
          "email": "user@example.com",
          "id": "user_1",
        },
      }
    `)
  })

  test('returns the addressed authorization for a pending that an earlier release kept, which names `accessKey` as `key`', async () => {
    const auth = from({
      chain: 42431,
      clientId: 'https://app.example.com',
      url: 'https://id.example.com',
    })
    const owner = Secp256k1.randomPrivateKey()
    const address = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const authorization = KeyAuthorization.from({
      address,
      chainId: 42431n,
      expiry,
      type: 'secp256k1',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(authorization),
      privateKey: owner,
    })
    const claims = Base64.fromString(
      JSON.stringify({ email: 'user@example.com', sub: 'user_1' }),
      { pad: false, url: true },
    )
    const started = await createUrl(auth, {
      accessKey: { address, expiry },
      redirectUri: 'https://app.example.com/',
    })
    const { accessKey, ...rest } = started.pending
    const earlier = {
      ...rest,
      key: accessKey,
    } as never as typeof started.pending

    const result = handleResult({
      authorization: {
        access_token: 'access-token',
        account: Address.fromPublicKey(
          Secp256k1.getPublicKey({ privateKey: owner }),
        ),
        expires_in: 3600,
        id_token: `e30.${claims}.signature`,
        key_authorization: KeyAuthorization.toRpc(
          KeyAuthorization.from(authorization, { signature }),
        ),
      },
      pending: earlier,
      state: earlier.state,
    })

    expect({
      names: Object.keys(result).sort(),
    }).toMatchInlineSnapshot(`
      {
        "names": [
          "accessKey",
          "accessToken",
          "expiresAt",
          "idToken",
          "receivedAt",
          "refreshToken",
          "user",
        ],
      }
    `)
  })
})

describe('handleResult with an addressed access key and a challenge', () => {
  test("returns the challenge's signature, and refuses a response without one", async () => {
    const auth = from({
      chain: 42431,
      clientId: 'https://app.example.com',
      url: 'https://id.example.com',
    })
    const owner = Secp256k1.randomPrivateKey()
    const account = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: owner }),
    )
    const address = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: Secp256k1.randomPrivateKey() }),
    )
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const authorization = KeyAuthorization.from({
      address,
      chainId: 42431n,
      expiry,
      type: 'secp256k1',
    })
    const signature = Secp256k1.sign({
      payload: KeyAuthorization.getSignPayload(authorization),
      privateKey: owner,
    })
    const claims = Base64.fromString(
      JSON.stringify({ email: 'user@example.com', sub: 'user_1' }),
      { pad: false, url: true },
    )
    const started = await createUrl(auth, {
      accessKey: { address, expiry },
      challenge: 'Sign in to app.example.com',
      redirectUri: 'https://app.example.com/',
    })
    const body = {
      access_token: 'access-token',
      account,
      expires_in: 3600,
      id_token: `e30.${claims}.signature`,
      key_authorization: KeyAuthorization.toRpc(
        KeyAuthorization.from(authorization, { signature }),
      ),
    }

    const signed = handleResult({
      authorization: { ...body, challenge_signature: '0xabcd' },
      pending: started.pending,
      state: started.pending.state,
    })
    const unsigned = (() => {
      try {
        handleResult({
          authorization: body,
          pending: started.pending,
          state: started.pending.state,
        })
        return undefined
      } catch (error) {
        return error instanceof RequestError ? error.code : error
      }
    })()

    expect(signed.challengeSignature).toMatchInlineSnapshot(`"0xabcd"`)
    expect(unsigned).toMatchInlineSnapshot(`"server_error"`)
  })
})

describe('handleCallback.ReturnType', () => {
  test('includes the addressed authorization for a pending that may be an addressed redirect', () => {
    // `createUrl` with an `accessKey` of either kind returns such a `pending`.
    type Result = handleCallback.ReturnType<
      Pending.Addressed | Pending.Pending | Pending.WithoutAccessKey
    >

    // A result with `accessKey` may be an addressed authorization, so its type promises no `signer`.
    const optional: ['signer'] extends [
      keyof Extract<Result, { accessKey: unknown }>,
    ]
      ? false
      : true = true

    expect(optional).toBe(true)
  })
})

describe('createUrl', () => {
  test('throws RequestError with status 0 when the pushed request receives no response', async () => {
    // Nothing listens at the URL, so the push rejects with a network error.
    const auth = from({
      clientId: 'https://app.example.com',
      par: true,
      url: 'http://127.0.0.1:9',
    })

    const error = await createUrl(auth, {
      redirectUri: 'https://app.example.com/',
    }).catch((error: unknown) => error)

    expect(
      error instanceof RequestError
        ? { code: error.code, signedIn: error.signedIn, status: error.status }
        : String(error),
    ).toMatchInlineSnapshot(`
      {
        "code": "server_error",
        "signedIn": false,
        "status": 0,
      }
    `)
  })
})

describe('start', () => {
  test('reads the index of pending redirects only after the pushed request, so a failed push reads nothing', async () => {
    const calls: string[] = []
    const memory = Store.memory()
    const store = Store.from({
      async getItem(key) {
        calls.push(`getItem ${key}`)
        return memory.getItem(key)
      },
      removeItem: (key) => memory.removeItem(key),
      setItem: (key, value, options) => memory.setItem(key, value, options),
    })
    // Nothing listens at the URL, so the push rejects with a network error.
    const auth = from({
      clientId: 'https://app.example.com',
      par: true,
      redirectUri: 'https://app.example.com/',
      store,
      url: 'http://127.0.0.1:9',
    })

    await start(auth).catch(() => undefined)

    // The index rewrite holds a lock that every tab's start waits for, so it starts only once the
    // push returned.
    expect(calls).toMatchInlineSnapshot(`[]`)
  })

  test('refuses a store that only the page holds, before any request, so the user never signs in for a redirect that no return completes', async () => {
    const store = Store.memory()
    // Nothing listens at the URL, so a pushed request would reject with no response.
    const auth = from({
      clientId: 'https://app.example.com',
      par: true,
      redirectUri: 'https://app.example.com/',
      store,
      url: 'http://127.0.0.1:9',
    })

    const error = await start(auth).catch((error: unknown) => error)

    expect(
      error instanceof RequestError
        ? {
            code: error.code,
            field: error.field,
            message: error.message,
            status: error.status,
          }
        : String(error),
    ).toMatchInlineSnapshot(`
      {
        "code": "invalid_request",
        "field": "store",
        "message": "Invalid store: it holds its values only in this page, and the redirect leaves the page. Keep the state in a store that persists across page loads, such as the default.",
        "status": 0,
      }
    `)
    expect(await store.getItem('tempo-id:redirects')).toMatchInlineSnapshot(
      `undefined`,
    )
  })

  test('refuses an instance without a redirect URI outside a page before its store in memory', async () => {
    const auth = from({
      clientId: 'https://app.example.com',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const error = await start(auth).catch((error: unknown) => error)

    expect(
      error instanceof Error ? error.name : String(error),
    ).toMatchInlineSnapshot(`"Accounts.RedirectUriRequiredError"`)
  })

  test('keeps the index rows of two starts that overlap in one page', async () => {
    // A store that persists across page loads, such as IndexedDB, holds the index, so it sets no
    // `local`.
    const store = Store.from({ ...Store.memory(), local: false })
    const auth = from({
      clientId: 'https://app.example.com',
      redirectUri: 'https://app.example.com/',
      store,
      url: 'https://id.example.com',
    })

    // Outside a page, each start rejects at the navigation, after its writes.
    await Promise.all([
      start(auth).catch(() => undefined),
      start(auth).catch(() => undefined),
    ])

    const index = (await store.getItem(
      'tempo-id:redirects',
    )) as readonly unknown[]
    expect(index.length).toMatchInlineSnapshot(`2`)
  })
})
