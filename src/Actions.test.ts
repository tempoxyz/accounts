/**
 * Runs the headless sign-ins and the other actions against `apps/id`. A realm's secp256k1 owners,
 * which the harness holds, sign access keys.
 * @module
 */
import { AccessKey, Actions, Id, Permissions } from 'accounts'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vite-plus/test'
import { Address, Base64, Bytes, Hex, Secp256k1 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account, Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import { ousd } from 'viem/tokens'
import * as Admin from '../test/Admin.js'
import * as Client from '../test/Client.js'
import * as Passkeys from '../test/Passkeys.js'
import { Database, Env, Harness, Realm, Schema, Sql } from '../test/TempoId.js'

const admin = Admin.create()
const database = Database.connect()
const server = Harness.create()

/** The origin of each test's app, which the `default` realm's relying party covers. */
const appOrigin = `https://app.${Passkeys.rpId}`

/** OUSD, which has its mainnet address on every Tempo chain. */
const ousdAddress = ousd(tempo.id).address

beforeAll(async () => {
  await Promise.all([admin.listen(), server.listen()])
})

afterEach(async (context) => {
  if (context.task.result?.state === 'fail') {
    admin.debug()
    server.debug()
  }
  await Promise.all([admin.reset(), server.reset()])
})

afterAll(async () => {
  await Promise.all([admin.close(), database.end(), server.close()])
})

describe('account.get', () => {
  test('rejects a request without a session with 401 and login_required', async () => {
    const client = await instance()

    const error = await Actions.account
      .get(client.auth)
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect([
      (error as Id.RequestError).status,
      (error as Id.RequestError).code,
      (error as Id.RequestError).reason,
    ]).toMatchInlineSnapshot(`
      [
        401,
        "login_required",
        "session_required",
      ]
    `)
  })

  test("sends `chainId` as `chain`, which Tempo ID reads as the chain's name, and returns no config on a chain whose accounts are not configurable", async () => {
    const client = await instance({ realms: [await realm()] })
    const created = await signIn(client)

    const account = await Actions.account.get(client.auth, { chainId: 42431 })

    expect(client.paths.slice(-1)).toMatchInlineSnapshot(`
      [
        "GET /v1/account",
      ]
    `)
    expect(account!.address).toBe(created.address)
    expect(account!.config).toBeUndefined()
  })

  test('throws invalid_field for a `chainId` that the deployment does not list, from the account request', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)
    const before = client.paths.length

    const error = await Actions.account
      .get(client.auth, { chainId: 1 })
      .catch((error: unknown) => error)

    expect(client.paths.slice(before)).toMatchInlineSnapshot(`
      [
        "GET /v1/account",
      ]
    `)
    expect([
      (error as Id.RequestError).field,
      (error as Id.RequestError).reason,
    ]).toMatchInlineSnapshot(`
      [
        "chain",
        "invalid_field",
      ]
    `)
  })
})

