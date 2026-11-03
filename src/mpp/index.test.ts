/**
 * Pays MPP charges, a proof, and a session through the `mpp` plugin with an app's access key, on a
 * local Tempo node: against an mppx server in the same process, and against the API playground's
 * Worker in workerd, whose Durable Object storage holds each channel and each spent transaction.
 * @module
 */
import { AccessKey, Id, Session, Store as IdStore } from 'accounts'
import { User } from 'accounts/internal'
import { MaxAmountError, MaxAmountPrecisionError, mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { Mppx, Store, tempo } from 'mppx/server'
import { Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, http, parseUnits } from 'viem'
import {
  Account,
  Actions,
  Addresses,
  Expiry,
  Scopes,
  Selectors,
} from 'viem/tempo'
import { tempo as mainnet, tempoLocalnet } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'
import { createTestHarness } from 'wrangler'
import { ConfigurableChain } from '../../test/TempoId.js'

/** OUSD, at its mainnet address on every Tempo chain, which the API playground charges in. */
const ousd = Tokens.ousd(mainnet.id).address

/** pathUSD, which the node's faucet drips and its accounts pay fees in. */
const pathUsd = '0x20c0000000000000000000000000000000000000'

/** The TIP-1034 channel reserve, which MPP sessions open and top up channels on. */
const reserve = Scopes.contract(
  Addresses.tip20ChannelReserve,
  Selectors.tip20ChannelReserve,
)

const chain = ConfigurableChain.create({ api: false })

beforeAll(async () => {
  await chain.start()
}, 180_000)

afterAll(async () => {
  await chain.stop()
})

describe('mpp', () => {
  test('pays a charge with the access key, which the endpoint broadcasts', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch })
    const session = await signedIn({
      scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
    })
    const balance = () =>
      Actions.token
        .getBalance(client(), {
          account: endpoint.payee,
          token: pathUsd,
        })
        .then((result) => result.amount)
    const before = await balance()

    const response = await tempoId
      .mpp({ session })
      .fetch('http://mpp.test/charge')

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "path": "/charge",
      }
    `)
    expect(response.headers.has('payment-receipt')).toMatchInlineSnapshot(
      `true`,
    )
    expect((await balance()) - before).toMatchInlineSnapshot(`1000000n`)
  })

  test('signs a charge with the chain ID of its client, without an eth_chainId request', async () => {
    const endpoint = await server()
    const methods: string[] = []
    const tempoId = Id.create({
      chainId: tempoLocalnet.id,
      clientId: 'client_test',
      plugins: [
        viem({
          transport: http(ConfigurableChain.rpcUrl, {
            async onFetchRequest(request) {
              const body = (await request.clone().json()) as
                | { method: string }
                | readonly { method: string }[]
              for (const entry of Array.isArray(body) ? body : [body])
                methods.push(entry.method)
            },
          }),
        }),
        mpp({ fetch: endpoint.fetch }),
      ],
    })
    const session = await signedIn({
      scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
    })

    const response = await tempoId
      .mpp({ session })
      .fetch('http://mpp.test/charge')

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(methods.length > 0).toMatchInlineSnapshot(`true`)
    expect(methods.includes('eth_chainId')).toMatchInlineSnapshot(`false`)
  })

  test('refuses a charge above maxAmount before the access key signs', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch, maxAmount: '0.5' })
    const session = await signedIn({
      scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
    })

    const refused = tempoId.mpp({ session }).fetch('http://mpp.test/charge')

    await expect(refused).rejects.toBeInstanceOf(MaxAmountError)
    await expect(refused).rejects.toThrowErrorMatchingInlineSnapshot(
      `[mpp.MaxAmountError: The charge of 1 exceeds the \`maxAmount\` of 0.5. Raise \`maxAmount\` to pay it.]`,
    )

    // A finer `maxAmount` would round up to the charge, so the payer refuses it.
    const rounded = tempoId
      .mpp({ maxAmount: '0.9999999', session })
      .fetch('http://mpp.test/charge')

    await expect(rounded).rejects.toBeInstanceOf(MaxAmountPrecisionError)
    await expect(rounded).rejects.toThrowErrorMatchingInlineSnapshot(
      `[mpp.MaxAmountPrecisionError: Invalid \`maxAmount\`: 0.9999999 has more than 6 decimals. Round it to 6 decimals.]`,
    )

    // A call's `maxAmount` overrides the plugin's.
    const paid = await tempoId
      .mpp({ maxAmount: '1', session })
      .fetch('http://mpp.test/charge')

    expect(paid.status).toMatchInlineSnapshot(`200`)
  })

  test('refuses an empty maxAmount after an uncapped charge of the same access key', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch })
    const session = await signedIn({
      scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
    })

    // The uncapped payer of the access key is cached, and an empty `maxAmount` names another payer.
    const paid = await tempoId.mpp({ session }).fetch('http://mpp.test/charge')

    expect(paid.status).toMatchInlineSnapshot(`200`)

    const refused = tempoId
      .mpp({ maxAmount: '', session })
      .fetch('http://mpp.test/charge')

    // `parseUnits` rejects the empty value with ox's error, which viem's error class does not match.
    await expect(refused).rejects.toMatchObject({
      name: 'Value.InvalidDecimalNumberError',
    })
  })

  test('pays a charge that the app broadcasts with the mode option', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch, mode: 'push' })
    const session = await signedIn({
      scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
    })

    const response = await tempoId
      .mpp({ session })
      .fetch('http://mpp.test/charge')

    expect(response.status).toMatchInlineSnapshot(`200`)
  })

  test('proves the account with a zero-amount charge only once a transaction registers the access key', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch })
    const payer = tempoId.mpp({
      session: await signedIn({
        scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
      }),
    })

    // The endpoint verifies a proof of an access key against the chain's keychain, which holds the
    // access key only after its first transaction.
    const refused = await payer.fetch('http://mpp.test/proof')

    expect(refused.status).toMatchInlineSnapshot(`402`)
    expect(
      ((await refused.json()) as { detail: string }).detail,
    ).toMatchInlineSnapshot(
      `"Payment verification failed: Proof signature does not match source."`,
    )

    const charged = await payer.fetch('http://mpp.test/charge')
    const proven = await payer.fetch('http://mpp.test/proof')

    expect(charged.status).toMatchInlineSnapshot(`200`)
    expect(proven.status).toMatchInlineSnapshot(`200`)
  })

  test('opens a session on the channel reserve, pays each request with a voucher of the access key, and closes it', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch, maxDeposit: '0.05' })
    const manager = tempoId
      .mpp({
        session: await signedIn({ scopes: [reserve.open(), reserve.topUp()] }),
      })
      .session()

    const opened = await manager.fetch('http://mpp.test/session')
    const paid = await manager.fetch('http://mpp.test/session')

    expect(opened.status).toMatchInlineSnapshot(`200`)
    const { acceptedCumulative, intent, spent, status, units } = paid.receipt!
    expect({ acceptedCumulative, intent, spent, status, units })
      .toMatchInlineSnapshot(`
        {
          "acceptedCumulative": "20000",
          "intent": "session",
          "spent": "20000",
          "status": "success",
          "units": 2,
        }
      `)

    const closed = await manager.close()

    expect(closed?.status).toMatchInlineSnapshot(`"success"`)
  })

  test('refuses a payment without a session, and with a session without an access key', async () => {
    const tempoId = instance()
    const session = Session.from({
      accessToken: 'unused',
      expiresAt: Date.now() + 3_600_000,
      user: User.from({ email: 'ada@example.com', id: 'user_test' }),
    })

    await expect(
      tempoId.fetch('http://mpp.test/charge'),
    ).rejects.toBeInstanceOf(Id.SignedOutError)
    await expect(
      tempoId.mpp({ session }).fetch('http://mpp.test/charge'),
    ).rejects.toBeInstanceOf(Id.KeyRequiredError)
  })

  test('pays with the access key that the app supplied, for a session whose access key carries no material', async () => {
    const endpoint = await server()
    const tempoId = instance({ fetch: endpoint.fetch })
    const session = await signedIn({
      scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
    })
    const material = session.key!
    const { privateKey, ...key } = material as typeof material & {
      privateKey?: `0x${string}` | undefined
    }
    if (!privateKey) throw new Error('The access key carries no private key.')
    const bare = Session.from({ ...session, key })

    await expect(
      tempoId.mpp({ session: bare }).fetch('http://mpp.test/charge'),
    ).rejects.toBeInstanceOf(AccessKey.AccessKeyRequiredError)

    const paid = await tempoId
      .mpp({ accessKey: Account.fromSecp256k1(privateKey), session: bare })
      .fetch('http://mpp.test/charge')

    expect(paid.status).toMatchInlineSnapshot(`200`)
  })

  test('pays with the stored session of an instance that has not read its session, as after a reload', async () => {
    const endpoint = await server()
    const memory = IdStore.memory()
    const saved = Promise.withResolvers<void>()
    // Resolves once the first instance saves the session.
    const store = IdStore.from({
      ...memory,
      async setItem(key, value, options) {
        await memory.setItem(key, value, options)
        saved.resolve()
      },
    })
    const first = instance({}, store)
    await first.session.get()
    first.session.actor!.send({
      session: await signedIn({
        scopes: [Scopes.tip20(pathUsd).transferWithMemo()],
      }),
      type: 'set',
    })
    await saved.promise

    const paid = await instance({ fetch: endpoint.fetch }, store).fetch(
      'http://mpp.test/charge',
    )

    expect(paid.status).toMatchInlineSnapshot(`200`)
  })
})

