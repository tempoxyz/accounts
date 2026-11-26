/** Configures formatting, lint, and tests for the `accounts` package through Vite+. @module */
import { defineConfig } from 'vite-plus'
import * as Transform from './test/waterfall/Transform.js'

const ignorePatterns = ['**/dist/**', '**/node_modules/**', '.changeset/**']

export default defineConfig({
  fmt: {
    // `uphill --update` writes the baseline file.
    ignorePatterns: [
      ...ignorePatterns,
      '.agents/uphill.baseline.yaml',
      'CHANGELOG.md',
      'pnpm-lock.yaml',
    ],
    overrides: [
      {
        // A code fence of a page holds `// [!code ++]` notation at the end of a line, which a
        // format of the fence moves to its own line.
        files: ['site/src/pages/**/*.mdx'],
        options: { embeddedLanguageFormatting: 'off' },
      },
    ],
    printWidth: 80,
    semi: false,
    singleQuote: true,
    sortPackageJson: false,
  },
  lint: {
    categories: { correctness: 'error' },
    // The bench's starters and oracles install their own packages in each trial.
    ignorePatterns: [
      ...ignorePatterns,
      'test/bench/oracles/**',
      'test/bench/starters/**',
    ],
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
  // `pnpm waterfall --local` records each action's calls. Off by default, the tests load the package as
  // it is.
  plugins:
    process.env.ACCOUNTS_WATERFALL === 'true' ? [Transform.plugin()] : [],
  test: {
    include: ['scripts/**/*.test.ts', 'src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
