import { defineConfig } from 'vp'

// Runs real cross-origin iframe startup checks without the localnet browser suite.
export default defineConfig({
  test: {
    include: ['src/core/Dialog.startup.browser.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
