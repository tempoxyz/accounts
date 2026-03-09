import { playwright } from '@vitest/browser-playwright'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      zyzz: join(import.meta.dirname, './src'),
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
          name: 'core',
          globalSetup: [join(import.meta.dirname, './test/setup.global.ts')],
          setupFiles: [join(import.meta.dirname, './test/setup.ts')],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['./src/**/*.browser.test.ts'],
          globalSetup: [
            join(import.meta.dirname, './test/setup.global.ts'),
            join(import.meta.dirname, './test/webauthn.setup.global.ts'),
          ],
          setupFiles: [
            join(import.meta.dirname, './test/setup.ts'),
            join(import.meta.dirname, './test/authenticator.setup.ts'),
          ],
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: 'chromium' }],
            provider: playwright(),
            screenshotFailures: false,
          },
        },
      },
    ],
  },
})
