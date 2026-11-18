/**
 * Tests the decisions of the limit retry: the amount that a refusal names, the limits that count
 * toward it, and whether a new access key with the same limits can send it. Tests also the retry of a send after a fix, once for each
 * kind of failure.
 * @module
 */
import { custom, http, type Transport } from 'viem'
import { Actions } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import { AccessKeyRequiredError } from '../../Accounts.js'
import { AccessKeyExpiredError } from '../../plugins/viem.js'
import * as Retry from './Retry.js'

const accessKey = '0x0000000000000000000000000000000000000001'

const pathUsd = '0x20c0000000000000000000000000000000000000'

const otherToken = '0x20c0000000000000000000000000000000000001'

/** Returns Viem's error of a spent limit, with `fields`. */
function limitError(fields: {
  amount?: bigint | undefined
  fee: boolean
  token?: `0x${string}` | undefined
}) {
  return new Actions.accessKey.AccessKeySpendingLimitExceededError({
    ...fields,
    accessKey,
    account: accessKey,
    cause: new Error('Execution reverted.'),
    hints: [],
    error: {
      errorName: 'SpendingLimitExceeded',
      message: 'Spending limit exceeded.',
    },
  } as never)
}

describe('attempt', () => {
  /** Returns a send that rejects with each of `failures` in order, then resolves with `'paid'`. */
  function sender(failures: readonly Retry.Failure[]) {
    const sends = { count: 0 }
    return {
      send: () => {
        const failure = failures[sends.count++]
        if (failure)
          return Promise.reject(
            Object.assign(new Error(failure.kind), { failure }),
          )
        return Promise.resolve('paid')
      },
      sends,
    }
  }

  /** Returns the failure that {@link sender} attached to `error`. */
  function classify(error: unknown) {
    return (error as { failure?: Retry.Failure | undefined }).failure
  }

  test('sends again once the fix of a failure resolves', async () => {
    const { send, sends } = sender([{ amount: '0.01', kind: 'balance' }])
    const fixes: Retry.Failure[] = []

    const result = await Retry.attempt(send, {
      classify,
      enabled: () => true,
      fix: (failure) => {
        fixes.push(failure)
        return Promise.resolve()
      },
      signal: undefined,
    })

    expect(result).toMatchInlineSnapshot(`"paid"`)
    expect(sends.count).toMatchInlineSnapshot(`2`)
    expect(fixes).toMatchInlineSnapshot(`
      [
        {
          "amount": "0.01",
          "kind": "balance",
        },
      ]
    `)
  })

  test('rejects with the second failure of one kind, after one fix', async () => {
    const { send, sends } = sender([{ kind: 'balance' }, { kind: 'balance' }])
    const fixes: Retry.Kind[] = []

    const error = await Retry.attempt(send, {
      classify,
      enabled: () => true,
      fix: (failure) => {
        fixes.push(failure.kind)
        return Promise.resolve()
      },
      signal: undefined,
    }).catch((error: Error) => error.message)

    expect(error).toMatchInlineSnapshot(`"balance"`)
    expect(sends.count).toMatchInlineSnapshot(`2`)
    expect(fixes).toMatchInlineSnapshot(`
      [
        "balance",
      ]
    `)
  })

  test('fixes a failure of another kind after the first fix', async () => {
    const { send, sends } = sender([{ kind: 'limit' }, { kind: 'balance' }])
    const fixes: Retry.Kind[] = []

    const result = await Retry.attempt(send, {
      classify,
      enabled: () => true,
      fix: (failure) => {
        fixes.push(failure.kind)
        return Promise.resolve()
      },
      signal: undefined,
    })

    expect(result).toMatchInlineSnapshot(`"paid"`)
    expect(sends.count).toMatchInlineSnapshot(`3`)
    expect(fixes).toMatchInlineSnapshot(`
      [
        "limit",
        "balance",
      ]
    `)
  })

  test('rejects a failure of a disabled kind as it is, without a fix', async () => {
    const { send, sends } = sender([{ kind: 'limit' }])
    const fixes: Retry.Kind[] = []

    const error = await Retry.attempt(send, {
      classify,
      enabled: (kind) => kind === 'balance',
      fix: (failure) => {
        fixes.push(failure.kind)
        return Promise.resolve()
      },
      signal: undefined,
    }).catch((error: Error) => error.message)

    expect(error).toMatchInlineSnapshot(`"limit"`)
    expect(sends.count).toMatchInlineSnapshot(`1`)
    expect(fixes).toMatchInlineSnapshot(`[]`)
  })

  test('rejects with the reason of a signal that aborts during the fix, and sends nothing more', async () => {
    const { send, sends } = sender([{ kind: 'balance' }])
    const controller = new AbortController()

    const error = await Retry.attempt(send, {
      classify,
      enabled: () => true,
      fix: () => {
        controller.abort(new Error('The page left.'))
        return Promise.resolve()
      },
      signal: controller.signal,
    }).catch((error: Error) => error.message)

    expect(error).toMatchInlineSnapshot(`"The page left."`)
    expect(sends.count).toMatchInlineSnapshot(`1`)
  })
})

