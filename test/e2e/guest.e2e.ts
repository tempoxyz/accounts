/**
 * Tests guest sessions in a browser page: an automatic guest sign-in on a store that keeps its
 * values only in the page, such as `Store.memory`, rejects before it creates a guest account, since a
 * page load would lose its key pair and its funds.
 * @module
 */
import Esbuild from 'esbuild'
import { expect, test } from '../Playwright.js'

/** The origin of the page, which the test serves itself. */
const origin = 'https://app.example.com'

test.describe('guest', () => {
  test('rejects an automatic guest sign-in on `Store.memory` in a page, and creates no guest session', async ({
    capture,
    page,
  }) => {
    // The page bundles the package, and starts the dialog's sign-in of an instance with `guest:
    // 'auto'`. Nothing listens at its Tempo ID, and the automatic guest sign-in sends no request.
    const output = await Esbuild.build({
      bundle: true,
      format: 'iife',
      logLevel: 'silent',
      platform: 'browser',
      stdin: {
        contents: [
          "import * as Accounts from '../../src/Accounts.ts'",
          "import { dialog } from '../../src/plugins/index.ts'",
          "import * as Store from '../../src/Store.ts'",
          'const accounts = Accounts.create({',
          "  clientId: 'https://app.example.com',",
          "  guest: 'auto',",
          '  plugins: [dialog()],',
          '  store: Store.memory(),',
          "  url: 'http://127.0.0.1:9',",
          '})',
          'window.outcome = (async () => {',
          '  const error = await accounts.dialog.signIn().then(',
          '    () => undefined,',
          '    (error) => error.message,',
          '  )',
          '  return {',
          '    address: (await accounts.guest.get()) ?? null,',
          '    error,',
          '    session: (await accounts.session.get()) ?? null,',
          '  }',
          '})()',
        ].join('\n'),
        loader: 'ts',
        resolveDir: import.meta.dirname,
      },
      write: false,
    })
    await page.route(`${origin}/`, (route) =>
      route.fulfill({
        body: '<!doctype html><title>Guest</title>',
        contentType: 'text/html',
      }),
    )
    await page.goto(`${origin}/`)

    await test.step('rejects the sign-in before it creates a guest account', async () => {
      await page.addScriptTag({ content: output.outputFiles[0]!.text })
      const outcome = await page.evaluate(
        () => (window as unknown as { outcome: Promise<unknown> }).outcome,
      )

      expect(outcome).toEqual({
        address: null,
        error:
          'Invalid `store`: it keeps the guest account only in the page, which a page load loses with its funds. Use a store that persists, such as the default IndexedDB store.',
        session: null,
      })
      await capture('refused guest sign-in')
    })
  })
})
