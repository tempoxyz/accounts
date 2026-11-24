/**
 * Runs guest payments against a local server that answers as Tempo ID's guest routes and as the
 * chain's RPC: the guest account that the store keeps, the transfer that it signs, the prepared
 * transactions that it refuses to sign, and the refusals before any request.
 * @module
 */
import { once } from 'node:events'
import * as Http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Address, Hash, Hex } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { http, parseUnits } from 'viem'
import { Actions } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Store from '../Store.js'
import * as AccountActions from './account.js'
import * as Guest from './guest.js'

/** MACH on Tempo mainnet. */
const mach = '0x20c000000000000000000000f37de3740adec032'

/** The recipient of each payment. */
const to = '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326'

describe('Actions.guest.pay', () => {
  test('pays from the guest account, which signs the prepared transfer', async () => {
    await using server = await serve()
    const { auth, transport } = await setup(server)

    const result = await Guest.pay(auth, {
      amount: '12.5',
      memo: 'order-123',
      to,
      token: 'mach',
      transport,
    })

    expect(result.address).toBe(await Guest.get(auth))
    // The balance and the prepared transfer load together.
    expect([...server.requests].sort()).toMatchInlineSnapshot(`
      [
        "/rpc eth_call",
        "/v1/guest/pay/prepare {"account":"<guest>","amount":"12.5","chain_id":4217,"client_id":"client_test","memo":"0x6f726465722d313233","to":"0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326"}",
        "/v1/guest/pay/send {"chain_id":4217,"client_id":"client_test","transaction":"<signed>"}",
      ]
    `)
    expect(server.sent).toMatchInlineSnapshot(`
      [
        {
          "marker": true,
          "prehash": true,
          "sender": true,
          "type": "p256",
          "valid": true,
        },
      ]
    `)
    expect(result.transaction).toBe(server.hashes[0])
  })

  test('keeps one guest account for each payment, until `disconnect` forgets it', async () => {
    await using server = await serve()
    const { auth, transport } = await setup(server)
    const options = { amount: '1', to, token: 'MACH', transport } as const

    const first = await Guest.pay(auth, options)
    const second = await Guest.pay(auth, options)
    await Guest.disconnect(auth)
    const forgotten = await Guest.get(auth)
    await Guest.pay(auth, options).catch(() => undefined)
    const created = await Guest.get(auth)

    expect(second.address).toBe(first.address)
    expect(forgotten).toBeUndefined()
    expect(created).not.toBe(first.address)
  })

  test('refuses another token, another chain, and invalid fields before any request', async () => {
    await using server = await serve()
    const { auth, transport } = await setup(server)
    const options = { amount: '1', to, token: 'mach', transport } as const

    const errors = await Promise.all(
      [
        { ...options, token: 'ousd' },
        { ...options, token: '0x20c0000000000000000000000000000000000000' },
        { ...options, chainId: 42431 },
        { ...options, amount: '0' },
        { ...options, to: '0x123' as const },
      ].map((entry) =>
        Guest.pay(auth, entry).then(
          () => undefined,
          (error: Accounts.RequestError) => ({
            field: error.field,
            reason: error.reason,
          }),
        ),
      ),
    )

    expect(errors).toMatchInlineSnapshot(`
      [
        {
          "field": "token",
          "reason": "unsupported_token",
        },
        {
          "field": "token",
          "reason": "unsupported_token",
        },
        {
          "field": "chainId",
          "reason": "invalid_chain",
        },
        {
          "field": "amount",
          "reason": "invalid_field",
        },
        {
          "field": "to",
          "reason": "invalid_field",
        },
      ]
    `)
    expect(server.requests).toMatchInlineSnapshot(`[]`)
  })

  test('signs no prepared transaction other than the requested transfer', async () => {
    await using server = await serve()
    const { auth, transport } = await setup(server)
    const transfer = (options: { amount?: bigint; to?: `0x${string}` } = {}) =>
      Actions.token.transfer.call({
        amount: options.amount ?? 1_000_000n,
        to: options.to ?? to,
        token: mach,
      })
    const envelope = {
      calls: [transfer()],
      chainId: 4217,
      feePayerSignature: null,
      gas: 100_000n,
      maxFeePerGas: 1n,
    } as const
    const prepared = [
      '0x1234',
      TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer({ to: mach })],
      }),
      TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer({ amount: 2_000_000n })],
      }),
      TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [transfer(), transfer()],
      }),
      TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [
          { ...transfer(), to: '0x20c0000000000000000000000000000000000000' },
        ],
      }),
      TxEnvelopeTempo.serialize({
        ...envelope,
        calls: [{ ...transfer(), value: 1n }],
      }),
      TxEnvelopeTempo.serialize({ ...envelope, chainId: 42431 }),
      TxEnvelopeTempo.serialize({ ...envelope, feePayerSignature: undefined }),
    ]

    const messages = []
    for (const transaction of prepared) {
      server.prepared = transaction
      messages.push(
        await Guest.pay(auth, {
          amount: '1',
          to,
          token: 'mach',
          transport,
        }).then(
          () => undefined,
          (error: Accounts.RequestError) => `${error.field}: ${error.message}`,
        ),
      )
    }

    expect(messages).toMatchInlineSnapshot(`
      [
        "transaction: Invalid prepared transaction: it is no Tempo transaction. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: its call is not the requested transfer. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: its call is not the requested transfer. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: it makes more than one call. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: its call is not the requested transfer. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: its call is not the requested transfer. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: it is for another chain. The guest account signs only the requested transfer. Try again.",
        "transaction: Invalid prepared transaction: no sponsor pays its fee. The guest account signs only the requested transfer. Try again.",
      ]
    `)
    expect(
      server.requests.filter((entry) => entry.startsWith('/v1/guest/pay/send')),
    ).toMatchInlineSnapshot(`[]`)
  })

  test('throws the refusal of the prepare as `RequestError`', async () => {
    await using server = await serve()
    const { auth, transport } = await setup(server)
    server.refusal = {
      error: 'invalid_request',
      error_description: 'Insufficient balance.',
      field: 'account',
      reason: 'insufficient_balance',
    }

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
      transport,
    }).then(
      () => undefined,
      (error: Accounts.RequestError) => error,
    )

    expect({
      field: error?.field,
      reason: error?.reason,
      status: error?.status,
    }).toMatchInlineSnapshot(`
      {
        "field": "account",
        "reason": "insufficient_balance",
        "status": 409,
      }
    `)
  })

  test('opens the purchase page for a new guest account, with no read', async () => {
    await using server = await serve()
    const auth = Accounts.from({
      clientId: 'client_test',
      store: Store.memory(),
      url: server.url,
    })

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
      transport: http(`${server.url}/rpc`),
    }).catch((error: unknown) => error)

    // Outside a page, the purchase page cannot open.
    expect(error).toBeInstanceOf(AccountActions.PageRequiredError)
    expect((error as Error).message).toMatchInlineSnapshot(
      `"No browser window: the purchase page of a guest payment opens only from a page. Pay as a guest from a page, or with a balance that holds the payment."`,
    )
    expect(server.requests).toMatchInlineSnapshot(`[]`)
    expect(await Guest.get(auth)).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('opens the purchase page for a balance below the amount, and signs nothing', async () => {
    await using server = await serve()
    const { auth, transport } = await setup(server)
    server.balance = 999_999n

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
      transport,
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(AccountActions.PageRequiredError)
    expect(
      server.requests.map((entry) => entry.slice(0, entry.indexOf(' '))).sort(),
    ).toMatchInlineSnapshot(`
      [
        "/rpc",
        "/v1/guest/pay/prepare",
      ]
    `)
  })

  test('refuses a store that keeps each value as JSON', async () => {
    const auth = Accounts.from({
      clientId: 'client_test',
      store: { ...Store.memory(), json: true },
      url: 'http://127.0.0.1:1',
    })

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(TypeError)
  })
})

