/** Configures formatting, lint, and tests for the `accounts` package through Vite+. @module */
import { defineConfig } from 'vite-plus'

const ignorePatterns = ['**/dist/**', '**/node_modules/**', '.changeset/**']

export default defineConfig({
  fmt: {
    ignorePatterns: [...ignorePatterns, 'CHANGELOG.md', 'pnpm-lock.yaml'],
    printWidth: 80,
    semi: false,
    singleQuote: true,
    sortPackageJson: false,
  },
  lint: {
    categories: { correctness: 'error' },
    ignorePatterns,
    // Type-aware rules read each file's `tsconfig.json`. `pnpm check:types` still checks types.
    options: { typeAware: true, typeCheck: false },
    rules: {
      // `Math.random()` is not cryptographically secure.
      'no-restricted-properties': [
        'error',
        {
          message: 'Use `crypto.getRandomValues()` or `crypto.randomUUID()`.',
          object: 'Math',
          property: 'random',
        },
      ],
      'no-unused-vars': 'error',
      'typescript/await-thenable': 'error',
      'typescript/no-base-to-string': 'off',
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/no-misused-spread': 'off',
      'typescript/require-await': 'error',
    },
  },
  test: {
    include: ['scripts/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