describe('authorize', () => {
  test('types the key from accessKey: present for an access key, absent for none, and either for a value that may be undefined, on the chain that they name', () => {
    const auth = Id.from({ clientId: 'types' })
    const maybe = undefined as Permissions.Permissions | undefined
    const testnet = Permissions.from({ chainId: 42431 })
    // Never called, so the types read the results of these calls alone.
    const calls = {
      either: () => Actions.authorize(auth, { accessKey: maybe }),
      keyed: () => Actions.authorize(auth, { accessKey: testnet }),
      none: () => Actions.authorize(auth),
    }
    type Result<call extends () => unknown> = NonNullable<
      Awaited<ReturnType<call>>
    >

    expectTypeOf<Result<typeof calls.none>>().not.toHaveProperty('key')
    expectTypeOf<
      Result<typeof calls.keyed>['key']['chainId']
    >().toEqualTypeOf<42431>()
    expectTypeOf<
      'key' extends keyof Result<typeof calls.either> ? true : false
    >().toEqualTypeOf<false>()
  })

  test('returns undefined without a session, and sends no authorization request', async () => {
    const client = await instance()

    const authorization = await Actions.authorize(client.auth)

    expect(authorization).toBeUndefined()
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/session",
      ]
    `)
  })

  test('creates the first account of a signed-in user who holds none, and signs its key, in one authorization request', async () => {
    const client = await instance({ realms: [await realm()] })
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })

    const authorization = await Actions.authorize(client.auth, {
      accessKey: permissions(),
    })
    const [owner] = await database.db
      .select({ address: Schema.secp256k1Owners.address })
      .from(Schema.secp256k1Owners)
      .innerJoin(
        Schema.user,
        Sql.eq(Schema.user.id, Schema.secp256k1Owners.userId),
      )
      .where(Sql.eq(Schema.user.email, email))

    expect(client.paths.slice(-2)).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/session",
        "POST /v1/authorize",
      ]
    `)
    expect(
      Address.isEqual(
        authorization!.key.account,
        owner!.address as `0x${string}`,
      ),
    ).toBe(true)
  })

  test('authorizes no key without accessKey, and returns the tokens alone', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)

    const authorization = await Actions.authorize(client.auth)

    expect(Object.keys(authorization!).sort()).toMatchInlineSnapshot(`
      [
        "accessToken",
        "expiresAt",
        "idToken",
        "refreshToken",
        "upgradeAvailable",
        "user",
      ]
    `)
  })

  test('signs the access key it receives as it is, without filling any field', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)
    const expiry = Expiry.days(30)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: {
        expiry,
        limits: [{ limit: 1_000_000n, token: ousdAddress }],
        scopes: [Scopes.tip20(ousdAddress).transfer()],
      },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect(signed.expiry).toBe(expiry)
    expect(signed.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": 1000000n,
          "token": "0x20c0000000000000000000006a37DA5C996874BE",
        },
      ]
    `)
    expect(signed.scopes).toMatchInlineSnapshot(`
      [
        {
          "address": "0x20c0000000000000000000006a37DA5C996874BE",
          "selector": "0xa9059cbb",
        },
      ]
    `)
  })

  test('resolves a duration expiry, a token symbol, and a decimal limit, and fills the scopes from the limits', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)
    const spender = '0x000000000000000000000000000000000000dEaD'
    const before = Math.floor(Date.now() / 1000)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: {
        expiry: '1d',
        limits: [
          { limit: '10.5', period: '1h', spenders: [spender], token: 'OUSD' },
        ],
      },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect(signed.expiry! - before).toBeGreaterThanOrEqual(86_400)
    expect(signed.expiry! - before).toBeLessThan(86_400 + 60)
    expect(signed.limits).toMatchInlineSnapshot(`
      [
        {
          "limit": 10500000n,
          "period": 3600,
          "token": "0x20c0000000000000000000006a37DA5C996874BE",
        },
      ]
    `)
    expect(signed.scopes).toMatchInlineSnapshot(`
      [
        {
          "address": "0x20c0000000000000000000006a37DA5C996874BE",
          "selector": "0xa9059cbb",
        },
        {
          "address": "0x20c0000000000000000000006a37DA5C996874BE",
          "selector": "0x95777d59",
        },
        {
          "address": "0x20c0000000000000000000006a37DA5C996874BE",
          "recipients": [
            "0x000000000000000000000000000000000000dEaD",
          ],
          "selector": "0x095ea7b3",
        },
        {
          "address": "0x4d50500000000000000000000000000000000000",
          "selector": "0xedc53b00",
        },
        {
          "address": "0x4d50500000000000000000000000000000000000",
          "selector": "0xdc48471e",
        },
      ]
    `)
  })

  test('signs the scopes it receives in place of the scopes that the limits fill', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: {
        expiry: '1h',
        limits: [{ limit: 1_000_000n, token: 'ousd' }],
        scopes: [Scopes.tip20(ousdAddress).transfer()],
      },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect(signed.scopes).toMatchInlineSnapshot(`
      [
        {
          "address": "0x20c0000000000000000000006a37DA5C996874BE",
          "selector": "0xa9059cbb",
        },
      ]
    `)
  })

  test('refuses an unknown token symbol, a decimal limit on an unlisted token, a malformed duration, and a limit finer than its token before it sends the authorization request', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)
    const before = client.paths.length

    const errors = await Promise.all(
      [
        { expiry: '1d', limits: [{ limit: '1', token: 'nope' as never }] },
        {
          expiry: '1d',
          limits: [
            {
              limit: '1',
              token: '0x20c0000000000000000000000000000000000fff',
            },
          ],
        },
        {
          expiry: '1 day' as never,
          limits: [{ limit: '1', token: 'ousd' }],
        },
        { expiry: '1d', limits: [{ limit: '0.0000005', token: 'ousd' }] },
      ].map((permissions) =>
        Actions.authorize(client.auth, {
          accessKey: permissions as Permissions.Permissions,
        }).catch((error: unknown) => error),
      ),
    )

    expect(errors.map((error) => (error as Error).name)).toMatchInlineSnapshot(`
      [
        "Permissions.TokenUnknownError",
        "Permissions.DecimalsUnknownError",
        "Permissions.InvalidDurationError",
        "Permissions.LimitPrecisionError",
      ]
    `)
    expect(client.paths.slice(before)).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/session",
        "GET /v1/auth/session",
        "GET /v1/auth/session",
        "GET /v1/auth/session",
      ]
    `)
  })

  test('refuses a key that leaves out its limits or scopes, or never expires, from an app without tempo-id:sign', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)

    const errors = await Promise.all(
      [
        {},
        { scopes: [Scopes.tip20(ousdAddress).transfer()] },
        { limits: [{ limit: 1_000_000n, token: ousdAddress }], scopes: 'any' },
        { ...permissions(), expiry: false },
      ].map((permissions) =>
        Actions.authorize(client.auth, {
          accessKey: permissions as Permissions.Permissions,
        }).catch((error: unknown) => error as Id.RequestError),
      ),
    )

    expect(
      errors.map((error) => [
        error instanceof Id.RequestError,
        (error as Id.RequestError).status,
        (error as Id.RequestError).reason,
        (error as Id.RequestError).field,
        (error as Id.RequestError).meta,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          true,
          400,
          "missing_permissions",
          "key_authorization.limits",
          {
            "missing": "limits scopes",
          },
        ],
        [
          true,
          400,
          "missing_permissions",
          "key_authorization.limits",
          {
            "missing": "limits",
          },
        ],
        [
          true,
          400,
          "missing_permissions",
          "key_authorization.scopes",
          {
            "missing": "scopes",
          },
        ],
        [
          true,
          400,
          "invalid_expiry",
          "key_authorization.expiry",
          {
            "expiry": 0,
          },
        ],
      ]
    `)
  })

  test("signs a key without an expiry until the app's refresh token lifetime from now, 30 days by default", async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)
    const before = Math.floor(Date.now() / 1000)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: { limits: [{ limit: '10', token: 'ousd' }] },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect(signed.expiry! - before).toBeGreaterThanOrEqual(30 * 86_400)
    expect(signed.expiry! - before).toBeLessThan(30 * 86_400 + 60)
  })

  test('signs a key that never expires, spends any amount, and makes any call for an app with tempo-id:sign', async () => {
    const client = await instance({ realms: [await realm()], sign: true })
    await signIn(client)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: { expiry: false },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect([signed.expiry, signed.limits, signed.scopes])
      .toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        undefined,
      ]
    `)
  })

  test("sends no scopes for scopes: 'any', and signs a key with limits that makes any call for an app with tempo-id:sign", async () => {
    const client = await instance({ realms: [await realm()], sign: true })
    await signIn(client)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: {
        expiry: '1h',
        limits: [{ limit: '10', token: 'ousd' }],
        scopes: 'any',
      },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect([signed.limits, signed.scopes]).toMatchInlineSnapshot(`
      [
        [
          {
            "limit": 10000000n,
            "token": "0x20c0000000000000000000006a37DA5C996874BE",
          },
        ],
        undefined,
      ]
    `)
  })

  test('signs a key above the headless ceiling for a session that signed in more than 10 minutes before', async () => {
    const client = await instance({ realms: [await realm()], sign: true })
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select({ id: Schema.user.id })
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    await database.db
      .update(Schema.session)
      .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(Sql.eq(Schema.session.userId, user!.id))

    const authorization = await Actions.authorize(client.auth, {
      accessKey: { expiry: false },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect([signed.expiry, signed.limits, signed.scopes])
      .toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        undefined,
      ]
    `)
  })

  test('rejects an expiry of 400 days with expiry_exceeds_maximum', async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)

    const error = await Actions.authorize(client.auth, {
      accessKey: { ...permissions(), expiry: Expiry.days(400) },
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect([
      (error as Id.RequestError).status,
      (error as Id.RequestError).code,
      (error as Id.RequestError).reason,
      (error as Id.RequestError).field,
    ]).toMatchInlineSnapshot(`
      [
        403,
        "invalid_authorization_details",
        "expiry_exceeds_maximum",
        "key_authorization.expiry",
      ]
    `)
  })

  test('returns a key whose chain AccessKey.from fills, whose account AccessKey.toAccount rebuilds, and whose expiry AccessKey.expired reads', async () => {
    const client = await instance({ realms: [await realm()] })
    const tempoAccount = await signIn(client)

    const authorization = await Actions.authorize(client.auth, {
      accessKey: permissions(),
    })
    // An access key stored before `chainId` existed leaves it out.
    const { chainId: _, ...stored } = authorization!.key
    const key = AccessKey.from(stored)
    const account = AccessKey.toAccount(key)
    const signed = KeyAuthorization.fromRpc(key.keyAuthorization)
    // The same access key, with an expiry a minute in the past.
    const past = AccessKey.from({
      ...stored,
      keyAuthorization: {
        ...stored.keyAuthorization,
        expiry: Hex.fromNumber(Math.floor(Date.now() / 1000) - 60),
      },
    })

    expect(key.chainId).toBe(tempo.id)
    expect(Address.isEqual(account.address, tempoAccount.address)).toBe(true)
    expect(Address.isEqual(account.accessKeyAddress, signed.address)).toBe(true)
    expect(AccessKey.expired(key)).toBe(false)
    expect(AccessKey.expired(past)).toBe(true)
  })

  test("signs for the user's second account, which the access key's access names", async () => {
    const first = await realm()
    const second = await realm()
    const client = await instance({ realms: [first, second] })
    const other = await instance({ realms: [second] })
    const oldest = await signIn(client)
    // An app whose first realm is the second one creates the user's account there.
    const created = await Actions.account.get({
      ...client.auth,
      clientId: other.auth.clientId,
    })

    const authorization = await Actions.authorize(client.auth, {
      accessKey: {
        ...permissions(),
        account: Account.fromSecp256k1(Secp256k1.randomPrivateKey(), {
          access: created!.address,
        }),
      },
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)
    const owner = SignatureEnvelope.extractAddress({
      payload: KeyAuthorization.getSignPayload(signed),
      signature: signed.signature,
    })

    expect(Address.isEqual(created!.address, oldest.address)).toBe(false)
    expect(Address.isEqual(authorization!.key.account, created!.address)).toBe(
      true,
    )
    expect(Address.isEqual(owner, created!.address)).toBe(true)
  })

  test("signs the key of a wallet.tempo passkey's account through the passkey step with passkey, and refuses it with webauthn_required without", async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })

    const refused = await Actions.authorize(client.auth, {
      accessKey: permissions(),
    }).catch((error: unknown) => error)
    const authorization = await Actions.authorize(client.auth, {
      getFn: passkey.getFn({ origin: appOrigin }),
      passkey: true,
      accessKey: permissions(),
    })

    expect((refused as Id.RequestError).reason).toMatchInlineSnapshot(
      `"webauthn_required"`,
    )
    expect(
      Address.isEqual(authorization!.key.account, Passkeys.address(passkey)),
    ).toBe(true)
    expect(
      KeyAuthorization.fromRpc(authorization!.key.keyAuthorization).signature
        .type,
    ).toMatchInlineSnapshot(`"webAuthn"`)
  })

  test('repeats the passkey step of a key that never expires with an expiry of 0, for an app with tempo-id:sign', async () => {
    const client = await instance({ sign: true })
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })

    const authorization = await Actions.authorize(client.auth, {
      accessKey: { expiry: false },
      getFn: passkey.getFn({ origin: appOrigin }),
      passkey: true,
    })
    const signed = KeyAuthorization.fromRpc(authorization!.key.keyAuthorization)

    expect([signed.expiry, signed.signature.type]).toMatchInlineSnapshot(`
      [
        undefined,
        "webAuthn",
      ]
    `)
  })

  test("throws the passkey step's webauthn_rejected for an assertion that does not verify, and webauthn_required for a failed ceremony, and returns undefined once the session ends during it", async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })

    const rejected = await Actions.authorize(client.auth, {
      getFn: passkey.getFn({ origin: 'https://evil.example' }),
      passkey: true,
      accessKey: permissions(),
    }).catch((error: unknown) => error)
    const dismissed = await Actions.authorize(client.auth, {
      getFn: () => Promise.reject(new Error('The user dismissed the prompt.')),
      passkey: true,
      accessKey: permissions(),
    }).catch((error: unknown) => error)
    const authorization = await Actions.authorize(client.auth, {
      getFn: passkey.getFn({ origin: appOrigin }),
      passkey: true,
      accessKey: permissions(),
    })
    // The session ends while the passkey signs, so the repeated request finds none.
    const signedOut = await Actions.authorize(client.auth, {
      getFn: async (request) => {
        await Actions.signOut(client.auth)
        return await passkey.getFn({ origin: appOrigin })(request)
      },
      passkey: true,
      accessKey: permissions(),
    })

    expect(signedOut).toBeUndefined()
    expect((rejected as Id.RequestError).reason).toMatchInlineSnapshot(
      `"webauthn_rejected"`,
    )
    expect((dismissed as Id.RequestError).reason).toMatchInlineSnapshot(
      `"webauthn_required"`,
    )
    expect((dismissed as Id.RequestError).cause).toBeDefined()
    expect(
      Address.isEqual(authorization!.key.account, Passkeys.address(passkey)),
    ).toBe(true)
  })

  test('refuses a challenge without a key before it sends any request', async () => {
    const client = await instance()

    const error = await Actions.authorize(client.auth, {
      // A challenge rides in the access key, so the type admits none without `accessKey`.
      challenge: 'Sign in to Example' as never,
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.ChallengeWithoutKeyError)
    expect(client.paths).toEqual([])
  })

  test("returns a key without material for the app's access key, whose account AccessKey.toAccount rebuilds only with that access key", async () => {
    const client = await instance({ realms: [await realm()] })
    const tempoAccount = await signIn(client)
    const accessKey = Account.fromSecp256k1(Secp256k1.randomPrivateKey(), {
      access: tempoAccount.address,
    })

    const authorization = await Actions.authorize(client.auth, {
      accessKey: { ...permissions(), account: accessKey },
    })
    const error = (() => {
      try {
        return AccessKey.toAccount(authorization!.key)
      } catch (error) {
        return error
      }
    })()
    const account = AccessKey.toAccount(authorization!.key, { accessKey })
    const signature = SignatureEnvelope.from(
      await account.sign({ hash: Hex.random(32) }),
    )

    expect(authorization!.key.privateKey).toBeUndefined()
    expect(error).toBeInstanceOf(AccessKey.AccessKeyRequiredError)
    expect((error as Error).message).toMatchInlineSnapshot(
      `"The key carries no material. Pass the \`accessKey\` the app supplied."`,
    )
    expect(Address.isEqual(account.address, tempoAccount.address)).toBe(true)
    expect(
      Address.isEqual(account.accessKeyAddress, accessKey.accessKeyAddress),
    ).toBe(true)
    expect(signature.type).toMatchInlineSnapshot(`"keychain"`)
  })

  test("rejects an access key whose access names an account that is not the user's with foreign_account", async () => {
    const client = await instance({ realms: [await realm()] })
    await signIn(client)

    const error = await Actions.authorize(client.auth, {
      accessKey: {
        ...permissions(),
        account: Account.fromSecp256k1(Secp256k1.randomPrivateKey(), {
          access: Account.fromSecp256k1(Secp256k1.randomPrivateKey()).address,
        }),
      },
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect([
      (error as Id.RequestError).status,
      (error as Id.RequestError).code,
      (error as Id.RequestError).reason,
      (error as Id.RequestError).field,
    ]).toMatchInlineSnapshot(`
      [
        403,
        "access_denied",
        "foreign_account",
        "key_authorization.account",
      ]
    `)
  })
})

describe('email.signIn', () => {
  test('refuses a challenge without a key before it sends any request', async () => {
    const client = await instance()

    const error = await Actions.email
      .signIn(client.auth, {
        // A challenge rides in the access key, so the type admits none without `accessKey`.
        challenge: 'Sign in to Example' as never,
        code: '123456',
        email: address(),
      })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.ChallengeWithoutKeyError)
    expect(client.paths).toEqual([])
  })

  test('returns the tokens and the user without a key, creates no account, and leaves Actions.authorize to refuse a user without one', async () => {
    const client = await instance()
    const email = address()

    await Actions.email.sendCode(client.auth, { email })
    const result = await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const error = await Actions.authorize(client.auth, {
      accessKey: permissions(),
    }).catch((error: unknown) => error)

    expect(Object.keys(result).sort()).toMatchInlineSnapshot(`
      [
        "accessToken",
        "expiresAt",
        "idToken",
        "refreshToken",
        "upgradeAvailable",
        "user",
      ]
    `)
    expect(result.user.email).toBe(email)
    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"rejected"`,
    )
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
        "GET /v1/auth/session",
        "POST /v1/authorize",
      ]
    `)
  })

  test('authorizes the user whom the code verified, also with an earlier session of another user in the browser', async () => {
    const client = await instance({ realms: [await realm()] })
    const first = address()
    const second = address()
    await Actions.email.sendCode(client.auth, { email: first })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email: first }),
      email: first,
    })

    await Actions.email.sendCode(client.auth, { email: second })
    const authorization = await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email: second }),
      email: second,
      accessKey: permissions(),
    })
    const [owner] = await database.db
      .select({ address: Schema.secp256k1Owners.address })
      .from(Schema.secp256k1Owners)
      .innerJoin(
        Schema.user,
        Sql.eq(Schema.user.id, Schema.secp256k1Owners.userId),
      )
      .where(Sql.eq(Schema.user.email, second))

    expect(authorization.user.email).toBe(second)
    expect(client.paths.slice(-2)).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
      ]
    `)
    expect(
      Address.isEqual(
        authorization.key.account,
        owner!.address as `0x${string}`,
      ),
    ).toBe(true)
  })

  test('signs in and signs the key of the passkey-owned account in verify, with one assertion', async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })
    const other = await instance({ clientId: client.auth.clientId })

    const result = await Actions.passkey.signIn(other.auth, {
      getFn: passkey.getFn({ origin: appOrigin }),
      accessKey: permissions(),
    })
    if ('step' in result) throw new Error('Expected the authorization.')

    expect(other.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/verify",
      ]
    `)
    const authorization = result
    expect(authorization.user.id).toBe(user!.id)
    expect(
      Address.isEqual(authorization.key.account, Passkeys.address(passkey)),
    ).toBe(true)
    expect(
      KeyAuthorization.fromRpc(authorization.key.keyAuthorization).signature
        .type,
    ).toMatchInlineSnapshot(`"webAuthn"`)
  })

  test("signs in with the code, then signs the key of a wallet.tempo passkey's account through the passkey step on the page", async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })
    const other = await instance({ clientId: client.auth.clientId })

    await Actions.email.sendCode(other.auth, { email })
    const authorization = await Actions.email.signIn(other.auth, {
      code: await Harness.code(server, { email }),
      email,
      getFn: passkey.getFn({ origin: appOrigin }),
      accessKey: permissions(),
    })

    expect(other.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
        "POST /v1/authorize",
      ]
    `)
    expect(authorization.user.id).toBe(user!.id)
    expect(
      Address.isEqual(authorization.key.account, Passkeys.address(passkey)),
    ).toBe(true)
    expect(
      KeyAuthorization.fromRpc(authorization.key.keyAuthorization).signature
        .type,
    ).toMatchInlineSnapshot(`"webAuthn"`)
  })

  test("throws webauthn_required, marked signedIn, when the passkey step's ceremony fails after the code", async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })

    await Actions.email.sendCode(client.auth, { email })
    const error = (await Actions.email
      .signIn(client.auth, {
        code: await Harness.code(server, { email }),
        email,
        getFn: () =>
          Promise.reject(new Error('The user dismissed the prompt.')),
        accessKey: permissions(),
      })
      .catch((error: unknown) => error)) as Id.RequestError

    expect(error.reason).toMatchInlineSnapshot(`"webauthn_required"`)
    expect(error.signedIn).toBe(true)
    expect(error.cause).toBeDefined()
  })

  test('signs in and authorizes in verify, which refuses a user without an account in a realm that creates none with rejected', async () => {
    const client = await instance()
    const email = address()

    await Actions.email.sendCode(client.auth, { email })
    const error = await Actions.email
      .signIn(client.auth, {
        code: await Harness.code(server, { email }),
        email,
        accessKey: permissions(),
      })
      .catch((error: unknown) => error)
    const session = await Actions.authorize(client.auth, {
      accessKey: permissions(),
    }).catch((error: unknown) => error)

    expect(client.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
        "GET /v1/auth/session",
        "POST /v1/authorize",
      ]
    `)
    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"rejected"`,
    )
    expect((error as Id.RequestError).signedIn).toBe(true)
    expect((error as Id.RequestError).message).toMatchInlineSnapshot(
      `"No Tempo Account: the user holds no account in the app's realms, and the app's first realm has no Privy app to create one. Authorize without \`key_authorization\`."`,
    )
    expect((session as Id.RequestError).reason).toMatchInlineSnapshot(
      `"rejected"`,
    )
  })

  test("creates the user's first account and authorizes in requests of its own, against a server that returns no authorization from verify", async () => {
    const client = await instance({ realms: [await realm()] })
    const auth = { ...client.auth, fetch: unauthorized(client) }
    const email = address()
    await Actions.email.sendCode(auth, { email })

    const authorization = await Actions.email.signIn(auth, {
      code: await Harness.code(server, { email }),
      email,
      accessKey: permissions(),
    })
    const tempoAccount = await Actions.account.get(auth)

    expect(client.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
        "POST /v1/account",
        "POST /v1/authorize",
        "GET /v1/account",
      ]
    `)
    expect(
      Address.isEqual(authorization.key.account, tempoAccount!.address),
    ).toBe(true)
  })

  test('throws session_changed, marked signedIn, when another sign-in replaces the session before the authorization', async () => {
    const client = await instance()
    const other = address()
    // Another tab signs in another user before the client's own authorization request.
    const auth = {
      ...client.auth,
      fetch: unauthorized(client, {
        before: async (path) => {
          if (path !== '/v1/authorize') return
          await Actions.email.sendCode(client.auth, { email: other })
          await Actions.email.signIn(client.auth, {
            code: await Harness.code(server, { email: other }),
            email: other,
          })
        },
      }),
    }
    const email = address()
    await Actions.email.sendCode(auth, { email })

    const error = await Actions.email
      .signIn(auth, {
        code: await Harness.code(server, { email }),
        email,
      })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect([
      (error as Id.RequestError).status,
      (error as Id.RequestError).reason,
      (error as Id.RequestError).signedIn,
      (error as Id.RequestError).message,
    ]).toMatchInlineSnapshot(`
      [
        409,
        "session_changed",
        true,
        "Session changed: another sign-in replaced this one before the authorization. Sign in again.",
      ]
    `)
  })

  test('refuses a wrong code, and sends no authorization request', async () => {
    const client = await instance()
    const email = address()

    await Actions.email.sendCode(client.auth, { email })
    await Harness.code(server, { email })
    const error = await Actions.email
      .signIn(client.auth, { code: '000000', email })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"invalid_code"`,
    )
    expect((error as Id.RequestError).signedIn).toBe(false)
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
      ]
    `)
  })

  test('refuses an app that asks for consent with rejected, before the sign-in, and leaves the code unspent', async () => {
    const client = await instance({ skipConsent: false })
    const email = address()

    await Actions.email.sendCode(client.auth, { email })
    const sent = await Harness.code(server, { email })
    const error = await Actions.email
      .signIn(client.auth, { code: sent, email })
      .catch((error: unknown) => error)
    // The same code still signs in without the authorization request.
    const verified = await client.fetch(
      new URL('/v1/auth/code/verify', Env.origin),
      {
        body: JSON.stringify({ code: sent, email }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"rejected"`,
    )
    expect((error as Id.RequestError).signedIn).toBe(false)
    expect((error as Id.RequestError).message).toMatchInlineSnapshot(
      `"Headless authorization refused: the app is not a first-party app. Send the user to \`/oauth2/authorize\`, and receive the code at the redirect URI."`,
    )
    expect(verified.status).toMatchInlineSnapshot(`200`)
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/code",
        "POST /v1/auth/code/verify",
        "POST /v1/auth/code/verify",
      ]
    `)
  })
})

describe('passkey.available', () => {
  test('returns false, and does not reject, when Tempo ID answers with an unreadable body', async () => {
    const client = await instance()
    const unavailable = await Actions.passkey.available({
      ...client.auth,
      fetch: () =>
        Promise.resolve(new Response('Unavailable', { status: 503 })),
    })

    expect(unavailable).toMatchInlineSnapshot(`false`)
  })

  test("returns true on a page of the app that the default realm's passkeys cover, and false on another page or in a realm without passkeys", async () => {
    const client = await instance()
    const elsewhere = Client.create(server, {
      clientId: client.auth.clientId,
      origin: 'https://evil.example',
    })
    const cash = await instance({ realms: [await realm()] })

    const results = await Promise.all([
      Actions.passkey.available(client.auth),
      Actions.passkey.available(elsewhere.auth),
      Actions.passkey.available(cash.auth),
    ])

    expect(results).toMatchInlineSnapshot(`
      [
        true,
        false,
        false,
      ]
    `)
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "GET /v1/realms",
      ]
    `)
  })
})