describe('with the API playground', () => {
  const harness = createTestHarness({
    workers: [
      {
        configPath: 'accounts/playgrounds/api/wrangler.jsonc',
        secrets: {
          MPP_PRIVATE_KEY:
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
          MPP_SECRET_KEY: 'tempo-id-test-mpp-secret-at-least-32-bytes',
          TEMPO_RPC_URL: ConfigurableChain.rpcUrl,
        },
      },
    ],
  })
  let url: URL

  beforeAll(async () => {
    url = new URL((await harness.listen()).url)
  }, 180_000)

  afterAll(async () => {
    await harness.close()
  })

  describe('/mpp/charge', () => {
    test('serves the content for a pushed charge once, and refuses the same credential again', async () => {
      const credentials: string[] = []
      const tempoId = instance({
        // Records the credential of each paid request.
        fetch: (input, init) => {
          const credential = new Headers(init?.headers).get('authorization')
          if (credential) credentials.push(credential)
          return fetch(input, init)
        },
      })
      const session = await signedIn({
        scopes: [Scopes.tip20(ousd).transferWithMemo()],
        token: ousd,
      })

      const paid = await tempoId
        .mpp({ mode: 'push', session })
        .fetch(new URL('/mpp/charge', url))

      expect(paid.status).toMatchInlineSnapshot(`200`)
      expect(await paid.json()).toMatchInlineSnapshot(`
        {
          "fortune": "Your code compiles on the first try.",
        }
      `)
      expect(credentials).toHaveLength(1)

      const replayed = await fetch(new URL('/mpp/charge', url), {
        headers: { authorization: credentials[0]! },
      })

      expect(replayed.status).toMatchInlineSnapshot(`402`)
      expect(
        ((await replayed.json()) as { detail: string }).detail,
      ).toMatchInlineSnapshot(
        `"Payment verification failed: Transaction hash has already been used."`,
      )
    })
  })

  describe('/mpp/session', () => {
    test('pays each request of a session with a voucher of the access key, and closes the channel', async () => {
      const session = await signedIn({
        scopes: [reserve.open(), reserve.topUp()],
        token: ousd,
      })
      const manager = instance()
        .mpp({ session })
        .session({ maxDeposit: '0.05' })

      const opened = await manager.fetch(new URL('/mpp/session', url))
      const paid = await manager.fetch(new URL('/mpp/session', url))

      expect(opened.status).toMatchInlineSnapshot(`200`)
      expect(await paid.json()).toMatchInlineSnapshot(`
        {
          "content": "Paid with a voucher.",
        }
      `)
      const { acceptedCumulative, spent, status, units } = paid.receipt!
      expect({ acceptedCumulative, spent, status, units })
        .toMatchInlineSnapshot(`
        {
          "acceptedCumulative": "20000",
          "spent": "20000",
          "status": "success",
          "units": 2,
        }
      `)

      const closed = await manager.close()

      expect(closed?.status).toMatchInlineSnapshot(`"success"`)
    })
  })
})

