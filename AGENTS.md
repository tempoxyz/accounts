# accounts — Agent Guidelines

> **Update after learnings or mistakes** — when a correction, new convention, or hard-won lesson emerges during development, append it to the relevant section of this file immediately. AGENTS.md is the source of truth for project conventions and should grow as the project does.

## TypeScript Conventions

- **Exact optional properties** — `exactOptionalPropertyTypes` is enabled in tsconfig. Optional properties must include `| undefined` in their type if they can be assigned `undefined` (e.g. `foo?: string | undefined`, not `foo?: string`).
- **No `readonly` on properties** — skip `readonly` on type properties.
- **`readonly` arrays** — use `readonly T[]` for array types in type definitions.
- **`type` over `interface`** — always use `type` for type definitions.
- **`.js` extensions** — all imports include `.js` for ESM compatibility.
- **Classes for errors only** — all other APIs use factory functions.
- **No enums** — use `as const` objects for fixed sets.
- **`const` generic modifier** — use to preserve literal types for full inference.
- **camelCase generics** — `<const args extends z.ZodObject<any>>` not `<T>`.
- **Options default `= {}`** — use `options: Options = {}` not `options?: Options`.
- **Namespace params and return types** — place function parameter and return types in a `declare namespace` matching the function name (e.g. `local.Options`, `createAccount.ReturnType`).
- **Minimal variable names** — prefer short, obvious names. Use `options` not `serveOptions`, `fn` not `callbackFunction`, etc. Context makes meaning clear.
- **No redundant type annotations** — if the return type of a function already covers it, don't annotate intermediate variables. Let the return type do the work (e.g. `const cli = { ... }` not `const cli: ReturnType = { ... }`).
- **Return directly** — don't declare a variable just to return it. Use `return { ... }` unless the variable is needed (e.g. self-reference for chaining).
- **Skip braces for single-statement blocks** — omit `{}` for single-statement `if`, `for`, etc.
- **No section separator comments** — don't use `// ---` or `// ===` divider comments. Let JSDoc and whitespace provide structure.
- **No dynamic imports** — use static `import` declarations. No `await import(...)` or `import(...)` expressions.
- **`as never` over `as any`** — when a type assertion is unavoidable, use `as never` instead of `as any`.
- **Destructure when accessing multiple properties** — prefer `const { a, b } = options` over repeated `options.a`, `options.b`.
- **`core_` prefix for import aliases** — when aliasing an import to avoid conflicts, use `core_<name>` (e.g. `import { local as core_local }`), not arbitrary camelCase.
- **`Hex.fromNumber` over `toString(16)`** — use `Hex.fromNumber(n)` from `ox` instead of `` `0x${n.toString(16)}` `` for number-to-hex conversion.
- **`Hex.Hex` over `` `0x${string}` ``** — use `Hex.Hex` from `ox` instead of the raw template literal type.

## Type Inference Conventions

- **`z.output<>` over `z.infer<>`** — use `z.output<schema>` for types after transforms/defaults are applied (what `schema.parse()` returns at runtime). Use `z.input<schema>` only when representing pre-validation types.
- **`const` generics on definitions** — any function that accepts Zod schemas and passes them to callbacks must use `const` generic parameters to preserve literal types (e.g. `<const args extends z.ZodObject<any>>`).
- **Flow schemas through generics** — when a factory function accepts Zod schemas, use generics to flow `z.output<>` through to callbacks (`run`, `next`), return types, and constraint types (`alias`). Never fall back to `any` in callback signatures.
- **Type tests in `.test-d.ts`** — use vitest's `expectTypeOf` in colocated `.test-d.ts` files to assert generic inference works. Type tests are first-class — write them alongside implementation, not as an afterthought.
- **No `any` leakage** — Zod schemas may use `z.ZodObject<any>` as a generic bound, but inferred types flowing to user-facing callbacks must be narrowed via `z.output<typeof schema>`. The user should never see `any` in their IDE.
- **Type inference after every feature** — after implementing any feature, check if new types can be narrowed. If a new property, callback, or return type touches a Zod schema, add generics to flow the inferred type through. Add or update `.test-d.ts` type tests alongside.

