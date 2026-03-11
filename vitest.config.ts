import { playwright } from '@vitest/browser-playwright'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@tempoxyz/accounts': join(import.meta.dirname, './src'),
    },
  },
  test: {
    retry: 3,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    reporters: process.env.CI ? ['tree'] : [],
    projects: [
      {
        extends: true,
        test: {
          exclude: ['./src/**/*.browser.test.ts'],
          include: ['./src/**/*.test.ts'],
          name: 'lib',
          globalSetup: [join(import.meta.dirname, './test/setup.global.ts')],
          setupFiles: [join(import.meta.dirname, './test/setup.ts')],
        },
      },
      {
        extends: true,
        test: {
          name: 'lib/browser',
          include: ['./src/**/*.browser.test.ts'],
          env: { VITE_RPC_PORT: '8546' },
          globalSetup: [join(import.meta.dirname, './test/setup.global.browser.ts')],
          setupFiles: [
            join(import.meta.dirname, './test/setup.ts'),
            join(import.meta.dirname, './test/authenticator.setup.ts'),
          ],
          browser: {
            enabled: true,
            headless: true,
            api: 63315,
            instances: [{ browser: 'chromium' }],
            provider: playwright(),
            screenshotFailures: false,
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'connect/browser',
          include: ['./connect/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            api: 63316,
            instances: [{ browser: 'chromium' }],
            provider: playwright(),
            screenshotFailures: false,
          },
        },
      },
    ],
  },
})