/**
 * Returns a client of the node. It comes from this package's Viem, whose types the mppx server and
 * Viem's actions name, and not the checkout's.
 */
function client() {
  return createClient({
    chain: tempoLocalnet,
    transport: http(ConfigurableChain.rpcUrl),
  })
}

/** Returns an instance on the local node with the `mpp` plugin and `options`, on `store`. */
function instance(options: mpp.Options = {}, store?: IdStore.Store) {
  return Id.create({
    chainId: tempoLocalnet.id,
    clientId: 'client_test',
    ...(store ? { store } : {}),
    plugins: [
      viem({ transport: http(ConfigurableChain.rpcUrl) }),
      mpp(options),
    ],
  })
}

/**
 * Returns an mppx server in this process, whose `fetch` serves a charge of 1 pathUSD at `/charge`,
 * a proof at `/proof`, and 0.01 pathUSD for each request of a session at `/session`, to a funded
 * payee.
 */
async function server() {
  const payee = Account.fromSecp256k1(Secp256k1.randomPrivateKey())
  await ConfigurableChain.fund({ address: payee.address })
  const payment = Mppx.create({
    methods: [
      tempo.charge({
        chainId: tempoLocalnet.id,
        currency: pathUsd,
        getClient: client,
        recipient: payee.address,
      }),
      tempo.session({
        account: payee,
        chainId: tempoLocalnet.id,
        currency: pathUsd,
        getClient: client,
        store: Store.memory(),
      }),
    ],
    realm: 'mpp.test',
    secretKey: crypto.randomUUID(),
  })

  async function handle(request: Request) {
    const path = new URL(request.url).pathname
    const result = await (() => {
      if (path === '/session')
        return payment.tempo.session({ amount: '0.01', unitType: 'request' })(
          request,
        )
      return payment.tempo.charge({ amount: path === '/proof' ? '0' : '1' })(
        request,
      )
    })()
    if (result.status === 402) return result.challenge
    return result.withReceipt(Response.json({ path }))
  }

  return {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handle(new Request(input, init))) as typeof globalThis.fetch,
    payee: payee.address,
  }
}