## Documentation Conventions

- **JSDoc on all exports** — every exported function, type, and constant gets a JSDoc comment. Type properties get JSDoc too. Namespace types (e.g. `declare namespace create { type Options }`) get JSDoc too. Doc-driven development: write the JSDoc before or alongside the implementation, not after.

## Protocol Conventions

- **CLI auth device codes are raw in protocol** — store, return, and query device codes as raw 8-character values (for example `ABCDEFGH`). Only apply hyphen formatting (`ABCD-EFGH`) when rendering for humans.
- **Keep CLI protocol looseness scoped** — if the CLI bootstrap/device-code flow needs a more permissive request shape than the shared SDK RPC contract, keep that looseness in the CLI/server-specific surface (for example `src/server/CliAuth.ts` and CLI adapter handling). Do not widen `src/core/zod/rpc.ts` or shared `wallet_authorizeAccessKey` semantics unless the change is explicitly intended SDK-wide.
- **Preserve WebAuthn signature-envelope magic when verifying RPC payloads** — `SignatureEnvelope.serialize(SignatureEnvelope.fromRpc(signature))` must pass `{ magic: true }` for `webAuthn` signatures, but not for secp256k1/p256 signatures. `viem/tempo` uses the magic suffix to route stateless verification through `SignatureEnvelope.verify(...)`.

## Type Conventions

- **No eager type definitions** — don't extract a named type until it's used in more than one place. Inline the shape (e.g. `{ address: Address }[]`) until a shared type is clearly needed.

## Abstraction Conventions

- **Prefer duplication over the wrong abstraction** — duplicated code with a clear bug-fix burden is better than a bad abstraction that is scary to change.
- **Don't abstract until the commonalities scream** — wait for 3+ concrete use cases where the right abstraction becomes obvious. Don't abstract for 1–2 instances.
- **Optimize for change** — code that is easy to change beats code that is cleverly DRY. We don't know future requirements.
- **No flags or mode parameters** — if an abstraction needs `if` branches or boolean params to handle different call sites, it's the wrong abstraction. Inline it.
- **Start concrete, extract later** — begin inline. Extract only when a clear pattern emerges across multiple real usages.
- **Keep server schemas out of `src/core/zod/rpc.ts`** — server-only modules must not import `src/core/zod/rpc.ts`. That file depends on `src/core/Schema.ts`, so reusing it from `src/server/*` can create runtime import cycles through provider schema initialization.

## Testing Conventions

- **Inline snapshots over direct assertions** — prefer `toMatchInlineSnapshot()` over `.toBe()`, `.toEqual()`, etc. for return values. Use `toThrowErrorMatchingInlineSnapshot()` for error assertions. Never use try/catch + `expect.unreachable()` for error tests.
- **Snapshot whole objects, omit nondeterministic properties** — destructure out nondeterministic fields (e.g. `blockHash`, `gasUsed`, timestamps) and snapshot the rest, rather than cherry-picking individual fields to assert.
- **Unit and type tests as you go** — write unit tests and `.test-d.ts` type tests alongside implementation for each module. Save high-level integration tests (with and without browser) for the end.

## Git Conventions

- **Conventional commits** — use `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:` prefixes. Scope is optional (e.g. `feat(parser): add array coercion`).

## Learned User Preferences

- **Dev-only UIs use semantic HTML only** — approval surfaces and debug pages should use plain HTML with no inline styles or CSS. Zero styling.
- **Short spinner messages** — keep `@clack/prompts` spinner text short to avoid terminal line wrapping; show URLs and long content as static `Clack.log.info()` lines, not inside spinner text.
- **Understand full request flow before changing CLI UX** — trace the complete path (CLI → server → browser → server → CLI polling) before modifying feedback or error handling in CLI scripts.

