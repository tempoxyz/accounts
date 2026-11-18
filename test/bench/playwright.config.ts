/**
 * Runs the grader of the integration bench, `grade.bench.ts`, for one trial. `trial.ts score` runs
 * it, against the stack that `stack.ts` starts.
 * @module
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  outputDir: '/tmp/bench/playwright',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A headless run otherwise uses the headless shell, which has no popup blocker.
        channel: 'chromium',
        launchOptions: {
          // A user's browser blocks a popup outside a click, so the grader's does too.
          ignoreDefaultArgs: ['--disable-popup-blocking'],
        },
      },
    },
  ],
  reporter: [['list']],
  testDir: '.',
  testMatch: 'grade.bench.ts',
  use: {
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    video: 'on',
  },
  workers: 1,
})
