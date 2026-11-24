/**
 * Tests guest payments without a server: the refusals before any request, the guest account that
 * the store keeps, the one signed request of a guest account that the store keeps, which a `fetch`
 * of the test answers, the refusals that lead to the purchase page, and the purchase machine, whose
 * effects each test records.
 * @module
 */
import { Address, PublicKey } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { maxUint256 } from 'viem'
import { describe, expect, test } from 'vite-plus/test'
import { createActor, fromCallback } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Accounts from '../Accounts.js'
import * as Store from '../Store.js'
import * as AccountActions from './account.js'
import * as Guest from './guest.js'
import { machines } from './guest.js'

/** The recipient of each payment. */
const to = '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326'

/** The hash that Tempo ID returns for each sent transfer. */
const hash = `0x${'ab'.repeat(32)}` as const

/**
 * The URL of a Tempo ID that no test reaches, since each call ends before a request, or a `fetch`
 * of the test answers it.
 */
const url = 'http://127.0.0.1:1'

/**
 * Returns an instance whose `fetch` answers each request to Tempo ID with `answer`, and the requests
 * that it receives, by path and body.
 */
function answering(answer: () => Response) {
  const requests: { body: Record<string, unknown>; path: string }[] = []
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      path: new URL(String(input)).pathname,
    })
    return Promise.resolve(answer())
  }
  const store = Store.memory()
  const auth = Accounts.from({ clientId: 'client_test', fetch, store, url })
  return { auth, requests, store }
}

/** Returns Tempo ID's refusal of a send with `reason`. */
function refusal(reason: Accounts.RequestError.Reason) {
  return Response.json(
    { error: 'invalid_request', error_description: 'Refused.', reason },
    { status: 409 },
  )
}

