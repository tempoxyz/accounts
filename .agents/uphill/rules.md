# Rules

Uphill writes these rules from each metric's `description`. Write code that meets them. `uphill` scores each metric against its target, and `uphill --compare HEAD --compact` lists what a change made worse.

## Footprint

- Keep the initial load of each typical use small. Load each flow that a user starts, such as a passkey ceremony, with a dynamic import. At most 20 kB.
- Keep every chunk of each typical use small, including each lazy flow. Reuse the dependencies of the initial load. At most 60 kB.
- Add a runtime dependency only with a stated reason. Prefer ox, XState, and Viem, which the package already loads.
- Add a required peer dependency only with a stated reason, because every app installs it. Make a platform library an optional peer.
- Keep the gzipped bundle small for a consumer that imports one export. Do not pull unrelated modules or packages into an export. At most 10 kB.
- Make each entry point bundle to nothing when unused. Annotate top-level calls with `/*#__PURE__*/`, and avoid runtime TypeScript namespaces and static class fields.
- Keep the gzipped bundle of each hot item especially small. At most 25 kB.

## Speed

- Keep the work that each request repeats near the cost of its signatures. Import each public key once per key, not once per request.
- Keep the heap bytes that each request allocates beside its signatures small. Parse each token and proof once. At most 4 kB.
- Keep each entry point fast to import. Avoid work at module scope. At most 60 ms.
- Keep the heap that each entry point holds once imported small. At most 3.5 MB.
- Keep each hot entry point especially fast to import. At most 60 ms.
- Keep the heap that each hot entry point holds once imported especially small. At most 3.5 MB.

## Types

- Keep each public export cheap to type-check. Avoid types that need many instantiations to resolve. At most 300.
- Keep each public export fast to type-check. At most 2 ms.
- Keep the heap bytes that type-checking each public export allocates small. At most 1 MB.
- Keep the instantiations of each benchmarked type test low, within any count the test pins. At most 20000.
- Keep each hot export especially cheap to type-check. At most 1000.

## Call types

- Keep each public function cheap to type-check at the call sites that the tests write. At most 200.
- Keep each hot function especially cheap to type-check at its call sites. At most 1000.

## Documentation

- Start each TypeScript file with a TSDoc `@module` comment that describes its responsibility.
- Document every export with TSDoc. Overloads share the comment on the first signature.
- Document every property of an exported type with TSDoc.
- Keep each sentence in a paragraph to 25 words or fewer.
- Keep each paragraph to about 40 words, and never more than 50.
- Keep each paragraph to six sentences or fewer.
- Use the active voice. Avoid passive phrases such as "is processed" (write-good `passive`).
- Use the short word instead of a wordy phrase, such as "to" for "in order to" (write-good `tooWordy`).
- Avoid weasel words such as "very" (write-good `weasel`).
- Write about the code, not the reader. Avoid "you", "your", and "yourself".
- Use precise verbs such as "returns" or "reports", not get, give, hand, know, say, see, or tell.
- Use the imperative, simple present, simple past, or simple future. Do not use a progressive or perfect form.
- Write "for example" and "that is" instead of "e.g.", "i.e.", and "etc.".
- Do not use semicolons in prose. Split the sentence, or use a comma, colon, or parenthesis.
- Do not use em dashes in prose. Split the sentence, or use a comma, colon, or parenthesis.
- Do not use emoji in prose.

## Commits

- Start each commit header with a conventional type, such as `feat:` or `fix:`, and a subject (commitlint `type-enum`, `type-case`, `type-empty`, and `subject-empty`).
- Start each subject in lowercase (commitlint `subject-case`).
- End each subject without a period (commitlint `subject-full-stop`).
- Keep each commit header to 100 characters or fewer (commitlint `header-max-length`).
- Put a blank line before the body and the footer, and wrap them at 100 characters (commitlint `body-leading-blank`, `body-max-line-length`, and the matching footer rules).
- State the change in the subject, not the reason. Leave out "because", "so that", and "in order to".
- Open each subject with a verb in its base form, such as "add", not "adds" or "added".
- Add or edit a test source file in each `fix:` commit.

## Waterfall

