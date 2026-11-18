/**
 * Runs `accounts.funding.open`, `accounts.funding.preload`, and `accounts.funding.complete`, which
 * call the actions of `Actions.funding`, outside a browser page, as a server or a CLI calls them:
 * each mode of `open` rejects before it loads the session or reads the account, `preload` loads
 * nothing, and `complete` reads only the `url` that the call passes.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Store from '../Store.js'

describe('Actions.funding.open', () => {
  test('rejects outside a browser page with Actions.funding.PageRequiredError, before it loads the session', async () => {
    // The instance holds no session, so a call that loads the session rejects with
    // `Plugins.funding.SignedOutError` instead.
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      redirectUri: 'https://app.example.com/',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const errors = await Promise.all(
      (['frame', 'popup', 'redirect'] as const).map((mode) =>
        accounts.funding.open({ mode }).then(
          () => undefined,
          (error: Error) => error.name,
        ),
      ),
    )

    expect(errors).toMatchInlineSnapshot(`
      [
        "Actions.funding.PageRequiredError",
        "Actions.funding.PageRequiredError",
        "Actions.funding.PageRequiredError",
      ]
    `)
  })
})

describe('Actions.funding.preload', () => {
  test('resolves without a load outside a browser page, also for a known address, as a server renders the page', async () => {
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      redirectUri: 'https://app.example.com/',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const results = await Promise.all([
      accounts.funding.preload(),
      accounts.funding.preload({
        address: '0x0000000000000000000000000000000000000001',
      }),
    ])

    expect(results).toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
      ]
    `)
  })
})

describe('Actions.funding.complete', () => {
  test('returns undefined outside a browser page without `url`, and reads `url` on a server', () => {
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      redirectUri: 'https://app.example.com/wallet',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const results = [
      (() => {
        try {
          return accounts.funding.complete()
        } catch (error) {
          return (error as Error).name
        }
      })(),
      accounts.funding.complete({
        url: 'https://app.example.com/wallet?deposit_status=received&deposit_amount=10',
      }),
    ]

    expect(results).toMatchInlineSnapshot(`
      [
        undefined,
        {
          "amount": "10",
          "status": "received",
        },
      ]
    `)
  })

  test('returns no `amount` for a `deposit_amount` that is no decimal, such as in a forged link', () => {
    const accounts = Accounts.create({
      clientId: 'https://app.example.com',
      redirectUri: 'https://app.example.com/wallet',
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    const results = [
      'abc',
      '<img src=x onerror=alert(1)>',
      '-5',
      '1e3',
      '25.5',
    ].map((amount) =>
      accounts.funding.complete({
        url: `https://app.example.com/wallet?deposit_status=received&deposit_amount=${encodeURIComponent(amount)}`,
      }),
    )

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "status": "received",
        },
        {
          "status": "received",
        },
        {
          "status": "received",
        },
        {
          "status": "received",
        },
        {
          "amount": "25.5",
          "status": "received",
        },
      ]
    `)
  })
})