## Learned Workspace Facts

- **Expo/Metro should get built entrypoints via `react-native` export conditions** — React Native consumers may resolve package `exports` before `default`, and loading `src/*.ts` directly can fail on `.js`-suffixed relative imports. For mobile consumers, add a `react-native` condition that points at `dist/*` entrypoints.
- **Expo playgrounds under `pnpm` need a local app entry** — relying on Expo's default `expo/AppEntry` can resolve `../../App` from the symlinked package-store path instead of the playground directory. Set a local `main` (for example `./index.js`) and register the root component there.
- **`zile dev` symlinked `dist/*` is not Metro-safe** — when local `dist/*.js` entrypoints symlink back to `src/*.ts`, Metro will follow them and choke on `.js`-suffixed relative imports inside source. For React Native playgrounds in this workspace, use a local Metro resolver shim (or real built files) instead of assuming symlinked `dist` is consumable.
- **React Native may expose `window` without browser event constructors** — in Expo/React Native, `window` can exist while `CustomEvent` does not. Browser-only provider announcement logic must guard on both `window` and `CustomEvent` before calling EIP-6963-style event helpers.
- **React Native may expose `window` without IndexedDB** — storage defaults that mean “browser” should guard on `indexedDB`, not `window`, or Expo/React Native can try to use IndexedDB-backed storage and throw at startup.
- **Playground `run_worker_first`** — `playgrounds/web/wrangler.jsonc` `assets.run_worker_first` must list all API route patterns (e.g. `/cli-auth/**`). POST requests to unlisted paths fall through to the static assets / SPA layer and return 405.
- **Shared UI/API base paths need exact matches** — when an SPA page and API share a base path like `/cli-auth`, `assets.run_worker_first` must include both the exact base path (`/cli-auth`) and the wildcard children (`/cli-auth/*`) so the worker can handle `POST /cli-auth` while still delegating `GET /cli-auth` back to assets.
- **Avoid `React.use()` for local API fetches in Cloudflare/Vite approval pages** — in the `ref-impls/cli-auth` setup, using `use()` on a promise that fetches `/cli-auth/pending/:code` pulled the request into the Cloudflare/Vite server-render path and triggered `fetch failed` loops in dev. Keep the pending-request load client-side with a normal effect or equivalent.
- **CLI scripts tooling** — playground CLI scripts (`playgrounds/web/scripts/`) use `@clack/prompts` (interactive UI), `@bomb.sh/args` (flag parsing), and `@bomb.sh/tab` (shell completions).
- **Wallet app exposes `/embed/cli-auth/*` aliases** — when targeting the real wallet from provider-driven examples, point the CLI host at `/embed/cli-auth`; the browser route and device-code API aliases live under the same base path there.
- **Workspace examples may need source imports** — when an example must reflect unpublished local SDK changes immediately, import the local `src/*` modules instead of the package entrypoint so it does not silently use stale `dist/*` output.
- **`dialog` is a git submodule** — points to `git@github.com:tempoxyz/app.git`. Initialize with `git submodule update --init --recursive`.
- **`VITE_NODE_TAG`** — accepts a Docker image tag (e.g. `latest`, `sha-abc123`) or an HTTP RPC URL (e.g. `https://rpc.moderato.tempo.xyz`) that resolves to a `sha-<hash>` tag via `web3_clientVersion`.
- **Deduplicate `vp` in Vitest config** — in this workspace, mixed peer resolution (for example different `@types/node` versions across packages) can load two `vp` instances and break suite initialization; set `resolve.dedupe` to include `vp`.
- **CLI auth example URL inputs** — the example CLI flow is expected to support both `--url` and `AUTH_URL`-based defaults, and should avoid hardcoded personal hostnames in source.
- **Test RPC port selection should auto-fallback** — localnet test setup should start from `VITE_RPC_PORT` (or `8545`) and select the next available port to avoid `EADDRINUSE` collisions.
