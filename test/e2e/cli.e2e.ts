/**
 * Tests the CLI test app: a program without a browser, which signs in with Tempo ID's device grant.
 * The program prints the URL of Tempo ID's device page and a code, the user approves the code in a
 * browser, and the program receives the session, which it keeps in a file. The cases cover the
 * approval and the denial, the session across processes, a transfer with the access key, the
 * refresh and the sign-out, a sign-out during a sign-in, a damaged file, an access key that
 * expires, a challenge, an amount that the sign-in needs, a transfer above the limit or the balance
 * that a device code resolves, a grant that one command starts and a second redeems, and the
 * charge of an MPP endpoint.
 * @module
 */
import type { Page } from '@playwright/test'
import * as Fs from 'node:fs/promises'
import * as Path from 'node:path'
import { parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Cli from '../Cli.js'
import { test } from '../Cli.js'
import * as Playwright from '../Playwright.js'
import { expect } from '../Playwright.js'
import * as TempoId from '../TempoId.js'
import * as Verify from '../Verify.js'

/** The session, as the program prints it. Each token shows as a fingerprint of its hash. */
type Session = {
  /** The fingerprint of the access token. */
  accessToken: string
  /** The Tempo Account that signed the challenge, or `null` for a sign-in without one. */
  address: `0x${string}` | null
  /** The signature of the challenge, or `null` for a sign-in without one. */
  challengeSignature: `0x${string}` | null
  /** The user's address. */
  email: string
  /** The time that the access token expires, in Unix milliseconds. */
  expiresAt: number
  /** The access key, or `null` for a sign-in without one. */
  key: {
    /** The Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The chain of the access key. */
    chainId: number
    /** The expiry, in Unix seconds. */
    expiry: number | null
    /** The access key's address. */
    id: `0x${string}`
  } | null
  /** The fingerprint of the refresh token. */
  refreshToken: string | null
}

/** The amount that a sign-in with a funding hint needs in the Tempo Account: 10 dollars. */
const needed = { amount: '10' } as const

/** The line that the program prints for the user: the URL of the device page, and the code. */
const prompt = /^Open (\S+) and confirm the code (\S+)\.$/

/** What a command prints for a file that holds no session. */
const signedOut = {
  state: 'rejected',
  value: { message: 'Not signed in. Run `login`.', name: 'Error' },
} as const

/**
 * Signs `email` in with the `login` command and the device page on `page`, as the first step of a
 * test. Returns the session that the command printed.
 */
function enter(page: Page, options: enter.Options) {
  const { args = [], capture, cli, code, email, terminal } = options
  return test.step('signs in with a device grant', async () => {
    const login = cli.start({ args: ['login', ...args] })
    const device = await open(page, { code, email, process: login })
    await Playwright.approve(page)
    await expect(device.approved).toBeVisible()
    const result = await login.result

    expect(result.outcome).toMatchObject({
      state: 'fulfilled',
      value: { email },
    })
    await capture('approved')
    await terminal('signed in')
    return result.outcome.value as Session
  })
}

declare namespace enter {
  type Options = {
    /** The flags of the `login` command. Defaults to none. */
    args?: readonly string[] | undefined
    /** Adds a screenshot of the page to the report. */
    capture: (name: string) => Promise<void>
    /** The CLI test app of the test. */
    cli: Cli.Cli
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
    /** Adds a screenshot of the commands and their output to the report. */
    terminal: (name: string) => Promise<void>
  }
}

/** Waits until the time of the node's latest block passes `expiry`, in Unix seconds. */
async function expired(expiry: number) {
  await expect
    .poll(() => Chain.time(), { timeout: 30_000 })
    .toBeGreaterThan(expiry)
}

/** Returns the permissions of the file at `path`, such as `0o600`. */
async function mode(path: string) {
  const stats = await Fs.stat(path)
  return stats.mode & 0o777
}

/**
 * Opens the device page that `options.process` printed on `page`, signs `options.email` in on it,
 * and asserts that the page shows the code that the program printed. Returns the page's request.
 */
async function open(page: Page, options: open.Options) {
  const { code, email, process } = options
  const printed = await prompted(process)
  await page.goto(printed.url)
  await Playwright.signIn(page, { code, email })

  const device = await Playwright.device(page)
  expect(await device.code()).toBe(printed.code)
  return device
}

declare namespace open {
  type Options = {
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
    /** The command that started the grant. */
    process: Cli.Process
  }
}

/** Returns the number of polls that the sign-in of `process` printed so far. */
function polls(process: Cli.Process) {
  return process.lines.filter((line) => /^Poll \d+\.$/.test(line)).length
}

/** Returns the URL of the device page and the code that `process` printed, once it prints them. */
async function prompted(process: Cli.Process) {
  const line = await process.line({ pattern: prompt })
  const [, url, code] = prompt.exec(line)!
  return { code: code!, url: url! }
}

test.describe('cli', () => {
  test.describe('sign-in', () => {
    test('signs in with a device grant, and keeps the session in a file that only the user reads', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const login = cli.start({ args: ['login'] })

      const printed =
        await test.step('prints the device page’s URL and a code', async () => {
          const printed = await prompted(login)

          expect(printed.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
          expect(printed.url).toBe(`${TempoId.url}/device?code=${printed.code}`)
          await terminal('prompt')
          return printed
        })

      const device =
        await test.step('shows the code and the request to the signed-in user, flags an unverified app, and enables the approval', async () => {
          await page.goto(printed.url)
          await Playwright.signIn(page, { code, email })
          const device = await Playwright.device(page)

          expect(await device.code()).toBe(printed.code)
          await expect(Playwright.grant(page)).toContainText(['Spend $100'])
          await expect(device.unverified).toBeVisible()
          await expect(device.approve).toBeEnabled()
          await capture('request')
          return device
        })

      await test.step('approves, and the program receives the session', async () => {
        await Playwright.approve(page)
        await expect(device.approved).toBeVisible()
        const result = await login.result

        expect(result.code).toBe(0)
        expect(result.outcome).toMatchObject({
          state: 'fulfilled',
          value: {
            accessToken: expect.stringMatching(/^[0-9a-f]{16}$/),
            address: null,
            challengeSignature: null,
            email,
            key: {
              account: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
              chainId: Chain.chain.id,
              id: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
            },
            refreshToken: expect.stringMatching(/^[0-9a-f]{16}$/),
          },
        })
        const session = result.outcome.value as Session
        // The program requests an access key of one day.
        const day = 24 * 60 * 60
        expect(
          Math.abs(session.key!.expiry! - (await Chain.time()) - day),
        ).toBeLessThan(120)
        expect(await mode(cli.file)).toBe(0o600)
        await capture('approved')
        await terminal('signed in')
      })
    })

    test('reads the session in a second process, and sends OUSD with the access key of the file', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const session = await enter(page, { capture, cli, code, email, terminal })
      const key = session.key!

      await test.step('reads the session of the first process in a second one', async () => {
        const whoami = await cli.run({ args: ['whoami'] })

        expect(whoami.outcome).toEqual({ state: 'fulfilled', value: session })
        await terminal('session')
      })

      await test.step('sends OUSD with the access key, within its limit on the node', async () => {
        await Chain.fund({ address: key.account })
        const send = await cli.run({ args: ['send', recipient, '1.5'] })

        expect(send.outcome).toMatchObject({
          state: 'fulfilled',
          value: { status: 'success' },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_500_000n)
        expect(
          await Chain.accessKey({ accessKey: key.id, address: key.account }),
        ).toMatchObject({ expiry: BigInt(key.expiry!), isRevoked: false })
        // The fee of the transfer spends the limit too.
        const remaining = await Chain.remaining({
          accessKey: key.id,
          address: key.account,
          token: Chain.ousd,
        })
        expect(remaining).toBeLessThan(parseUnits('98.5', 6))
        expect(remaining).toBeGreaterThan(parseUnits('98', 6))
        await terminal('sent')
      })
    })

    test('rejects the sign-in with the refusal when the user denies the request', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const login = cli.start({ args: ['login'] })

      await test.step('denies the request on the device page', async () => {
        const device = await open(page, { code, email, process: login })
        await Playwright.deny(page)

        await expect(device.denied).toBeVisible()
        await capture('denied')
      })

      await test.step('rejects with the refusal, exits with code 1, and saves no session', async () => {
        const result = await login.result

        expect(result.code).toBe(1)
        expect(result.outcome).toMatchObject({
          state: 'rejected',
          value: {
            code: 'access_denied',
            name: 'Accounts.RequestError',
            status: 400,
          },
        })
        const whoami = await cli.run({ args: ['whoami'] })
        expect(whoami.outcome).toMatchObject(signedOut)
        await terminal('refused')
      })
    })

    test('stops the polls of a sign-in that a sign-out ends', async ({
      cli,
      terminal,
    }) => {
      const login = cli.start({ args: ['login', '--polls', '--sign-out'] })

      await test.step('polls Tempo ID while no user approves the code', async () => {
        await login.line({ pattern: /^Poll 2\.$/ })

        await terminal('polls')
      })

      await test.step('signs out, which rejects the sign-in and sends no further poll', async () => {
        const sent = polls(login)
        login.write({ text: 'sign out' })
        // Node ends the program only once no timer and no request of it remains. The exit is the
        // state that proves the end of the polls, since a poll that waits for its interval holds
        // the process open, and the test's timeout then fails this step.
        const result = await login.result

        expect(result.outcome).toMatchObject({
          state: 'rejected',
          value: { name: 'Accounts.SupersededError' },
        })
        // A poll that the program sent while the line arrived still prints.
        expect(polls(login)).toBeLessThanOrEqual(sent + 1)
        const whoami = await cli.run({ args: ['whoami'] })
        expect(whoami.outcome).toMatchObject(signedOut)
        await terminal('signed out')
      })
    })
  })

  test.describe('session', () => {
    test('refreshes the tokens, signs out, and Tempo ID refuses the refresh token of a copy of the file', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const copy = `${cli.file}.copy`
      const session = await enter(page, { capture, cli, code, email, terminal })

      await test.step('refreshes the tokens in a second process, and keeps the access key', async () => {
        const refresh = await cli.run({ args: ['refresh'] })
        const whoami = await cli.run({ args: ['whoami'] })

        expect(refresh.outcome.state).toBe('fulfilled')
        const refreshed = refresh.outcome.value as Session
        expect(refreshed.accessToken).not.toBe(session.accessToken)
        expect(refreshed.refreshToken).not.toBe(session.refreshToken)
        expect(refreshed.key).toEqual(session.key)
        expect(whoami.outcome).toEqual({ state: 'fulfilled', value: refreshed })
        await terminal('refreshed')
      })

      await test.step('signs out, and the next process holds no session', async () => {
        await Fs.copyFile(cli.file, copy)
        const logout = await cli.run({ args: ['logout'] })
        const whoami = await cli.run({ args: ['whoami'] })

        expect(logout.outcome).toEqual({ state: 'fulfilled', value: null })
        expect(whoami.outcome).toMatchObject(signedOut)
        await terminal('signed out')
      })

      await test.step('refuses the refresh token of a copy of the file from before the sign-out, and ends its session', async () => {
        await Fs.copyFile(copy, cli.file)
        const refresh = await cli.run({ args: ['refresh'] })
        const whoami = await cli.run({ args: ['whoami'] })

        expect(refresh.outcome).toMatchObject({
          state: 'rejected',
          value: {
            code: 'invalid_grant',
            name: 'Accounts.RequestError',
            status: 400,
          },
        })
        expect(whoami.outcome).toMatchObject(signedOut)
        await terminal('refused')
      })
    })

    test('rejects a sign-in and a sign-out with a damaged file, and quotes none of the file', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const damaged = '{"session":"text-of-the-damaged-file'
      const refusal = {
        state: 'rejected',
        value: {
          message: `Invalid file: ${cli.file} holds no valid JSON. Remove the file, and sign in again.`,
          name: 'Store.InvalidFileError',
        },
      }
      // The store creates the file's folder at its first write, which no command made yet.
      await Fs.mkdir(Path.dirname(cli.file), { recursive: true })
      await Fs.writeFile(cli.file, damaged)

      await test.step('rejects each command before a request, and leaves the file as it is', async () => {
        const login = await cli.run({ args: ['login'] })
        const logout = await cli.run({ args: ['logout'] })

        expect(login.outcome).toMatchObject(refusal)
        expect(logout.outcome).toMatchObject(refusal)
        // The sign-in starts no grant, so the program prints no code.
        expect(login.lines.filter((line) => prompt.test(line))).toEqual([])
        expect(cli.transcript()).not.toContain('text-of-the-damaged-file')
        expect(await Fs.readFile(cli.file, 'utf8')).toBe(damaged)
        await terminal('refused')
      })

      await Fs.rm(cli.file)
      const session = await enter(page, { capture, cli, code, email, terminal })
      expect(session.key).not.toBeNull()
    })

    test('ends the session of the file once its access key expires, and signs in again with no sign-in form', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const session = await enter(page, {
        args: ['--expiry', '20s'],
        capture,
        cli,
        code,
        email,
        terminal,
      })
      const key = session.key!
      await Chain.fund({ address: key.account })

      await test.step('holds no session after the expiry, and sends nothing', async () => {
        await expired(key.expiry!)
        const whoami = await cli.run({ args: ['whoami'] })
        const send = await cli.run({ args: ['send', recipient, '1'] })

        expect(whoami.outcome).toMatchObject(signedOut)
        expect(send.outcome).toMatchObject(signedOut)
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(0n)
        await terminal('expired')
      })

      await test.step('signs in again with the browser’s Tempo ID session, and sends with the new access key', async () => {
        const login = cli.start({ args: ['login'] })
        const printed = await prompted(login)
        await page.goto(printed.url)
        const device = await Playwright.device(page)
        await Playwright.approve(page)
        await expect(device.approved).toBeVisible()
        const result = await login.result
        const send = await cli.run({ args: ['send', recipient, '1'] })

        expect(result.outcome).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: key.account } },
        })
        expect(result.outcome.value.key.id).not.toBe(key.id)
        expect(send.outcome).toMatchObject({
          state: 'fulfilled',
          value: { status: 'success' },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('approved again')
        await terminal('signed in again')
      })
    })
  })

  test.describe('requests', () => {
    test('signs a challenge with the access key, and a verifier accepts the proof for the app', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const challenge = `accounts-e2e ${crypto.randomUUID()}`
      const login = cli.start({ args: ['login', '--challenge', challenge] })

      const device =
        await test.step('shows the message that the sign-in signs', async () => {
          const device = await open(page, { code, email, process: login })

          await expect(device.note).toContainText(
            'This sign-in also signs a message',
          )
          await expect(device.message).toHaveText(challenge)
          await capture('challenge')
          return device
        })

      const session =
        await test.step('approves, and the session holds the Tempo Account and a signature', async () => {
          await Playwright.approve(page)
          await expect(device.approved).toBeVisible()
          const result = await login.result

          expect(result.outcome).toMatchObject({
            state: 'fulfilled',
            value: {
              challengeSignature: expect.stringMatching(/^0x[0-9a-f]+$/),
              email,
            },
          })
          const session = result.outcome.value as Session
          expect(session.address).toBe(session.key!.account)
          await capture('approved')
          await terminal('signed in')
          return session
        })

      await test.step('verifies the proof as the app’s backend does, and refuses it for another challenge and another app', async () => {
        // The output holds the access token, so the report shows none of it.
        const printed = await cli.run({ args: ['proof'], hidden: true })
        const proof = {
          accessToken: printed.outcome.value.accessToken as string,
          challenge,
          clientId: Apps.cli.clientId,
          keyAuthorization: printed.outcome.value.keyAuthorization,
        } satisfies Verify.challenge.Options

        expect(await Verify.challenge(proof)).toEqual({
          accessKey: session.key!.id,
          account: session.key!.account,
        })
        await expect(
          Verify.challenge({ ...proof, challenge: `${challenge} ` }),
        ).rejects.toMatchObject({ name: 'Challenge.InvalidError' })
        await expect(
          Verify.challenge({ ...proof, clientId: Apps.web.clientId }),
        ).rejects.toMatchObject({ name: 'AccessToken.InvalidError' })
        await terminal('proof')
      })
    })

    test('signs a challenge as the Tempo Account, for a sign-in without an access key', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const challenge = `accounts-e2e ${crypto.randomUUID()}`
      const login = cli.start({
        args: ['login', '--challenge', challenge, '--no-access-key'],
      })

      const device =
        await test.step('shows the message and the Tempo Account that signs it', async () => {
          const device = await open(page, { code, email, process: login })

          await expect(device.note).toContainText(
            'Sign a message as your Tempo Account',
          )
          await expect(device.note).toContainText(
            /Signs as 0x[0-9a-fA-F]{40} on chain local\./,
          )
          await expect(device.message).toHaveText(challenge)
          await capture('challenge')
          return device
        })

      await test.step('approves, and the owner’s signature verifies on the node', async () => {
        await Playwright.approve(page)
        await expect(device.approved).toBeVisible()
        const result = await login.result

        expect(result.outcome).toMatchObject({
          state: 'fulfilled',
          value: { email, key: null },
        })
        const session = result.outcome.value as Session
        const address = session.address!
        const signature = session.challengeSignature!
        expect(
          await Verify.message({ address, message: challenge, signature }),
        ).toBe(true)
        expect(
          await Verify.message({
            address,
            message: `${challenge} `,
            signature,
          }),
        ).toBe(false)
        await capture('approved')
        await terminal('signed in')
      })
    })

    test('states the amount that the sign-in needs after the approval, and funds the Tempo Account from the faucet', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const login = cli.start({
        args: ['login', '--funding', JSON.stringify(needed)],
      })

      const session =
        await test.step('approves, and the program receives the session before a deposit', async () => {
          await open(page, { code, email, process: login })
          await Playwright.approve(page)
          const funding = await Playwright.funding(page)
          const result = await login.result

          await expect(funding.hint).toContainText(
            `${Apps.cli.name} (unverified app) recommends you have at least $${needed.amount} in your wallet.`,
          )
          expect(result.outcome).toMatchObject({
            state: 'fulfilled',
            value: { email },
          })
          const session = result.outcome.value as Session
          expect(
            await Chain.balance({
              address: session.key!.account,
              token: Chain.ousd,
            }),
          ).toBe(0n)
          await capture('amount')
          await terminal('signed in')
          return session
        })

      await test.step('funds the Tempo Account from the faucet of the page', async () => {
        const funding = await Playwright.funding(page)
        await funding.add.click()

        await expect(funding.funded).toBeVisible()
        expect(
          await Chain.balance({
            address: session.key!.account,
            token: Chain.ousd,
          }),
        ).toBeGreaterThanOrEqual(parseUnits(needed.amount, 6))
        await capture('funded')
      })
    })

    test('signs in without the amount when the user selects Not now', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const login = cli.start({
        args: ['login', '--funding', JSON.stringify(needed)],
      })

      await test.step('approves, selects Not now, and the Tempo Account holds no OUSD', async () => {
        const device = await open(page, { code, email, process: login })
        await Playwright.approve(page)
        const funding = await Playwright.funding(page)
        await funding.skip.click()
        const result = await login.result

        await expect(device.approved).toBeVisible()
        expect(result.outcome).toMatchObject({
          state: 'fulfilled',
          value: { email },
        })
        expect(
          await Chain.balance({
            address: result.outcome.value.key.account,
            token: Chain.ousd,
          }),
        ).toBe(0n)
        await capture('approved')
        await terminal('signed in')
      })
    })
  })

  test.describe('retries', () => {
    test('requests a higher limit through a device code for a transfer above the limit, and sends it', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const session = await enter(page, {
        args: ['--limit', '5'],
        capture,
        cli,
        code,
        email,
        terminal,
      })
      const key = session.key!
      await Chain.fund({ address: key.account })

      await test.step('prints a device code for a transfer of 6 OUSD, and sends it after the approval', async () => {
        const send = cli.start({ args: ['send', recipient, '6'] })
        const printed = await prompted(send)
        await page.goto(printed.url)
        const device = await Playwright.device(page)
        await Playwright.approve(page)
        await expect(device.approved).toBeVisible()
        const result = await send.result
        const whoami = await cli.run({ args: ['whoami'] })

        expect(result.outcome).toMatchObject({
          state: 'fulfilled',
          value: { status: 'success' },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(6_000_000n)
        expect(whoami.outcome).toMatchObject({
          state: 'fulfilled',
          value: { email, key: { account: key.account } },
        })
        expect(whoami.outcome.value.key.id).not.toBe(key.id)
        await capture('approved')
        await terminal('sent')
      })
    })

    test('rejects a transfer above the limit when the user denies the device code', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const session = await enter(page, {
        args: ['--limit', '5'],
        capture,
        cli,
        code,
        email,
        terminal,
      })
      await Chain.fund({ address: session.key!.account })

      await test.step('denies the code, and the transfer rejects with the closed retry', async () => {
        const send = cli.start({ args: ['send', recipient, '6'] })
        const printed = await prompted(send)
        await page.goto(printed.url)
        const device = await Playwright.device(page)
        await Playwright.deny(page)
        await expect(device.denied).toBeVisible()
        const result = await send.result
        const whoami = await cli.run({ args: ['whoami'] })

        expect(result.code).toBe(1)
        expect(result.outcome).toMatchObject({
          state: 'rejected',
          value: { name: 'Plugins.viem.RetryClosedError' },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(0n)
        expect(whoami.outcome).toMatchObject({
          state: 'fulfilled',
          value: { key: { id: session.key!.id } },
        })
        await capture('denied')
        await terminal('rejected')
      })
    })

    test('requests a deposit through a device code for a transfer above the balance, and sends it once the faucet funds the account', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      await enter(page, { capture, cli, code, email, terminal })

      await test.step('prints a device code for a transfer of 1 OUSD, and opens the deposit page after the approval', async () => {
        const send = cli.start({ args: ['send', recipient, '1'] })
        const printed = await prompted(send)
        await page.goto(printed.url)
        await Playwright.device(page)
        await Playwright.approve(page)
        const funding = await Playwright.funding(page)

        await expect(funding.hint).toContainText(
          `${Apps.cli.name} (unverified app) recommends you have at least $1 in OUSD in your wallet. Your balance is $0.`,
        )
        await capture('deposit page')

        await funding.add.click()
        await expect(funding.funded).toBeVisible()
        const result = await send.result

        expect(result.outcome).toMatchObject({
          state: 'fulfilled',
          value: { status: 'success' },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await capture('funded')
        await terminal('sent')
      })
    })
  })

  test.describe('grant in two commands', () => {
    test('starts a grant with one command, and redeems it with a second for an access key of the program’s own', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const recipient = privateKeyToAddress(generatePrivateKey())
      const authorize = cli.start({
        args: ['authorize', '--funding', JSON.stringify(needed)],
      })

      await test.step('starts the grant, exits, and keeps the device code in a file that only the user reads', async () => {
        const result = await authorize.result

        expect(result.outcome).toEqual({
          state: 'fulfilled',
          value: { expiresIn: 300, interval: 1 },
        })
        expect(await mode(cli.grantFile)).toBe(0o600)
        await terminal('grant')
      })

      await test.step('returns a pending grant to a poll before the approval', async () => {
        const poll = await cli.run({ args: ['poll'] })

        expect(poll.outcome).toEqual({
          state: 'fulfilled',
          value: { slowDown: false, status: 'pending' },
        })
        await terminal('pending')
      })

      await test.step('approves the code, and funds the Tempo Account from the faucet of the page', async () => {
        await open(page, { code, email, process: authorize })
        await Playwright.approve(page)
        const funding = await Playwright.funding(page)
        await funding.add.click()

        await expect(funding.funded).toBeVisible()
        await capture('funded')
      })

      await test.step('redeems the grant, and sends OUSD with the program’s own access key, with no session', async () => {
        const poll = await cli.run({ args: ['poll', recipient, '1'] })

        expect(poll.outcome).toMatchObject({
          state: 'fulfilled',
          value: {
            email,
            session: null,
            status: 'approved',
            transfer: { status: 'success' },
          },
        })
        expect(
          await Chain.balance({ address: recipient, token: Chain.ousd }),
        ).toBe(1_000_000n)
        await expect(Fs.stat(cli.file)).rejects.toMatchObject({
          code: 'ENOENT',
        })
        await terminal('redeemed')
      })

      await test.step('refuses a second poll of the device code', async () => {
        const poll = await cli.run({ args: ['poll'] })
        const whoami = await cli.run({ args: ['whoami'] })

        expect(poll.outcome).toMatchObject({
          state: 'rejected',
          value: {
            code: 'invalid_grant',
            name: 'Accounts.RequestError',
            status: 400,
          },
        })
        expect(whoami.outcome).toMatchObject(signedOut)
        await terminal('refused')
      })
    })
  })

  test.describe('payment', () => {
    test('pays the charge of an MPP endpoint with the access key of the file, and rejects one above the maximum of the call', async ({
      capture,
      cli,
      code,
      email,
      page,
      terminal,
    }) => {
      const charge = `${Apps.mpp.url}${Apps.mpp.paths.charge}`
      const session = await enter(page, { capture, cli, code, email, terminal })
      const { account } = session.key!
      await Chain.fund({ address: account })

      await test.step('pays 0.01 OUSD for the content, which the node holds as a transfer to the merchant', async () => {
        const pay = await cli.run({ args: ['pay', charge] })

        expect(pay.outcome).toMatchObject({
          state: 'fulfilled',
          value: {
            body: { fortune: 'Your code compiles on the first try.' },
            receipt: { method: 'tempo', status: 'success' },
            status: 200,
          },
        })
        expect(
          await Chain.transfers({ hash: pay.outcome.value.receipt.reference }),
        ).toContainEqual({
          amount: parseUnits(Apps.mpp.amounts.charge, 6),
          from: account,
          to: privateKeyToAddress(Apps.mpp.payee),
        })
        await terminal('paid')
      })

      await test.step('rejects the same charge for a maximum of 0.001 OUSD, and pays nothing', async () => {
        const before = await Chain.balance({
          address: account,
          token: Chain.ousd,
        })
        const pay = await cli.run({ args: ['pay', charge, '--max', '0.001'] })

        expect(pay.code).toBe(1)
        expect(pay.outcome).toMatchObject({
          state: 'rejected',
          value: { name: 'mpp.MaxAmountError' },
        })
        expect(
          await Chain.balance({ address: account, token: Chain.ousd }),
        ).toBe(before)
        await terminal('rejected')
      })
    })
  })
})