/**
 * Returns the configuration and the RPC transport of a payment against `server`, with a guest
 * account. A first payment outside a page creates the guest account, and stops before the purchase
 * page.
 */
async function setup(server: { requests: string[]; url: string }) {
  const auth = Accounts.from({
    clientId: 'client_test',
    store: Store.memory(),
    url: server.url,
  })
  const transport = http(`${server.url}/rpc`)
  await Guest.pay(auth, { amount: '1', to, token: 'mach', transport }).catch(
    () => undefined,
  )
  server.requests.length = 0
  return { auth, transport }
}

/**
 * Starts a local server that answers as Tempo ID's guest routes and the chain's RPC, and returns its
 * URL and what it received. Disposing it closes the server.
 */
async function serve() {
  const state = {
    /** The guest account that the last prepare named. */
    account: undefined as string | undefined,
    /** The guest account's MACH balance, in base units. */
    balance: 100_000_000n,
    /** The hash of each transaction that the send route received. */
    hashes: [] as Hex.Hex[],
    /** A transaction that the prepare route returns in place of the requested transfer. */
    prepared: undefined as string | undefined,
    /** The error body that the prepare route answers with 409. */
    refusal: undefined as Record<string, string> | undefined,
    /** Each request, as its path and its body, with the guest account and the signed transaction elided. */
    requests: [] as string[],
    /** The checks of each signed transaction that the send route received. */
    sent: [] as Record<string, unknown>[],
  }
  const answer = async (
    request: Http.IncomingMessage,
    response: Http.ServerResponse,
  ) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >
    const reply = (status: number, value: unknown) =>
      response
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(value))

    if (request.url === '/rpc') {
      state.requests.push(`/rpc ${String(body.method)}`)
      return reply(200, {
        id: body.id,
        jsonrpc: '2.0',
        result: Hex.fromNumber(state.balance, { size: 32 }),
      })
    }
    if (request.url === '/v1/guest/pay/prepare') {
      state.requests.push(
        `/v1/guest/pay/prepare ${JSON.stringify({ ...body, account: '<guest>' })}`,
      )
      state.account = body.account as string
      if (state.refusal) return reply(409, state.refusal)
      const call = Actions.token.transfer.call({
        amount: parseUnits(body.amount as string, 6),
        memo: body.memo as Hex.Hex | undefined,
        to: body.to as Address.Address,
        token: mach,
      })
      return reply(200, {
        transaction:
          state.prepared ??
          TxEnvelopeTempo.serialize({
            calls: [call],
            chainId: body.chain_id as number,
            feePayerSignature: null,
            gas: 100_000n,
            maxFeePerGas: 1n,
            nonceKey: 1n,
            validBefore: Math.floor(Date.now() / 1000) + 290,
          }),
      })
    }
    if (request.url === '/v1/guest/pay/send') {
      state.requests.push(
        `/v1/guest/pay/send ${JSON.stringify({ ...body, transaction: '<signed>' })}`,
      )
      const serialized = body.transaction as TxEnvelopeTempo.Serialized
      const envelope = TxEnvelopeTempo.deserialize(serialized)
      const signature = envelope.signature
      const payload = TxEnvelopeTempo.getSignPayload(envelope)
      const sender =
        signature?.type === 'p256'
          ? Address.fromPublicKey(signature.publicKey)
          : undefined
      state.sent.push({
        // The sponsor's marker, a single zero byte, sits where the fee payer signs.
        marker: envelope.feePayerSignature === null,
        prehash: signature?.type === 'p256' ? signature.prehash : undefined,
        // The sender is the guest account of the prepare.
        sender:
          sender !== undefined &&
          state.account !== undefined &&
          Address.isEqual(sender, state.account as Address.Address),
        type: signature?.type,
        valid:
          signature !== undefined &&
          sender !== undefined &&
          SignatureEnvelope.verify(signature, { address: sender, payload }),
      })
      const hash = Hash.keccak256(serialized)
      state.hashes.push(hash)
      return reply(200, { transaction: hash })
    }
    reply(404, { error: 'not_found' })
  }
  // The handler answers each request once its body arrives, and a failed answer ends the connection.
  const server = Http.createServer((request, response) => {
    void answer(request, response).catch(() => response.destroy())
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  })
}