describe('passkey.prepare', () => {
  test('requests the options before the sign-in, which then sends only verify and signs the key with the same assertion', async () => {
    const { other, passkey, user } = await passkeyUser()

    const prepared = Actions.passkey.prepare(other.auth, {
      accessKey: permissions(),
    })
    const available = await prepared.available
    await expect.poll(() => other.paths.length).toBe(2)
    const before = [...other.paths]
    const result = await prepared.signIn({
      getFn: passkey.getFn({ origin: appOrigin }),
    })
    if ('step' in result) throw new Error('Expected the authorization.')

    expect(available).toBe(true)
    expect(before).toMatchInlineSnapshot(`
      [
        "GET /v1/realms",
        "POST /v1/auth/passkey/options",
      ]
    `)
    expect(other.paths.slice(before.length)).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/passkey/verify",
      ]
    `)
    expect(result.user.id).toBe(user.id)
    expect(
      KeyAuthorization.fromRpc(result.key.keyAuthorization).signature.type,
    ).toMatchInlineSnapshot(`"webAuthn"`)
  })

  test('keeps the options of a ceremony that sent no assertion for the next sign-in', async () => {
    const { other, passkey } = await passkeyUser()
    const prepared = Actions.passkey.prepare(other.auth)
    await prepared.available

    const canceled = await prepared
      .signIn({
        getFn: () => Promise.reject(new Error('The user canceled.')),
      })
      .catch((error: unknown) => error)
    const result = await prepared.signIn({
      getFn: passkey.getFn({ origin: appOrigin }),
    })

    expect((canceled as Error).message).toMatchInlineSnapshot(`
      "Failed to request credential.

      Details: The user canceled."
    `)
    expect('step' in result).toBe(false)
    expect(other.paths).toMatchInlineSnapshot(`
      [
        "GET /v1/realms",
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/verify",
      ]
    `)
  })

  test('gives each of two sign-ins that start together options of their own', async () => {
    const { other, passkey } = await passkeyUser()
    const prepared = Actions.passkey.prepare(other.auth)
    await prepared.available
    await expect.poll(() => other.paths.length).toBe(2)

    const getFn = passkey.getFn({ origin: appOrigin })
    const results = await Promise.all([
      prepared.signIn({ getFn }),
      prepared.signIn({ getFn }),
    ])

    expect(results.map((result) => 'step' in result)).toEqual([false, false])
    expect([...other.paths].sort()).toMatchInlineSnapshot(`
      [
        "GET /v1/realms",
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/verify",
        "POST /v1/auth/passkey/verify",
      ]
    `)
  })

  test('prepares new options after a refused assertion, since it spent the challenge', async () => {
    const { other, passkey } = await passkeyUser()
    const prepared = Actions.passkey.prepare(other.auth)
    await prepared.available

    const refused = await prepared
      .signIn({ getFn: passkey.getFn({ origin: 'https://evil.example' }) })
      .catch((error: unknown) => error)
    await expect
      .poll(() => other.paths.filter((path) => path.endsWith('/options')))
      .toHaveLength(2)
    const before = other.paths.length
    const result = await prepared.signIn({
      getFn: passkey.getFn({ origin: appOrigin }),
    })

    expect((refused as Id.RequestError).reason).toMatchInlineSnapshot(
      `"webauthn_rejected"`,
    )
    expect('step' in result).toBe(false)
    expect(other.paths.slice(0, before)).toMatchInlineSnapshot(`
      [
        "GET /v1/realms",
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/verify",
        "POST /v1/auth/passkey/options",
      ]
    `)
    expect(other.paths.slice(before)).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/passkey/verify",
      ]
    `)
  })

  test('requests no options on a page where passkeys do not sign in, and its sign-in throws what a sign-in throws', async () => {
    const client = await instance()
    const elsewhere = Client.create(server, {
      clientId: client.auth.clientId,
      origin: 'https://evil.example',
    })

    const prepared = Actions.passkey.prepare(elsewhere.auth)
    const available = await prepared.available
    const before = [...elsewhere.paths]
    const error = await prepared.signIn().catch((error: unknown) => error)

    expect(available).toBe(false)
    expect(before).toMatchInlineSnapshot(`
      [
        "GET /v1/realms",
      ]
    `)
    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"cross_site_request"`,
    )
  })
})

describe('passkey.signIn', () => {
  test('refuses a challenge without a key before it sends any request', async () => {
    const client = await instance()

    const error = await Actions.passkey
      .signIn(client.auth, {
        // A challenge rides in the access key, so the type admits none without `accessKey`.
        challenge: 'Sign in to Example' as never,
      })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.ChallengeWithoutKeyError)
    expect(client.paths).toEqual([])
  })

  test('signs in through verify, then requests the authorization, which a user without an account receives as rejected', async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email
      .signIn(client.auth, {
        code: await Harness.code(server, { email }),
        email,
      })
      .catch(() => undefined)
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, { userId: user!.id })
    const other = await instance({ clientId: client.auth.clientId })

    const error = await Actions.passkey
      .signIn(other.auth, {
        getFn: passkey.getFn({ origin: appOrigin }),
        accessKey: permissions(),
      })
      .catch((error: unknown) => error)

    expect(other.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/verify",
      ]
    `)
    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"rejected"`,
    )
    expect((error as Id.RequestError).signedIn).toBe(true)
    expect((error as Id.RequestError).message).toMatchInlineSnapshot(
      `"No Tempo Account: the user holds no account in the app's realms, and the app's first realm has no Privy app to create one. Authorize without \`key_authorization\`."`,
    )
  })

  test('throws a refusal before the sign-in unmarked, also with an earlier session in the browser', async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const [user] = await database.db
      .select()
      .from(Schema.user)
      .where(Sql.eq(Schema.user.email, email))
    const passkey = await Passkeys.create(database, {
      source: 'tempo-wallet',
      userId: user!.id,
    })

    // The assertion reports another origin than the page's, so verify refuses it before the sign-in.
    const error = await Actions.passkey
      .signIn(client.auth, {
        getFn: passkey.getFn({ origin: 'https://evil.example' }),
      })
      .catch((error: unknown) => error)

    expect((error as Id.RequestError).reason).toMatchInlineSnapshot(
      `"webauthn_rejected"`,
    )
    expect((error as Id.RequestError).signedIn).toBeFalsy()
  })

  test('returns the email step for a wallet.tempo passkey without an email, and the emailed-code sign-in links it and signs the key', async () => {
    const client = await instance()
    const email = address()
    const { credential, passkey } = Passkeys.wallet()
    await Harness.seedWallet(server, { credential, id: passkey.id })

    const result = await Actions.passkey.signIn(client.auth, {
      getFn: passkey.getFn({ origin: appOrigin }),
    })
    if (!('step' in result)) throw new Error('Expected the email step.')
    await Actions.email.sendCode(client.auth, { email })
    const authorization = await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
      getFn: passkey.getFn({ origin: appOrigin }),
      link: result.step.link,
      accessKey: permissions(),
    })

    expect(Object.keys(result.step)).toMatchInlineSnapshot(`
      [
        "link",
        "type",
      ]
    `)
    expect(result.step.type).toMatchInlineSnapshot(`"email"`)
    expect(Address.isEqual(authorization.key.account, credential.address)).toBe(
      true,
    )
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/passkey/verify",
        "POST /v1/auth/code",
        "POST /v1/auth/passkey/options",
        "POST /v1/auth/code/verify",
      ]
    `)
  })
})