- Never add a round trip to a flow. Run independent calls in `Promise.all`, and return the next step's data from the step that has it.
- Make no call twice in one action. Reuse the result of an earlier read with the same arguments, unless a write comes between them.
- Add a store read, a request, or an RPC call to an action only when its flow needs the data.

## Correctness

- Fix every type error. Run the project's `tsc` or `tsgo` to check.
- Set `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax` in tsconfig.json. Treat them as design constraints.
- Avoid `any`. Use a precise type, validation, or narrowing (oxlint `typescript/no-explicit-any`).
- Fix every report of the project's linter with its own configuration.
- Use `crypto.getRandomValues()`, not `Math.random()` (oxlint `eslint/no-restricted-properties`).
- Do not log through `console` in files under `src/` (oxlint `eslint/no-console`).

## Style

- Format each TypeScript file with the project's formatter and its own configuration.
- Avoid enums. Use unions or `as const` objects.
- Declare shapes with `type`, not `interface` (oxlint `typescript/consistent-type-definitions`).
- Annotate arrays as `readonly T[]`. Keep an array mutable only where code mutates the binding or a function's result.
- Name the file extension in each import, so the source stays valid under NodeNext (oxlint `import/extensions`).
- Use `import type` and `export type` for type-only imports and exports.
- Name module constants in camelCase, not UPPER_CASE.
- Default option bags in the signature (`options: fn.Options = {}`), not with `options?`.
- Name option bags `options`, not `args`, `opts`, or `params`.
- Give each function at most two positional parameters, a receiver and then an options bag (oxlint `eslint/max-params`).
- Do not destructure parameters in the signature. Take each parameter whole and destructure it in the body.
- Avoid nested ternaries. Use an IIFE with early returns (oxlint `eslint/no-nested-ternary`).
- Do not annotate local variables with inline object types. Name the type above the use.
- Put a function's types in its namespace (`create.Options`), not beside it (`CreateOptions`).
- Return values directly. Do not bind a value only to return it on the next line.
- Derive a fallible value in an IIFE, not in a `let` assigned across `try` and `catch`.
- Do not write section-divider comments, such as `// ----`.
- Leave no trailing whitespace, blank lines at the end, or conflict markers in a tracked text file (`git diff --check`).
- Start each GitHub workflow with `name` and `on`, then list its other top-level keys in alphabetical order.

## Architecture

- Avoid import cycles. No module may import itself through other modules (oxlint `import/no-cycle`).
- Import module-shaped files, such as `./Store.js`, as namespaces (`import * as Store`). Types and components may use named imports.
- Import Node built-ins as namespaces (`import * as fs from 'node:fs'`).
- Re-export modules as namespaces (`export * as Store`). Do not flatten them into a barrel with `export *` or `export { … } from`.
- Use static imports. Use a dynamic import only at a real runtime or bundle boundary.
- Do not import modules for their side effects, such as `import './register.js'` (oxlint `import/no-unassigned-import`).
- Use functions and plain data. Limit classes to errors and framework entrypoints.
- Set a namespaced `name` on each error class, such as `'Config.InvalidError'`.
- Use `this` only in classes. Make factories close over their state.
- Keep only constants at module scope. Do not use a module-scope `let` or an empty `Map` or `Set` cache.

## Testing

- Test with real implementations. Do not use `vi.mock`, `vi.fn`, fake timers, stubbed globals, or mocking packages (oxlint restricted-method and restricted-import rules).
- Assert with inline snapshots in TypeScript tests, not with `toBe` or `toEqual`.
- Keep snapshots inline. Do not commit snapshot files.
- Wait for observable conditions in tests, not with `setTimeout` or `Bun.sleep` (oxlint restricted-global and restricted-property rules).
- Write one test file per module. Do not split it into `Module.context.test.ts` files.

## Configuration

- Write source files in TypeScript, not JavaScript. Configuration files are exempt.
- Declare `sideEffects` as a boolean or a file-pattern list in each named, non-private package.
- Reference dependency versions with `catalog:` in each package.json of a pnpm workspace.
- Run TypeScript scripts directly, not through `tsx` or `ts-node`.
- Keep the dependencies and scripts of each package.json in alphabetical order.

## Type coverage

- Call each public function in the runtime or type tests. Make sure the imports and fixtures of that call resolve.