describe('create', () => {
  test('names no error of a failure that its transport did not mark, since the node may have taken the transaction', () => {
    const retry = Retry.create()

    expect(
      retry.errorName(limitError({ amount: 1n, fee: false, token: pathUsd })),
    ).toBe(undefined)
  })
  test("reads the page's refusal of an expired access key in the causes as an access key failure, which the node did not answer", () => {
    const retry = Retry.create()

    expect(
      retry.classify(
        new Error('Fill failed.', { cause: new AccessKeyExpiredError() }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "kind": "accessKey",
      }
    `)
  })
})

describe('refused', () => {
  test('returns the amount and token of the limit error', () => {
    expect(
      Retry.refused(limitError({ amount: 5n, fee: false, token: pathUsd })),
    ).toMatchInlineSnapshot(`
      {
        "amount": 5n,
        "token": "0x20c0000000000000000000000000000000000000",
      }
    `)
  })

  test('returns the amount and token of the limit error in the causes', () => {
    const error = new Error('Execution reverted.', {
      cause: limitError({ amount: 5n, fee: false, token: pathUsd }),
    })

    expect(Retry.refused(error)).toMatchInlineSnapshot(`
      {
        "amount": 5n,
        "token": "0x20c0000000000000000000000000000000000000",
      }
    `)
  })

  test('returns null for a refusal of the fee payment', () => {
    expect(
      Retry.refused(limitError({ amount: 5n, fee: true, token: pathUsd })),
    ).toMatchInlineSnapshot(`null`)
  })

  test('returns null for a limit error without an amount', () => {
    expect(
      Retry.refused(limitError({ fee: false, token: pathUsd })),
    ).toMatchInlineSnapshot(`null`)
  })

  test('returns undefined without a limit error', () => {
    expect(
      Retry.refused(new Error('Execution reverted.')),
    ).toMatchInlineSnapshot(`undefined`)
  })

  // A tree-shakable action, such as `transferSync` of `wagmi/tempo`, sends the call's `to` and
  // `data` through the client's `sendTransactionSync`, whose refusal holds no limit error.
  test("returns the TIP-20 transfer of a transaction request without Viem's error", () => {
    const { data, to } = Actions.token.transfer.call({
      amount: 150_000_000n,
      to: accessKey,
      token: pathUsd,
    })

    expect(
      Retry.refused(new Error('Execution reverted.'), {
        parameters: { data, to },
      }),
    ).toMatchInlineSnapshot(`
      {
        "amount": 150000000n,
        "token": "0x20c0000000000000000000000000000000000000",
      }
    `)
  })

  test('returns the TIP-20 transfer with a memo of the one call of a transaction request', () => {
    const call = Actions.token.transfer.call({
      amount: 150_000_000n,
      memo: '0x01',
      to: accessKey,
      token: pathUsd,
    })

    expect(
      Retry.refused(new Error('Execution reverted.'), {
        parameters: { calls: [{ data: call.data, to: call.to }] },
      }),
    ).toMatchInlineSnapshot(`
      {
        "amount": 150000000n,
        "token": "0x20c0000000000000000000000000000000000000",
      }
    `)
  })

  test("returns undefined for a transfer from another account, which spends none of the access key's limit", () => {
    const { data, to } = Actions.token.transfer.call({
      amount: 150_000_000n,
      from: accessKey,
      to: accessKey,
      token: pathUsd,
    })

    expect(
      Retry.refused(new Error('Execution reverted.'), {
        parameters: { data, to },
      }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test("returns the TIP-20 transfer of a call in its ABI form, as wagmi's writeContractSync passes it", () => {
    const { abi, address, args, functionName } = Actions.token.transfer.call({
      amount: 150_000_000n,
      to: accessKey,
      token: pathUsd,
    })

    expect(
      Retry.refused(new Error('Execution reverted.'), {
        parameters: { abi, address, args, functionName },
      }),
    ).toMatchInlineSnapshot(`
      {
        "amount": 150000000n,
        "token": "0x20c0000000000000000000000000000000000000",
      }
    `)
  })

  test('returns undefined for a call in its ABI form of another function', () => {
    expect(
      Retry.refused(new Error('Execution reverted.'), {
        parameters: {
          address: pathUsd,
          args: [accessKey, 150_000_000n],
          functionName: 'approve',
        },
      }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test("returns null for a refusal of the fee payment, whatever the transaction request's transfer", () => {
    const { data, to } = Actions.token.transfer.call({
      amount: 150_000_000n,
      to: accessKey,
      token: pathUsd,
    })

    expect(
      Retry.refused(limitError({ fee: true, token: pathUsd }), {
        parameters: { data, to },
      }),
    ).toMatchInlineSnapshot(`null`)
  })
})

describe('counted', () => {
  // An app's own limit of a stablecoin that no scope calls pays only network fees.
  const authorization = {
    allowedCalls: [{ target: otherToken }],
    limits: [
      { limit: '0x1e8480', token: otherToken },
      { limit: '0xf4240', token: pathUsd },
    ],
  } as const

  test('leaves out a limit that pays only network fees for a refusal that names a spend', () => {
    expect(
      Retry.counted(authorization, {
        refused: { amount: 5n, token: otherToken },
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "limit": "0x1e8480",
          "token": "0x20c0000000000000000000000000000000000001",
        },
      ]
    `)
  })

  test('returns each limit for a refusal of the fee payment', () => {
    expect(Retry.counted(authorization, { refused: null }))
      .toMatchInlineSnapshot(`
      [
        {
          "limit": "0x1e8480",
          "token": "0x20c0000000000000000000000000000000000001",
        },
        {
          "limit": "0xf4240",
          "token": "0x20c0000000000000000000000000000000000000",
        },
      ]
    `)
  })

  test("returns each limit for a refusal without Viem's error, which can be one of the fee payment", () => {
    expect(
      Retry.counted(authorization, {
        refused: Retry.refused(new Error('Execution reverted.')),
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "limit": "0x1e8480",
          "token": "0x20c0000000000000000000000000000000000001",
        },
        {
          "limit": "0xf4240",
          "token": "0x20c0000000000000000000000000000000000000",
        },
      ]
    `)
  })

  test('returns no limit for an access key without limits', () => {
    expect(
      Retry.counted(
        { allowedCalls: [{ target: otherToken }] },
        { refused: null },
      ),
    ).toMatchInlineSnapshot(`[]`)
  })
})

describe('within', () => {
  const limits = [{ limit: 100_000_000n, token: pathUsd }] as const

  test('returns true for an amount below the whole limit', () => {
    expect(
      Retry.within(limits, { parameters: { amount: 1n, token: pathUsd } }),
    ).toMatchInlineSnapshot(`true`)
  })

  test('returns true for an amount equal to the whole limit', () => {
    expect(
      Retry.within(limits, {
        parameters: { amount: 100_000_000n, token: pathUsd },
      }),
    ).toMatchInlineSnapshot(`true`)
  })

  test('returns false for an amount above the whole limit', () => {
    expect(
      Retry.within(limits, {
        parameters: { amount: 101_000_000n, token: pathUsd },
      }),
    ).toMatchInlineSnapshot(`false`)
  })

  test('returns false for an amount whose fees take it above the whole limit', () => {
    expect(
      Retry.within(limits, {
        fees: 100_000n,
        parameters: { amount: 99_900_001n, token: pathUsd },
      }),
    ).toMatchInlineSnapshot(`false`)
  })

  test('returns true for an amount whose fees fill the whole limit', () => {
    expect(
      Retry.within(limits, {
        fees: 100_000n,
        parameters: { amount: 99_900_000n, token: pathUsd },
      }),
    ).toMatchInlineSnapshot(`true`)
  })

  test('reads a hex limit of an authorization in its RPC form', () => {
    expect(
      Retry.within([{ limit: '0x5f5e100', token: pathUsd }], {
        parameters: { amount: 101_000_000n, token: pathUsd },
      }),
    ).toMatchInlineSnapshot(`false`)
  })

  test('returns undefined for a token that the access key does not limit', () => {
    expect(
      Retry.within(limits, { parameters: { amount: 1n, token: otherToken } }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test('returns undefined for a call without an amount', () => {
    expect(
      Retry.within(limits, { parameters: { token: pathUsd } }),
    ).toMatchInlineSnapshot(`undefined`)
  })

  test('returns undefined for a refusal that names no amount', () => {
    expect(Retry.within(limits, { parameters: null })).toMatchInlineSnapshot(
      `undefined`,
    )
  })
})

describe('renewal', () => {
  test('commits a kept renewal', () => {
    expect(
      Retry.renewal({
        aborted: false,
        issued: true,
        kept: true,
        overtaken: false,
        replaced: false,
      }),
    ).toMatchInlineSnapshot(`
      {
        "action": "commit",
        "revoke": false,
      }
    `)
  })

  test("commits a kept renewal that another chain's retry overtook, since the chain's access key stays", () => {
    expect(
      Retry.renewal({
        aborted: false,
        issued: true,
        kept: true,
        overtaken: true,
        replaced: false,
      }),
    ).toMatchInlineSnapshot(`
      {
        "action": "commit",
        "revoke": false,
      }
    `)
  })

  test('rejects a kept renewal after the signal aborted, and revokes it', () => {
    expect(
      Retry.renewal({
        aborted: true,
        issued: true,
        kept: true,
        overtaken: false,
        replaced: false,
      }),
    ).toMatchInlineSnapshot(`
      {
        "action": "abort",
        "revoke": true,
      }
    `)
  })

  test("supersedes a renewal after a change that replaced the chain's access key, which its change ends", () => {
    expect(
      Retry.renewal({
        aborted: true,
        issued: true,
        kept: true,
        overtaken: true,
        replaced: true,
      }),
    ).toMatchInlineSnapshot(`
      {
        "action": "supersede",
        "revoke": false,
      }
    `)
  })

  test('falls back to the sign-in for a renewal of another user, and revokes it', () => {
    expect(
      Retry.renewal({
        aborted: false,
        issued: true,
        kept: false,
        overtaken: false,
        replaced: false,
      }),
    ).toMatchInlineSnapshot(`
      {
        "action": "fallback",
        "revoke": true,
      }
    `)
  })

  test('falls back to the sign-in without a renewal, and revokes nothing', () => {
    expect(
      Retry.renewal({
        aborted: true,
        issued: false,
        kept: false,
        overtaken: false,
        replaced: false,
      }),
    ).toMatchInlineSnapshot(`
      {
        "action": "fallback",
        "revoke": false,
      }
    `)
  })
})

describe('wrap', () => {
  /**
   * Returns the options of a wrap whose target sends through `transport`, and whose fix resolves,
   * and adds its failure's kind to `fixes`.
   */
  function fixing(fixes: Retry.Kind[], transport: Transport | undefined) {
    return {
      enabled: () => true,
      fix: (failure: Retry.Failure) => {
        fixes.push(failure.kind)
        return Promise.resolve()
      },
      signal: undefined,
      skip: new Set<string>(),
      snapshot: () => undefined,
      transport,
    }
  }

  /** Returns the send of a raw transaction through `transport`, a transport of a retry. */
  function sending(transport: Transport) {
    const { request } = transport({})
    return (raw: `0x${string}`) =>
      request({ method: 'eth_sendRawTransaction', params: [raw] })
  }

  test('rejects a failure after the node took a transaction of the call, and sends none again', async () => {
    const retry = Retry.create()
    const sent: unknown[] = []
    const transport = retry.transport(
      // An RPC that records each request that reaches it, and answers it.
      custom(
        {
          request(args) {
            sent.push(args.params)
            return Promise.resolve('0x')
          },
        },
        { retryCount: 0 },
      ),
    )
    const send = sending(transport)
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        // An action of two transactions, whose account signs no second one without an access key.
        configure: async () => {
          await send('0x01')
          throw new AccessKeyRequiredError()
        },
      },
      fixing(fixes, transport),
    )

    const error = await client.configure().catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(sent).toMatchInlineSnapshot(`
      [
        [
          "0x01",
        ],
      ]
    `)
    expect(fixes).toMatchInlineSnapshot(`[]`)
  })

  test('rejects a failure after a transaction of the call got no answer, without a fix', async () => {
    const retry = Retry.create()
    // A closed port: a transaction that the call sends gets no answer.
    const transport = retry.transport(
      http('http://127.0.0.1:9', { retryCount: 0 }),
    )
    const send = sending(transport)
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        // An action that continues after a failure of its first transaction.
        configure: async () => {
          await send('0x01').catch(() => undefined)
          throw new AccessKeyRequiredError()
        },
      },
      fixing(fixes, transport),
    )

    const error = await client.configure().catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(fixes).toMatchInlineSnapshot(`[]`)
  })

  test('rejects a failure while a transaction of the call waits for its answer, and sends none again', async () => {
    const retry = Retry.create()
    const gate = Promise.withResolvers<string>()
    const sent: unknown[] = []
    const transport = retry.transport(
      // An RPC that records each request that reaches it, and answers it once the gate opens.
      custom(
        {
          request(args) {
            sent.push(args.params)
            return gate.promise
          },
        },
        { retryCount: 0 },
      ),
    )
    const send = sending(transport)
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        // An action of two transactions at once, whose account signs no second one without an
        // access key.
        configure: () =>
          Promise.all([
            send('0x01'),
            Promise.reject(new AccessKeyRequiredError()),
          ]),
      },
      fixing(fixes, transport),
    )

    const result = client.configure().catch((error: Error) => error.name)
    await expect.poll(() => sent.length).toBe(1)
    gate.resolve('0x')
    const error = await result

    expect(error).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(sent).toMatchInlineSnapshot(`
      [
        [
          "0x01",
        ],
      ]
    `)
    expect(fixes).toMatchInlineSnapshot(`[]`)
  })

  test('rejects a failure after the node took a transaction of the call and ended its wait for the receipt, and sends none again', async () => {
    const retry = Retry.create()
    const sent: unknown[] = []
    const transport = retry.transport(
      // An RPC that records each request that reaches it, and answers it with the timeout of
      // `eth_sendRawTransactionSync`: the node took the transaction, and holds no receipt yet.
      custom(
        {
          request(args) {
            sent.push(args.params)
            return Promise.reject(
              Object.assign(new Error('The receipt timed out.'), { code: 4 }),
            )
          },
        },
        { retryCount: 0 },
      ),
    )
    const { request } = transport({})
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        // An action that continues after the timeout of its first transaction, as Viem does.
        configure: async () => {
          await request({
            method: 'eth_sendRawTransactionSync',
            params: ['0x01'],
          }).catch(() => undefined)
          throw new AccessKeyRequiredError()
        },
      },
      fixing(fixes, transport),
    )

    const error = await client.configure().catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(sent).toMatchInlineSnapshot(`
      [
        [
          "0x01",
        ],
      ]
    `)
    expect(fixes).toMatchInlineSnapshot(`[]`)
  })

  test('fixes a failure after the node refused a transaction of the call, and sends it again', async () => {
    const retry = Retry.create()
    const sent: unknown[] = []
    const transport = retry.transport(
      // An RPC that records each request that reaches it, and refuses it with a JSON-RPC error.
      custom(
        {
          request(args) {
            sent.push(args.params)
            return Promise.reject(
              Object.assign(new Error('Transaction rejected.'), {
                code: -32003,
              }),
            )
          },
        },
        { retryCount: 0 },
      ),
    )
    const send = sending(transport)
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        // An action that continues after a failure of its first transaction.
        configure: async () => {
          await send('0x01').catch(() => undefined)
          throw new AccessKeyRequiredError()
        },
      },
      fixing(fixes, transport),
    )

    const error = await client.configure().catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(sent).toMatchInlineSnapshot(`
      [
        [
          "0x01",
        ],
        [
          "0x01",
        ],
      ]
    `)
    expect(fixes).toMatchInlineSnapshot(`
      [
        "accessKey",
      ]
    `)
  })

  test('fixes a failure during the transactions of another transport of the retry, and sends again', async () => {
    const retry = Retry.create()
    const failure = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<string>()
    const sent: unknown[] = []
    const transport = retry.transport(
      // An RPC that records each request that reaches it, and answers it.
      custom(
        {
          request(args) {
            sent.push(args.params)
            return Promise.resolve('0x')
          },
        },
        { retryCount: 0 },
      ),
    )
    const send = sending(transport)
    // The transport of another client, such as one of another chain.
    const other = sending(
      retry.transport(
        // An RPC that answers `0x02`, and each other request once the gate opens.
        custom(
          {
            request(args) {
              const [raw] = args.params as readonly string[]
              return raw === '0x02' ? Promise.resolve('0x') : gate.promise
            },
          },
          { retryCount: 0 },
        ),
      ),
    )
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        // An action of one transaction, whose account signs none before the fix.
        transfer: async () => {
          if (fixes.length > 0) return await send('0x01')
          await failure.promise
          throw new AccessKeyRequiredError()
        },
      },
      fixing(fixes, transport),
    )

    const result = client.transfer()
    // The node takes one transaction of the other transport during the call, and holds the answer
    // of a second one past the call's failure.
    await other('0x02')
    const pending = other('0x03')
    failure.resolve()
    await expect.poll(() => fixes.length).toBe(1)
    const hash = await result
    gate.resolve('0x')
    await pending

    expect(hash).toMatchInlineSnapshot(`"0x"`)
    expect(sent).toMatchInlineSnapshot(`
      [
        [
          "0x01",
        ],
      ]
    `)
    expect(fixes).toMatchInlineSnapshot(`
      [
        "accessKey",
      ]
    `)
  })

  test('rejects a failure of a target without the transport that it sends through, without a fix', async () => {
    const retry = Retry.create()
    const fixes: Retry.Kind[] = []
    const client = retry.wrap(
      {
        account: undefined,
        sendTransaction: () => Promise.reject(new AccessKeyRequiredError()),
      },
      fixing(fixes, undefined),
    )

    const error = await client
      .sendTransaction()
      .catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(fixes).toMatchInlineSnapshot(`[]`)
  })

  test('requests an access key for a send without one, and rejects a message signature as it is', async () => {
    const retry = Retry.create()
    const fixes: string[] = []
    const client = retry.wrap(
      {
        account: undefined,
        sendTransaction: () => Promise.reject(new AccessKeyRequiredError()),
        signMessage: () => Promise.reject(new AccessKeyRequiredError()),
      },
      {
        enabled: () => true,
        fix: (failure) => {
          fixes.push(failure.kind)
          return Promise.reject(new Error('The dialog closed.'))
        },
        signal: undefined,
        skip: new Set(),
        snapshot: () => undefined,
        transport: retry.transport(http('http://127.0.0.1:9')),
      },
    )

    const signed = await client
      .signMessage()
      .catch((error: Error) => error.name)
    const sent = await client
      .sendTransaction()
      .catch((error: Error) => error.message)

    expect(signed).toMatchInlineSnapshot(`"Accounts.AccessKeyRequiredError"`)
    expect(sent).toMatchInlineSnapshot(`"The dialog closed."`)
    expect(fixes).toMatchInlineSnapshot(`
      [
        "accessKey",
      ]
    `)
  })
})