describe('realm.list', () => {
  test('returns the default realm alone for an app without realms', async () => {
    const client = await instance()

    const realms = await Actions.realm.list(client.auth)

    expect(realms).toMatchInlineSnapshot(`
      [
        {
          "id": "default",
          "name": "Tempo",
        },
      ]
    `)
  })
})

describe('redirect.prefetch', () => {
  test("returns the URLs of the sign-in page's assets on Tempo ID's origin, from one request", async () => {
    const client = await instance()

    const urls = await Actions.redirect.prefetch(client.auth)

    expect(urls.length).toBeGreaterThan(0)
    expect(
      urls.filter((url) => !url.startsWith(`${Env.origin}/assets/`)),
    ).toEqual([])
    expect(client.paths).toMatchInlineSnapshot(`
      [
        "GET /v1/auth/assets",
      ]
    `)
  })
})

describe('refresh', () => {
  test('returns new tokens for the same user, with a rotated refresh token', async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const page = uncredentialed(client)
    const { pending, url } = await Actions.redirect.createUrl(page)
    const signedIn = await Actions.redirect.handleCallback(page, {
      pending,
      url: await follow(client, { url }),
    })

    const tokens = await Actions.refresh(page, {
      refreshToken: signedIn.refreshToken!,
    })

    expect(client.auth.scope).toMatchInlineSnapshot(
      `"openid email offline_access"`,
    )
    expect(Object.keys(tokens).sort()).toMatchInlineSnapshot(`
      [
        "accessToken",
        "expiresAt",
        "idToken",
        "refreshToken",
      ]
    `)
    expect(claims(tokens.accessToken).sub).toBe(signedIn.user.id)
    expect(tokens.refreshToken).toBeTypeOf('string')
    expect(tokens.refreshToken).not.toBe(signedIn.refreshToken)
  })

  test('returns one set of tokens to concurrent refreshes with one refresh token, and keeps the new refresh token valid', async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })
    const page = uncredentialed(client)
    const { pending, url } = await Actions.redirect.createUrl(page)
    const signedIn = await Actions.redirect.handleCallback(page, {
      pending,
      url: await follow(client, { url }),
    })

    // Two tabs of one session refresh at once with the stored refresh token.
    const [first, second] = await Promise.all([
      Actions.refresh(page, { refreshToken: signedIn.refreshToken! }),
      Actions.refresh(page, { refreshToken: signedIn.refreshToken! }),
    ])
    const next = await Actions.refresh(page, {
      refreshToken: first.refreshToken!,
    })

    expect(second.accessToken).toBe(first.accessToken)
    expect(second.refreshToken).toBe(first.refreshToken)
    expect(claims(next.accessToken).sub).toBe(signedIn.user.id)
    expect(next.refreshToken).not.toBe(first.refreshToken)
  })

  test('rejects a refresh token that the issuer never issued with 400 and invalid_grant', async () => {
    const client = await instance()

    const error = await Actions.refresh(client.auth, {
      refreshToken: 'unissued',
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Id.RequestError)
    expect([(error as Id.RequestError).status, (error as Id.RequestError).code])
      .toMatchInlineSnapshot(`
      [
        400,
        "invalid_grant",
      ]
    `)
  })
})

