/** Configures formatting, lint, and tests for the `accounts` package through Vite+. @module */
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import { defineConfig } from 'vite-plus'

const ignorePatterns = [
  '**/dist/**',
  '**/node_modules/**',
  '.changeset/**',
  '.tempo-id/**',
]

/** The tests in `src/` and `scripts/`. */
const tests = Fs.globSync(['scripts/**/*.test.ts', 'src/**/*.test.ts'], {
  cwd: import.meta.dirname,
})

/**
 * The integration tests: each test that imports `test/`, which runs Tempo ID from the checkout that
 * `test/id.ts` prepares. Every other test needs no server.
 */
const integration = tests.filter((file) =>
  /from '(\.\.\/)+test\//.test(
    Fs.readFileSync(`${import.meta.dirname}/${file}`, 'utf8'),
  ),
)

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
    projects: [
      {
        extends: true,
        test: {
          exclude: integration,
          include: tests,
          name: 'unit',
        },
      },
      {
        extends: true,
        // The checkout's modules import its server's modules through its private package's name, as
        // its `tsconfig.json` maps them.
        resolve: {
          alias: [
            {
              find: /^@tempoxyz\/id-internal\/(app|internal)\//,
              replacement: `${import.meta.dirname}/.tempo-id/src/$1/`,
            },
          ],
        },
        test: {
          globalSetup: ['./test/integration.ts'],
          // Each harness starts workerd in `beforeAll`.
          hookTimeout: 30_000,
          include: integration,
          // A worker runs its files in one process, so it imports wrangler and the harness once. Each
          // file still starts its own workerd, and no file changes shared state.
          isolate: false,
          // A file waits on workerd, Postgres, and child processes for much of its time.
          maxWorkers: Os.availableParallelism(),
          name: 'integration',
          // Each harness starts workerd, and a test that signs in makes several round trips through it.
          testTimeout: 30_000,
        },
      },
    ],
  },
})
