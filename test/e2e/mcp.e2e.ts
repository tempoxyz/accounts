/**
 * Tests a paid MCP server of `examples/mcp`, which the MCP test app serves, and its client, the CLI
 * test app. The server refuses a request without a token for its resource, and names its metadata,
 * which names Tempo ID. The program signs in once with a device grant for the resource, which the
 * user approves in a browser. Each call of a paid tool then charges over MPP, and the access key of
 * the sign-in pays it with no other approval, until its limit.
 * @module
 */
import type { Page } from '@playwright/test'
import { parseUnits } from 'viem'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Cli from '../Cli.js'
import { test } from '../Cli.js'
import * as Playwright from '../Playwright.js'
import { expect } from '../Playwright.js'
import * as TempoId from '../TempoId.js'

/** The line that the program prints for the user: the URL of the device page, and the code. */
const prompt = /^Open (\S+) and confirm the code (\S+)\.$/

/** The URL of the MCP server's endpoint. */
const url = `${Apps.mcp.url}/mcp`

/**
 * Signs `email` in with the `login` command and the device page on `page`, with the flags `args`.
 * Returns the Tempo Account of the session's access key.
 */
async function enter(page: Page, options: enter.Options) {
  const { args, capture, cli, code, email, terminal } = options
  const login = cli.start({ args: ['login', ...args] })
  const [, link] = prompt.exec(await login.line({ pattern: prompt }))!
  await page.goto(link!)
  await Playwright.signIn(page, { code, email })
  const device = await Playwright.device(page)
  await Playwright.approve(page)
  await expect(device.approved).toBeVisible()
  const result = await login.result

  expect(result.outcome).toMatchObject({ state: 'fulfilled', value: { email } })
  await capture('approved')
  await terminal('signed in')
  return (result.outcome.value as { key: { account: `0x${string}` } }).key
    .account
}

declare namespace enter {
  type Options = {
    /** The flags of the `login` command. */
    args: readonly string[]
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

test.describe('mcp', () => {
  test('signs in once for the MCP server’s resource, and pays each tool call with the access key up to its limit', async ({
    capture,
    cli,
    code,
    email,
    page,
    terminal,
  }) => {
    const resource =
      await test.step('refuses a request without a token, and names the metadata, which names Tempo ID', async () => {
        const refused = await fetch(url, { method: 'POST' })
        const challenge = refused.headers.get('www-authenticate')
        await refused.body?.cancel()
        const [, metadataUrl] = /resource_metadata="([^"]+)"/.exec(
          challenge ?? '',
        )!
        const metadata = (await (await fetch(metadataUrl!)).json()) as {
          authorization_servers: string[]
          resource: string
        }

        expect(refused.status).toBe(401)
        expect(metadata).toMatchObject({
          authorization_servers: [TempoId.url],
          resource: Apps.mcp.resource,
        })
        return metadata.resource
      })

    const account =
      await test.step('signs in with a device grant for the resource, and an access key of 1 OUSD', () =>
        enter(page, {
          args: ['--resource', resource, '--limit', '1'],
          capture,
          cli,
          code,
          email,
          terminal,
        }))
    await Chain.fund({ address: account })

    await test.step('calls the free tool with the access token for the resource', async () => {
      const call = await cli.run({ args: ['mcp', url, 'whoami'] })

      expect(call.outcome).toMatchObject({
        state: 'fulfilled',
        value: { receipt: null },
      })
      expect(JSON.parse(call.outcome.value.content[0])).toMatchObject({
        app: Apps.cli.clientId,
        user: expect.stringMatching(/^user_/),
      })
      await terminal('authenticated')
    })

    await test.step('pays 0.01 OUSD for each of two calls, with no approval', async () => {
      for (const _ of [1, 2]) {
        const call = await cli.run({ args: ['mcp', url, 'fortune'] })

        expect(call.outcome).toMatchObject({
          state: 'fulfilled',
          value: {
            content: ['Your code compiles on the first try.'],
            receipt: { method: 'tempo', status: 'success' },
          },
        })
        expect(
          await Chain.transfers({ hash: call.outcome.value.receipt.reference }),
        ).toContainEqual({
          amount: parseUnits(Apps.mcp.amounts.fortune, 6),
          from: account,
          to: Apps.mcp.payee,
        })
      }
      await terminal('paid')
    })

    await test.step('refuses the call of 5 OUSD, above the access key’s limit, and pays nothing', async () => {
      const before = await Chain.balance({
        address: account,
        token: Chain.ousd,
      })
      const call = await cli.run({ args: ['mcp', url, 'report'] })

      expect(call.code).toBe(1)
      expect(call.outcome).toMatchObject({
        state: 'rejected',
        value: { name: 'mpp.LimitError' },
      })
      expect(await Chain.balance({ address: account, token: Chain.ousd })).toBe(
        before,
      )
      await terminal('refused')
    })
  })

  test('refuses the access token of a sign-in without the resource', async ({
    capture,
    cli,
    code,
    email,
    page,
    terminal,
  }) => {
    await test.step('signs in with a device grant for Tempo ID’s origin', () =>
      enter(page, { args: [], capture, cli, code, email, terminal }))

    await test.step('receives 401 from the server, whose resource the token does not name', async () => {
      const call = await cli.run({ args: ['mcp', url, 'whoami'] })

      expect(call.code).toBe(1)
      expect(call.outcome).toMatchObject({
        state: 'rejected',
        value: {
          code: 401,
          message: expect.stringContaining('invalid_token'),
        },
      })
      await terminal('refused')
    })
  })
})