describe('signOut', () => {
  test('ends the session, so authorize returns undefined', async () => {
    const client = await instance()
    const email = address()
    await Actions.email.sendCode(client.auth, { email })
    await Actions.email.signIn(client.auth, {
      code: await Harness.code(server, { email }),
      email,
    })

    await Actions.signOut(client.auth)
    const authorization = await Actions.authorize(client.auth)

    expect(authorization).toBeUndefined()
  })
})

/** Returns a new test address, which the stand-in inbox receives. */
function address() {
  return `tempo-id-test+${crypto.randomUUID()}@example.org`
}

/** Returns the claims of a JWT, such as an access token. */
function claims(token: string) {
  return JSON.parse(Bytes.toString(Base64.toBytes(token.split('.')[1]!))) as {
    sub: string
  }
}

/** Follows the sign-in URL with `client`'s cookies to the app's callback, and returns its URL. */
async function follow(
  client: ReturnType<typeof Client.create>,
  options: { url: string },
) {
  let url = new URL(options.url)
  for (let hop = 0; hop < 5; hop++) {
    if (url.origin !== Env.origin) return url.href
    const response = await client.fetch(url, { redirect: 'manual' })
    // The harness's fetch sends `sec-fetch-mode: cors`, so Better Auth returns its redirect as JSON.
    const location =
      response.headers.get('location') ??
      ((await response.json()) as { url?: string }).url
    if (!location)
      throw new Error(`The sign-in URL returned ${response.status}.`)
    url = new URL(location, Env.origin)
  }
  throw new Error('The sign-in URL redirected too many times.')
}