describe('Actions.guest.pay', () => {
  test('refuses another token, another chain, and invalid fields before any request', async () => {
    const { auth, requests } = answering(() => Response.json({}))
    const options = { amount: '1', to, token: 'mach' } as const

    const errors = await Promise.all(
      [
        { ...options, token: 'ousd' },
        { ...options, token: '0x20c0000000000000000000000000000000000000' },
        { ...options, chainId: 42431 },
        { ...options, amount: '0' },
        { ...options, to: '0x123' as const },
        { ...options, memo: '' },
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
        {
          "field": "memo",
          "reason": undefined,
        },
      ]
    `)
    expect(requests).toEqual([])
    expect(await Guest.get(auth)).toBeUndefined()
  })

  test('creates the guest account, and opens the purchase page only from a page, with no request', async () => {
    const { auth, requests } = answering(() =>
      Response.json({ transaction: hash }),
    )

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(AccountActions.PageRequiredError)
    expect((error as Error).message).toMatchInlineSnapshot(
      `"No browser window: the purchase page of a guest payment opens only from a page. Pay as a guest from a page, or with a balance that holds the payment."`,
    )
    expect(await Guest.get(auth)).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // A new guest account holds no MACH, so it sends nothing before the purchase page.
    expect(requests).toEqual([])
  })

  test('signs the transfer of a guest account that the store keeps, and sends it in one request', async () => {
    const { auth, requests } = answering(() =>
      Response.json({ transaction: hash }),
    )
    await Guest.pay(auth, { amount: '1', to, token: 'mach' }).catch(
      () => undefined,
    )
    const address = await Guest.get(auth)

    const before = Math.floor(Date.now() / 1000)
    const paid = await Guest.pay(auth, {
      amount: '12.5',
      memo: 'order-123',
      to,
      token: 'MACH',
    })
    const after = Math.floor(Date.now() / 1000)

    const [request] = requests
    const envelope = TxEnvelopeTempo.deserialize(
      request!.body.transaction as TxEnvelopeTempo.Serialized,
    )
    const signature = envelope.signature as SignatureEnvelope.P256
    expect(paid).toEqual({ address, transaction: hash })
    expect(requests.length).toBe(1)
    expect(request!.path).toBe('/v1/guest/pay')
    expect(Object.keys(request!.body).sort()).toMatchInlineSnapshot(`
      [
        "chain_id",
        "client_id",
        "transaction",
      ]
    `)
    expect(request!.body.chain_id).toBe(4217)
    expect(request!.body.client_id).toBe('client_test')
    expect(envelope.calls).toMatchInlineSnapshot(`
      [
        {
          "data": "0x95777d590000000000000000000000001f9090aae28b8a3dceadf281b0f12828e676c3260000000000000000000000000000000000000000000000000000000000bebc2000000000000000000000000000000000000000000000006f726465722d313233",
          "to": "0x20c000000000000000000000f37de3740adec032",
        },
      ]
    `)
    expect({
      chainId: envelope.chainId,
      feePayerSignature: envelope.feePayerSignature,
      feeToken: envelope.feeToken,
      gas: envelope.gas,
      keyAuthorization: envelope.keyAuthorization,
      maxFeePerGas: envelope.maxFeePerGas,
      maxPriorityFeePerGas: envelope.maxPriorityFeePerGas,
      nonce: envelope.nonce,
      nonceKey: envelope.nonceKey === maxUint256,
      validAfter: envelope.validAfter,
    }).toMatchInlineSnapshot(`
      {
        "chainId": 4217,
        "feePayerSignature": null,
        "feeToken": undefined,
        "gas": 100000n,
        "keyAuthorization": undefined,
        "maxFeePerGas": 40000000000n,
        "maxPriorityFeePerGas": undefined,
        "nonce": 0n,
        "nonceKey": true,
        "validAfter": undefined,
      }
    `)
    expect(envelope.validBefore! - before).toBeGreaterThanOrEqual(60)
    expect(envelope.validBefore! - after).toBeLessThanOrEqual(60)
    expect(signature.prehash).toBe(true)
    expect(Address.fromPublicKey(signature.publicKey, { checksum: true })).toBe(
      address,
    )
    expect(PublicKey.validate(signature.publicKey)).toBe(true)
  })

  test('opens the purchase page only for a refusal of the balance, and throws each other refusal', async () => {
    const rows = [
      {
        answer: () => refusal('insufficient_balance'),
        name: 'insufficient_balance',
      },
      {
        answer: () => refusal('cross_site_request'),
        name: 'cross_site_request',
      },
      { answer: () => refusal('payment_pending'), name: 'payment_pending' },
      { answer: () => refusal('payment_reverted'), name: 'payment_reverted' },
      { answer: () => refusal('rate_limited'), name: 'rate_limited' },
      {
        answer: () => refusal('recipient_not_permitted'),
        name: 'recipient_not_permitted',
      },
      { answer: () => refusal('rejected'), name: 'rejected' },
      {
        answer: () => Response.json({ transaction: '0x1234' }),
        name: 'a response without a transaction hash',
      },
    ] as const

    const results = await Promise.all(
      rows.map(async (row) => {
        const { auth, requests } = answering(row.answer)
        const options = { amount: '1', to, token: 'mach' } as const
        await Guest.pay(auth, options).catch(() => undefined)

        const error = await Guest.pay(auth, options).catch(
          (error: unknown) => error,
        )

        return {
          error:
            error instanceof Accounts.RequestError
              ? (error.reason ?? `${error.code}: ${error.field}`)
              : (error as Error).name,
          name: row.name,
          requests: requests.length,
        }
      }),
    )

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "error": "Actions.account.PageRequiredError",
          "name": "insufficient_balance",
          "requests": 1,
        },
        {
          "error": "cross_site_request",
          "name": "cross_site_request",
          "requests": 1,
        },
        {
          "error": "payment_pending",
          "name": "payment_pending",
          "requests": 1,
        },
        {
          "error": "payment_reverted",
          "name": "payment_reverted",
          "requests": 1,
        },
        {
          "error": "rate_limited",
          "name": "rate_limited",
          "requests": 1,
        },
        {
          "error": "recipient_not_permitted",
          "name": "recipient_not_permitted",
          "requests": 1,
        },
        {
          "error": "rejected",
          "name": "rejected",
          "requests": 1,
        },
        {
          "error": "server_error: transaction",
          "name": "a response without a transaction hash",
          "requests": 1,
        },
      ]
    `)
  })

  test('keeps one guest account for each payment, until `disconnect` forgets it', async () => {
    const { auth } = answering(() => refusal('insufficient_balance'))
    const options = { amount: '1', to, token: 'MACH' } as const

    await Guest.pay(auth, options).catch(() => undefined)
    const first = await Guest.get(auth)
    await Guest.pay(auth, options).catch(() => undefined)
    const kept = await Guest.get(auth)
    await Guest.disconnect(auth)
    const forgotten = await Guest.get(auth)
    await Guest.pay(auth, options).catch(() => undefined)
    const created = await Guest.get(auth)

    expect(first).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(kept).toBe(first)
    expect(forgotten).toBeUndefined()
    expect(created).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(created).not.toBe(first)
  })

  test('keeps a store that only the process holds outside a page, where no purchase page opens', async () => {
    const { auth, store } = answering(() => refusal('insufficient_balance'))

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
    }).catch((error: unknown) => error)

    expect(store.local).toBe(true)
    expect(error).toBeInstanceOf(AccountActions.PageRequiredError)
    expect(await Guest.get(auth)).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  test('refuses a store that keeps each value as JSON', async () => {
    const auth = Accounts.from({
      clientId: 'client_test',
      store: { ...Store.memory(), json: true },
      url,
    })

    const error = await Guest.pay(auth, {
      amount: '1',
      to,
      token: 'mach',
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(TypeError)
  })
})

describe('machines.purchase', () => {
  test('opens the popup at once within a gesture, and ends paid with the hash that the page returns', () => {
    const purchase = start()

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    const watching = purchase.actor.getSnapshot().value
    purchase.actor.send({ transaction: hash, type: 'popup.return' })

    expect(watching).toMatchInlineSnapshot(`"watching"`)
    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"paid"`)
    expect(purchase.actor.getSnapshot().context.transaction).toBe(hash)
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
      ]
    `)
  })

  test('offers the popup outside a gesture, and opens it at Continue after the offer closes', () => {
    const purchase = start()

    purchase.actor.send({ activated: false, type: 'purchase.start' })
    const offering = purchase.actor.getSnapshot().value
    purchase.actor.send({ type: 'offer.continue' })

    expect(offering).toMatchInlineSnapshot(`"offering"`)
    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"watching"`,
    )
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "offer.start",
        "offer.stop",
        "popup.start",
      ]
    `)
    purchase.actor.stop()
  })

  test('ends cancelled at a Cancel of either dialog or a close of the popup, and closes its effects', () => {
    const results = (
      [
        { activated: false, type: 'offer.cancel' },
        { activated: true, type: 'dialog.cancel' },
        { activated: true, type: 'popup.close' },
      ] as const
    ).map((row) => {
      const purchase = start()

      purchase.actor.send({ activated: row.activated, type: 'purchase.start' })
      purchase.actor.send({ type: row.type })

      return {
        effects: purchase.effects,
        status: machines.status(purchase.actor.getSnapshot()),
      }
    })

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "effects": [
            "offer.start",
            "offer.stop",
          ],
          "status": "cancelled",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
          ],
          "status": "cancelled",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
          ],
          "status": "cancelled",
        },
      ]
    `)
  })

  test('ends aborted at an abort before the start, and opens no popup', () => {
    const purchase = start()

    purchase.actor.send({ type: 'purchase.abort' })
    const startable = purchase.actor
      .getSnapshot()
      .can({ activated: true, type: 'purchase.start' })

    expect(startable).toBe(false)
    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"aborted"`,
    )
    expect(purchase.effects).toMatchInlineSnapshot(`[]`)
  })

  test('ends aborted at an abort in each state, and closes the effect of the state', () => {
    const offering = start()
    offering.actor.send({ activated: false, type: 'purchase.start' })
    const watching = start()
    watching.actor.send({ activated: true, type: 'purchase.start' })

    const results = [offering, watching].map(abort)

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "effects": [
            "offer.start",
            "offer.stop",
          ],
          "from": "offering",
          "status": "aborted",
        },
        {
          "effects": [
            "popup.start",
            "popup.stop",
          ],
          "from": "watching",
          "status": "aborted",
        },
      ]
    `)
  })

  test('ends blocked when the browser blocks the popup', () => {
    const purchase = start({ blocked: true })

    purchase.actor.send({ activated: true, type: 'purchase.start' })

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(
      `"blocked"`,
    )
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
      ]
    `)
  })

  test('ends failed with the refusal of the page, and closes the popup', () => {
    const purchase = start()
    const error = new Error('The user canceled the purchase.')

    purchase.actor.send({ activated: true, type: 'purchase.start' })
    purchase.actor.send({ error, type: 'popup.refuse' })

    expect(purchase.actor.getSnapshot().value).toMatchInlineSnapshot(`"failed"`)
    expect(purchase.actor.getSnapshot().context.error).toBe(error)
    expect(purchase.effects).toMatchInlineSnapshot(`
      [
        "popup.start",
        "popup.stop",
      ]
    `)
  })

  test('reaches every state along its shortest paths, handles every event type, and ends with a context that agrees with its state', () => {
    const snapshots = getShortestPaths(machines.purchase, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map(machines.status))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )
    // Only `failed` holds an error, and only `paid` a transaction.
    const disagreeing = snapshots.filter(
      (snapshot) =>
        (machines.status(snapshot) === 'failed') !==
          (snapshot.context.error !== undefined) ||
        (machines.status(snapshot) === 'paid') !==
          (snapshot.context.transaction !== undefined),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "aborted",
        "blocked",
        "cancelled",
        "failed",
        "idle",
        "offering",
        "paid",
        "watching",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
    expect(disagreeing).toEqual([])
  })

  /** The events of each type that the runner sends from a snapshot. */
  const events: {
    [type in machines.purchase.Event['type']]: (
      snapshot: machines.purchase.Snapshot,
    ) => readonly machines.purchase.Event[]
  } = {
    'dialog.cancel': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'dialog.cancel' }] : [],
    'offer.cancel': (snapshot) =>
      snapshot.matches('offering') ? [{ type: 'offer.cancel' }] : [],
    'offer.continue': (snapshot) =>
      snapshot.matches('offering') ? [{ type: 'offer.continue' }] : [],
    'popup.blocked': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'popup.blocked' }] : [],
    'popup.close': (snapshot) =>
      snapshot.matches('watching') ? [{ type: 'popup.close' }] : [],
    'popup.refuse': (snapshot) =>
      snapshot.matches('watching')
        ? [{ error: new Error('Refused.'), type: 'popup.refuse' }]
        : [],
    'popup.return': (snapshot) =>
      snapshot.matches('watching')
        ? [{ transaction: hash, type: 'popup.return' }]
        : [],
    'purchase.abort': (snapshot) =>
      snapshot.status === 'active' ? [{ type: 'purchase.abort' }] : [],
    'purchase.start': (snapshot) =>
      snapshot.matches('idle')
        ? [
            { activated: false, type: 'purchase.start' },
            { activated: true, type: 'purchase.start' },
          ]
        : [],
  }

  /** The traversal of the machine's graph. */
  const traversal = {
    events: (snapshot: machines.purchase.Snapshot) =>
      Object.values(events).flatMap((fn) => fn(snapshot)),
    serializeState: (snapshot: machines.purchase.Snapshot) =>
      JSON.stringify(snapshot.value),
  }

  /**
   * Starts a purchase, and records the start and stop of each invoked effect, in order. With
   * `blocked`, the popup reports that the browser blocked it.
   */
  function start(options: start.Options = {}) {
    const effects: string[] = []
    const actor = createActor(
      machines.purchase.provide({
        actors: {
          offer: fromCallback(() => {
            effects.push('offer.start')
            return () => effects.push('offer.stop')
          }),
          popup: fromCallback<machines.purchase.Event>((args) => {
            effects.push('popup.start')
            if (options.blocked) args.sendBack({ type: 'popup.blocked' })
            return () => effects.push('popup.stop')
          }),
        },
      }),
    ).start()

    return { actor, effects }
  }

  /** Sends `purchase.abort` to `purchase`, and returns its state before, its status, and its effects. */
  function abort(purchase: ReturnType<typeof start>) {
    const from = machines.status(purchase.actor.getSnapshot())
    purchase.actor.send({ type: 'purchase.abort' })
    return {
      effects: purchase.effects,
      from,
      status: machines.status(purchase.actor.getSnapshot()),
    }
  }
})

declare namespace start {
  type Options = {
    /** Whether the browser blocks the popup. */
    blocked?: boolean | undefined
  }
}
