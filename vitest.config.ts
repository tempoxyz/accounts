import { join } from 'node:path'
import { defineConfig } from 'vp'

export default defineConfig({
  resolve: {
    alias: {
      accounts: join(import.meta.dirname, './src'),
    },
    dedupe: ['vp', '@voidzero-dev/vite-plus-test'],
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
          include: ['./src/**/*.test.ts', '!./src/**/*.browser.test.ts'],
          name: 'lib',
          globalSetup: [join(import.meta.dirname, './test/setup.global.ts')],
          setupFiles: [join(import.meta.dirname, './test/setup.ts')],
        },
      },
      {
        extends: true,
        test: {
          include: ['./apps/connect/worker/**/*.test.ts'],
          name: 'connect/worker',
          globalSetup: [join(import.meta.dirname, './apps/connect/test/setup.ts')],
          hookTimeout: 60_000,
        },
      },
      // {
      //   extends: true,
      //   test: {
      //     name: 'lib/browser',
      //     include: ['./src/**/*.browser.test.ts'],
      //     hookTimeout: 30_000,
      //     testTimeout: 30_000,
      //     env: { VITE_RPC_PORT: '8546' },
      //     globalSetup: [join(import.meta.dirname, './test/setup.global.browser.ts')],
      //     setupFiles: [
      //       join(import.meta.dirname, './test/setup.ts'),
      //       join(import.meta.dirname, './test/authenticator.setup.ts'),
      //     ],
      //     browser: {
      //       enabled: true,
      //       headless: true,
      //       api: 63315,
      //       instances: [{ browser: 'chromium' }],
      //       provider: playwright(),
      //       screenshotFailures: false,
      //     },
      //   },
      // },
    ],
  },
})