/**
 * Registers a public app on {@link appOrigin} that reaches `realms`, or the default realm, and holds
 * `tempo-id:sign` with `sign`, and returns an instance for it. With `clientId`, it registers nothing.
 */
async function instance(
  options: {
    clientId?: string | undefined
    realms?: readonly string[] | undefined
    /** Whether the app holds the `tempo-id:sign` scope. */
    sign?: boolean | undefined
    skipConsent?: boolean | undefined
  } = {},
) {
  if (options.clientId)
    return Client.create(server, {
      clientId: options.clientId,
      origin: appOrigin,
    })

  const redirectUris = [`${appOrigin}/callback`]
  const clientId = await (async () => {
    if (options.skipConsent !== false) {
      const { app } = await Admin.createApp(admin, {
        name: 'Example',
        redirectUris,
        ...(options.sign ? { sign: true } : {}),
      })
      return app.clientId
    }
    // The Admin API registers only first-party apps, which skip consent.
    const clientId = crypto.randomUUID()
    await database.db.insert(Schema.oauthClient).values({
      clientId,
      grantTypes: ['authorization_code', 'refresh_token'],
      id: crypto.randomUUID(),
      redirectUris,
      responseTypes: ['code'],
      skipConsent: false,
      tokenEndpointAuthMethod: 'none',
    })
    return clientId
  })()
  if (options.realms?.length)
    await Admin.setAppRealms(admin, { clientId, realms: options.realms })
  return Client.create(server, { clientId, origin: appOrigin })
}

