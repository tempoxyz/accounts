/**
 * Tests the sponsored page of the backend test app: a page that holds its own session, and whose
 * sponsorship requests go to a relay route of the app's backend with the session's access token.
 * Covers the relay with the app's own fee payer, the relay through the Tempo API, the relays that
 * sponsor nothing, the requests that a relay refuses, and the backend's read of a page's access
 * token. The node names the account that paid each transaction's fees.
 * @module
 */
import type { Page } from '@playwright/test'
import { parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as TempoApi from '../TempoApi.js'
import * as Web from '../Web.js'

/** The session of the sponsored page, as its "Sign in" control returns it. */
type Session = {
  /** The Tempo Account of the session's access key. */
  account: `0x${string}`
  /** The access key's address. */
  key: `0x${string}`
}

/**
 * The time to wait for a transfer whose relay route calls the Tempo API, in milliseconds. The first
 * request of a run took 4.6 seconds in the job, close to the timeout of an assertion.
 */
const apiTimeout = 20_000

/** The address of the account that pays the fees of the Worker's own relay routes. */
const feePayer = privateKeyToAddress(Apps.backend.feePayer)

/** The URL of the route that relays with the Worker's own fee payer. */
const relayUrl = `${Apps.backend.url}/page/relay`

/** Returns the OUSD that the node holds for `address`, in base units. */
function balance(address: `0x${string}`) {
  return Chain.balance({ address, token: Chain.ousd })
}

/**
 * Signs `email` in on the sponsored page through the dialog's frame, as the first step of a test.
 * With `options.relay`, the page sends its sponsorship requests to that route. The faucet funds the
 * Tempo Account unless `options.fund` is `false`. Returns the session.
 */
function enter(page: Page, options: enter.Options): Promise<Session> {
  const { capture, code, email, fund = true, relay } = options
  return test.step('signs in through the dialog, on a page that holds its own session', async () => {
    const query = relay ? `?${new URLSearchParams({ relay })}` : ''
    await page.goto(
      `${Apps.backend.url}${Apps.backend.paths.sponsored}${query}`,
    )
    await Playwright.start(page, { name: 'Sign in' })
    await Playwright.signIn(await Playwright.dialog(page), { code, email })
    const signedIn = await Playwright.outcome(page, { name: 'Sign in' })

    expect(signedIn).toMatchObject({ state: 'fulfilled', value: { email } })
    await expect(page.locator('#status')).toHaveText('signedIn')
    const session: Session = signedIn.value
    if (fund) await Chain.fund({ address: session.account })
    await capture('signed in')
    return session
  })
}

declare namespace enter {
  type Options = {
    /** Adds a screenshot of the page to the report. */
    capture: (name: string) => Promise<void>
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
    /** Whether the faucet funds the Tempo Account. Defaults to `true`. */
    fund?: boolean | undefined
    /** The path of the relay route. Defaults to the page's own, `/page/relay`. */
    relay?: string | undefined
  }
}

/**
 * Sends `options.amount` OUSD from the session of the sponsored page on `page` to a new address, and
 * asserts that the transfer lands. Returns the account that paid the fees, as the node names it, and
 * what the sender spent, in base units.
 */
async function transfer(page: Page, options: transfer.Options) {
  const { account, amount, timeout } = options
  const recipient = privateKeyToAddress(generatePrivateKey())
  const before = await balance(account)
  const sent = await Playwright.send(page, { amount, timeout, to: recipient })

  expect(sent.state).toBe('fulfilled')
  expect(await balance(recipient)).toBe(parseUnits(amount, 6))
  const paid = await Chain.feePayer({ hash: sent.value.transactionHash })
  // The page's receipt names the same account as the node's.
  expect(sent.value.feePayer.toLowerCase()).toBe(paid.toLowerCase())
  return {
    feePayer: paid.toLowerCase(),
    spent: before - (await balance(account)),
  }
}

declare namespace transfer {
  type Options = {
    /** The sender's Tempo Account. */
    account: `0x${string}`
    /** The OUSD to send, as a decimal string. */
    amount: string
    /** The time to wait for the transfer, in milliseconds. Defaults to the timeout of an assertion. */
    timeout?: number | undefined
  }
}

test.describe('sponsored', () => {
  test.describe('with the app’s own fee payer', () => {
    test('sends OUSD whose fees the relay route’s fee payer pays', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { account } = await enter(page, { capture, code, email })

      await test.step('spends the amount alone, and the fee payer pays the fees', async () => {
        const sent = await transfer(page, { account, amount: '2' })

        expect(sent).toEqual({
          feePayer: feePayer.toLowerCase(),
          spent: 2_000_000n,
        })
        await capture('sent')
      })
    })

    test('sends the whole balance and the whole limit of an account that holds no fee', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { account, key } = await enter(page, {
        capture,
        code,
        email,
        fund: false,
      })
      const donor = generatePrivateKey()

      await test.step('receives 100 OUSD from another account, and no other token', async () => {
        await Chain.fund({ address: privateKeyToAddress(donor) })
        await Chain.send({
          amount: 100_000_000n,
          privateKey: donor,
          to: account,
          token: Chain.ousd,
        })

        expect(await balance(account)).toBe(100_000_000n)
        expect(
          await Chain.balance({ address: account, token: Chain.alphaUsd }),
        ).toBe(0n)
        await capture('received')
      })

      await test.step('sends the 100 OUSD of its limit, and holds nothing after it', async () => {
        const sent = await transfer(page, { account, amount: '100' })

        expect(sent).toEqual({
          feePayer: feePayer.toLowerCase(),
          spent: 100_000_000n,
        })
        expect(await balance(account)).toBe(0n)
        expect(
          await Chain.remaining({
            accessKey: key,
            address: account,
            token: Chain.ousd,
          }),
        ).toBe(0n)
        await capture('sent')
      })
    })
  })

  test.describe('through the Tempo API', { tag: TempoApi.tag }, () => {
    // The worker of these tests starts the Tempo API, which serves on one port, so they share it.
    test.describe.configure({ mode: 'default' })

    test('sends OUSD whose fees the Tempo API’s sponsor pays', async ({
      capture,
      code,
      email,
      page,
      tempoApi: _tempoApi,
    }) => {
      const { account } = await enter(page, {
        capture,
        code,
        email,
        relay: Apps.backend.paths.relayApi,
      })

      await test.step('spends the amount alone, and another account than the app’s pays the fees', async () => {
        const sent = await transfer(page, {
          account,
          amount: '2',
          timeout: apiTimeout,
        })

        expect(sent.spent).toBe(2_000_000n)
        expect(sent.feePayer).not.toBe(account.toLowerCase())
        expect(sent.feePayer).not.toBe(feePayer.toLowerCase())
        await capture('sent')
      })
    })

    test('pays its own fees when the Tempo API refuses the app’s API key', async ({
      capture,
      code,
      email,
      errors,
      page,
      tempoApi: _tempoApi,
    }) => {
      const { account } = await enter(page, {
        capture,
        code,
        email,
        relay: Apps.backend.paths.relayWrongKey,
      })

      await test.step('sends the transfer, and pays the fee beside the amount', async () => {
        const sent = await transfer(page, {
          account,
          amount: '2',
          timeout: apiTimeout,
        })

        expect(sent.feePayer).toBe(account.toLowerCase())
        expect(sent.spent).toBeGreaterThan(2_000_000n)
        // The relay route forwards the Tempo API's refusal of the API key.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[401]])
        await capture('sent')
      })
    })
  })

  test.describe('refusals', () => {
    test('pays its own fees when the relay’s policy sponsors no transaction', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { account } = await enter(page, {
        capture,
        code,
        email,
        relay: Apps.backend.paths.relayGuarded,
      })

      await test.step('sends the transfer, and pays the fee beside the amount', async () => {
        const sent = await transfer(page, { account, amount: '2' })

        expect(sent.feePayer).toBe(account.toLowerCase())
        expect(sent.spent).toBeGreaterThan(2_000_000n)
        await capture('sent')
      })
    })

    test('pays its own fees when the relay’s `authorize` refuses the caller', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const { account } = await enter(page, {
        capture,
        code,
        email,
        relay: Apps.backend.paths.relayDenied,
      })

      await test.step('sends the transfer, and pays the fee beside the amount', async () => {
        const sent = await transfer(page, { account, amount: '2' })

        expect(sent.feePayer).toBe(account.toLowerCase())
        expect(sent.spent).toBeGreaterThan(2_000_000n)
        // The transport sends a request that a 403 refuses three more times.
        expect(errors.splice(0)).toEqual(
          Array.from({ length: 4 }, () => Web.consoleErrors[403]),
        )
        await capture('sent')
      })
    })

    test('refuses a relay request with no access token', async ({
      request,
    }) => {
      await test.step('answers 401 with `invalid_token`, as a JSON-RPC error', async () => {
        const response = await request.post(relayUrl, {
          data: { id: 1, jsonrpc: '2.0', method: 'eth_chainId' },
        })

        expect(response.status()).toBe(401)
        expect(response.headers()['www-authenticate']).toBe(
          'Bearer error="invalid_token"',
        )
        expect(await response.json()).toMatchObject({
          error: { code: -32002, data: { reason: 'invalid_token' } },
          jsonrpc: '2.0',
        })
      })
    })

    test('refuses a batch of relay requests with a valid access token', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await enter(page, { capture, code, email, fund: false })

      await test.step('answers 400 with `invalid_request`, as a JSON-RPC error', async () => {
        expect(await Playwright.run(page, { name: 'Relay a batch' })).toEqual({
          state: 'fulfilled',
          value: {
            body: {
              error: {
                code: -32002,
                data: { reason: 'invalid_request' },
                message: expect.any(String),
              },
              id: null,
              jsonrpc: '2.0',
            },
            status: 400,
          },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
        await capture('refused')
      })
    })
  })

  test.describe('access token', () => {
    test('names the user to the backend, which refuses a forged token', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      const { account } = await enter(page, {
        capture,
        code,
        email,
        fund: false,
      })

      await test.step('reads the app and the Tempo Account from the page’s access token', async () => {
        const bearer = await Playwright.run(page, { name: 'Bearer' })

        expect(bearer).toMatchObject({
          state: 'fulfilled',
          value: {
            body: {
              clientId: Apps.backend.clientIdPage,
              method: 'access-token',
            },
            status: 200,
          },
        })
        expect(
          bearer.value.body.accounts.map((value: string) =>
            value.toLowerCase(),
          ),
        ).toEqual([account.toLowerCase()])
        // The page of a backend session reads its storage the same way, and finds no token.
        expect(await Playwright.run(page, { name: 'Storage' })).toEqual({
          state: 'fulfilled',
          value: { cookie: '', holdsToken: true },
        })
        await capture('named')
      })

      await test.step('names no user for a token with a forged signature', async () => {
        expect(await Playwright.run(page, { name: 'Forged bearer' })).toEqual({
          state: 'fulfilled',
          value: { body: null, status: 401 },
        })
        expect(errors.splice(0)).toEqual([Web.consoleErrors[401]])
        await capture('refused')
      })
    })
  })
})