/**
 * Returns a session whose access key belongs to a funded account on the node, authorized for a day
 * with 10 of `token` and `scopes`, as a sign-in stores it.
 */
async function signedIn(options: {
  /** The calls that the access key may make. */
  scopes: KeyAuthorization.KeyAuthorization['scopes']
  /** The token of the access key's limit. Defaults to pathUSD. */
  token?: `0x${string}` | undefined
}) {
  const root = Account.fromSecp256k1(Secp256k1.randomPrivateKey())
  await ConfigurableChain.fund({ address: root.address })

  const privateKey = Secp256k1.randomPrivateKey()
  const keyAuthorization = await root.signKeyAuthorization(
    Account.fromSecp256k1(privateKey, { access: root }),
    {
      chainId: BigInt(tempoLocalnet.id),
      expiry: Expiry.days(1),
      limits: [{ limit: parseUnits('10', 6), token: options.token ?? pathUsd }],
      scopes: options.scopes,
    },
  )
  return Session.from({
    accessToken: 'unused',
    expiresAt: Date.now() + 3_600_000,
    key: AccessKey.from({
      account: root.address,
      keyAuthorization: KeyAuthorization.toRpc(keyAuthorization),
      privateKey,
    }),
    user: User.from({ email: 'ada@example.com', id: 'user_test' }),
  })
}