/**
 * Signs a new address in without an access key, and links a wallet.tempo passkey to its user. Returns the
 * passkey, the user, and a new instance of the same app, which has sent no request yet.
 */
async function passkeyUser() {
  const client = await instance()
  const email = address()
  await Actions.email.sendCode(client.auth, { email })
  await Actions.email.signIn(client.auth, {
    code: await Harness.code(server, { email }),
    email,
  })
  const [user] = await database.db
    .select()
    .from(Schema.user)
    .where(Sql.eq(Schema.user.email, email))
  if (!user) throw new Error(`No user has the address ${email}.`)
  const passkey = await Passkeys.create(database, {
    source: 'tempo-wallet',
    userId: user.id,
  })
  const other = await instance({ clientId: client.auth.clientId })
  return { other, passkey, user }
}

/**
 * Returns the permissions of an access key that each test names: OUSD's transfers, up to $1,000, for 364
 * days.
 */
function permissions() {
  return {
    expiry: Expiry.days(364),
    limits: [{ limit: 1_000_000_000n, token: ousdAddress }],
    scopes: [
      Scopes.tip20(ousdAddress).transfer(),
      Scopes.tip20(ousdAddress).transferWithMemo(),
    ],
  }
}

/** Adds a realm whose secp256k1 owners the harness holds, and returns its ID. */
async function realm() {
  const id = `cash-${crypto.randomUUID().replaceAll('-', '')}`
  await Admin.addRealm(admin, { id, name: 'Tempo Cash' })
  // The Admin API configures no secp256k1 owners.
  await Realm.setSecp256k1(database.db, { enabled: true, realmId: id })
  return id
}

