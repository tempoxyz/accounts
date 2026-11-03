/**
 * Runs the end-to-end suite in Chromium: the playgrounds and the package against `apps/id` of the
 * Tempo ID checkout, on the app's production build, with a local Tempo node and a Tempo API.
 * @module
 */
import { defineConfig, devices } from '@playwright/test'

/** A Chromium binary to use in place of Playwright's own, such as one a machine already has. */
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  // Each test signs in its own user, so `--shard` can split the suite by test across CI runners.
  fullyParallel: true,
  globalSetup: './test/e2e/setup.ts',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  testDir: './test/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
  // Each worker has its own harness, Admin API, database, and playground ports, so its tests never
  // meet another worker's. A CI runner has four CPUs, which four workers' harnesses, playgrounds, and
  // browsers exhaust, so CI runs two.
  workers: process.env.CI ? 2 : 4,
})
