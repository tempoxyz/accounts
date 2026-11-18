/**
 * Runs the end-to-end suite in Chromium: the test apps of `test/apps/` against a local Tempo ID and a
 * local Tempo node, as `docs/development/e2e.md` describes.
 * @module
 */
import { defineConfig, devices } from '@playwright/test'
import * as Apps from './test/Apps.js'

/** A Chromium binary to use in place of Playwright's own, such as one a machine already has. */
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  // Each test signs in its own user, so the tests share one stack, and CI splits them into shards.
  fullyParallel: true,
  globalSetup: './test/e2e/setup.ts',
  outputDir: './test/e2e/results',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A headless run otherwise uses the headless shell, which has no popup blocker.
        channel: 'chromium',
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          // Playwright disables the popup blocker. The suite keeps it, as a user's browser does, so
          // a popup opens only within a click.
          ignoreDefaultArgs: ['--disable-popup-blocking'],
        },
      },
    },
  ],
  // `Reporter.ts` writes each run's proof. The HTML report holds each failure's trace beside it.
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './test/e2e/report' }],
    ['./test/Reporter.ts'],
  ],
  testDir: './test/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  // The proof holds a video and the screenshots of every test, and the report a trace of each
  // failure. The stack holds no real secret or personal data.
  use: { screenshot: 'on', trace: 'retain-on-failure', video: 'on' },
  webServer: Apps.servers,
  // A CI runner has four CPUs, which the stack, the apps, and the browsers share.
  workers: process.env.CI ? 2 : 4,
})