/** Signs a new address in without an access key, and returns its first Tempo Account. */
async function signIn(client: ReturnType<typeof Client.create>) {
  const email = address()
  await Actions.email.sendCode(client.auth, { email })
  await Actions.email.signIn(client.auth, {
    code: await Harness.code(server, { email }),
    email,
  })
  const tempoAccount = await Actions.account.get(client.auth)
  if (!tempoAccount) throw new Error('The sign-in created no Tempo Account.')
  return tempoAccount
}

/**
 * Returns the fetch of `client` for a server that predates the authorization in the sign-in, which
 * ignores the `authorize` field of `POST /v1/auth/code/verify`. Each request first awaits `before`
 * with its path.
 */
function unauthorized(
  client: ReturnType<typeof Client.create>,
  options: { before?: ((path: string) => Promise<void>) | undefined } = {},
) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    await options.before?.(url.pathname)
    if (
      url.pathname !== '/v1/auth/code/verify' ||
      typeof init?.body !== 'string'
    )
      return client.fetch(input, init)
    const { authorize: _, ...body } = JSON.parse(init.body) as Record<
      string,
      unknown
    >
    return client.fetch(input, { ...init, body: JSON.stringify(body) })
  }) as typeof globalThis.fetch
}

/**
 * Returns the instance of `client` with a fetch that sends the page's `Origin` without cookies, as
 * a cross-origin request with default `credentials` does.
 */
function uncredentialed(client: ReturnType<typeof Client.create>) {
  return {
    ...client.auth,
    // The harness's fetch returns Miniflare's `Response`, which the global `fetch` type does not
    // name, though both have the same shape at runtime.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      const headers = new Headers(init?.headers)
      headers.set('origin', appOrigin)
      return server.fetch(`${url.pathname}${url.search}`, {
        ...(init as Parameters<typeof server.fetch>[1]),
        headers: Object.fromEntries(headers),
      })
    }) as unknown as typeof globalThis.fetch,
  }
}
