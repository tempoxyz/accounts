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
- **Don't repeat the module name in exports** — if the module is `mode.ts`, export `get` not `getMode`. Callers write `Mode.get()` which already reads clearly.
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
- **IIFE over nested ternaries** — avoid complex nested ternary expressions. Use an IIFE block expression with early returns instead:
  ```tsx
  // ✗ Bad: nested ternaries
  const subtitle = a ? <A /> : b ? <B /> : 'default'

  // ✓ Good: IIFE with early returns
  const subtitle = (() => {
    if (a) return <A />
    if (b) return <B />
    return 'default'
  })()
  ```

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
- **No section separator comments** — don't use `// ---` or `// ===` divider comments. Let JSDoc and whitespace provide structure.

## UI Component Conventions

- **Base UI first** — before building a custom UI component, check if [Base UI](https://base-ui.com) (`@base-ui/react`) already provides an unstyled primitive for it (e.g. OTP Field, Dialog, Select, Menu, Checkbox, etc.). Use the Base UI primitive as the foundation and style it with Tailwind/CVA. Only build from scratch when no Base UI component covers the use case.

## React Component Conventions

- **Colocate components in the file** — don't extract into separate component files until reusability is needed. Place helper components at the bottom of the file that uses them.
- **Comment non-obvious intent** — add short inline comments next to code whose purpose isn't immediately clear from the code itself (e.g. mode branches, workarounds, why something is conditional). Don't comment what the code does — comment why.
- **Prefer Tailwind over style attributes** — use Tailwind utility classes instead of inline `style` props. Only use `style` for truly dynamic values that can't be expressed as utilities.
- **Update the design reference page** — when altering the Tailwind theme (colors, typography tokens) or adding/changing shared UI components, update `apps/connect/src/routes/design.tsx` to reflect the changes.
- **CVA for variant styles** — use `cva` for any component with visual variants (size, intent, state). Define variants declaratively instead of hand-rolling conditional class logic.
- **`data-` attributes over ternaries** — express boolean/enum states as `data-*` attributes on the element and target them with Tailwind's `data-*:` variants instead of ternary expressions in `className`. For example, `data-active={active}` with `data-active:bg-gray-2` instead of `${active ? 'bg-gray-2' : ''}`.
- **`cx` for class composition** — use `cx` from `cva` to merge class strings. Prefer `cx` over template literals for conditional classes.
- **Alphabetize props** — order destructured props, type properties, and JSX attributes alphabetically.
- **No margin for spacing** — use `gap` on the parent or `padding` instead of `mt-*`/`mb-*`/`ml-*`/`mr-*`. Margin creates invisible coupling between siblings; gap and padding keep spacing ownership clear.

## Dark Mode

- **No `dark:` prefix** — never use Tailwind's `dark:` variant. It uses `prefers-color-scheme` media query which ignores the `color-scheme` property set by the theme toggle. Instead, use `light-dark()` CSS custom properties in `styles.css` and reference them as Tailwind color tokens. All color tokens already adapt via `light-dark()`.

## Color System

The color system follows the Geist design system with 8 chromatic scales (gray, blue, red, amber, green, teal, purple, pink) and 10 steps per scale. Colors are defined in `apps/connect/src/styles.css` using `oklch` P3 values inside `light-dark()`.

### Backgrounds

- **Background 1** (`--bg-100`): default page/element background. Use in most cases — especially when color sits on top.
- **Background 2** (`--bg-200`): secondary/recessed background. Use sparingly for subtle differentiation.

### Scale Steps

- **Steps 1–3 (Component Backgrounds)**: UI component fills. Step 1 = default, 2 = hover, 3 = active. If the component's default bg is Background 1, shift up: 1 = hover, 2 = active. Use 2–3 for small elements like badges.
- **Steps 4–6 (Borders)**: UI component borders. Step 4 = default, 5 = hover, 6 = active.
- **Steps 7–8 (High Contrast Backgrounds)**: solid fills for high-contrast components (buttons, toggles, progress bars). Step 7 = default, 8 = hover. Same value in light and dark mode — use these for button fills, not steps 9–10.
- **Steps 9–10 (Text & Icons)**: accessible foreground colors. Step 9 = secondary text/icons, 10 = primary text/icons. These invert lightness between themes (dark in light mode, light in dark mode) — never use them for backgrounds or fills.

### Usage Rules

- **Solid button fills** use steps 7–8 (same in both themes). Never use 9–10 for fills — they flip lightness across themes.
- **Text on colored backgrounds** must contrast: use `text-white` or `text-black` on 7–8 fills, not scale text colors.
- **Gray scale** is achromatic (`oklch(L% 0 0)`). All chromatic scales use P3 oklch values.
- **Semantic aliases**: `--color-foreground` = gray-10, `--color-foreground-secondary` = gray-9, `--color-border` = gray-4, `--color-border-hover` = gray-5, `--color-border-active` = gray-6.

## Design Guidelines

Reference when building, reviewing, or refactoring UI components and interactions.

### Interactions

- **Keyboard works everywhere.** All flows are keyboard-operable & follow WAI-ARIA Authoring Patterns.
- **Clear focus.** Use `:focus-visible` (not `:focus`). Add `:focus-within` for grouped controls.
- **Match visual & hit targets.** If visual target < 24px, expand hit target to ≥ 24px. On mobile, minimum is 44px.
- **Loading buttons.** Show a loading indicator **and** keep the original label visible.
- **Minimum loading-state duration.** Add a show-delay (~150–300ms) and a minimum visible time (~300–500ms) to avoid flicker.
- **URL as state.** Persist filters, tabs, pagination, expanded panels in the URL so share, refresh, and Back/Forward work.
- **Optimistic updates.** Update UI immediately when success is likely. On failure, show an error & roll back or offer Undo.
- **Ellipsis for further input & loading.** Menu items that open follow-up dialogs end with `…` (e.g., "Rename…"). Loading labels end with `…` (e.g., "Saving…").
- **Confirm destructive actions.** Require confirmation or provide Undo with a safe window.
- **Tooltip timing.** Delay the first tooltip in a group; subsequent peer tooltips show with no delay.
- **Autofocus for speed.** On desktop screens with a single primary input, autofocus it. Avoid on mobile (keyboard causes layout shift).
- **Links are links.** Use `<a>` (or framework `<Link>`) for navigation — never `<button>` or `<div>`.
- **Don't block paste.** Never disable paste in `<input>` or `<textarea>`.
- **Mobile input size.** `<input>` font size ≥ 16px on mobile to prevent iOS Safari auto-zoom.

### Animations

- **Honor `prefers-reduced-motion`.** Always provide a reduced-motion variant.
- **Implementation preference.** CSS → Web Animations API → JS libraries (e.g., `motion`).
- **GPU-accelerated properties.** Stick to `transform` and `opacity`. Avoid `width`, `height`, `top`, `left`.
- **Never `transition: all`.** Explicitly list only the properties you animate.
- **Interruptible.** Animations are cancelable by user input.

### Layout

- **Optical alignment.** Adjust ±1px when perception beats geometry.
- **Responsive coverage.** Verify on mobile, laptop, and ultra-wide.
- **Let the browser size things.** Prefer flex/grid/intrinsic layout over JS measuring.

### Content

- **Inline help first.** Prefer inline explanations; use tooltips as a last resort.
- **Stable skeletons.** Skeletons mirror final content exactly to avoid layout shift.
- **All states designed.** Empty, sparse, dense, and error states.
- **Tabular numbers for comparisons.** Use `font-variant-numeric: tabular-nums` for numeric columns.
- **Icons have labels.** `aria-label` on icon-only buttons.
- **Semantics before ARIA.** Prefer native elements (`button`, `a`, `label`, `table`) before `aria-*`.
- **No dead ends.** Every screen offers a next step or recovery path.

### Forms

- **Enter submits.** When a text input is focused, Enter submits. In `<textarea>`, ⌘/⌃+Enter submits.
- **Labels everywhere.** Every control has a `<label>` or is associated with one.
- **Don't block typing.** Even number-only fields allow any input and show validation feedback.
- **Don't pre-disable submit.** Allow submitting incomplete forms to surface validation feedback.
- **Error placement.** Show errors next to their fields. On submit, focus the first error.
- **Placeholder with ellipsis.** End placeholders with `…`. Set an example value (e.g., `sk-012345679…`).

### Design

- **Layered shadows.** Mimic ambient + direct light with at least two shadow layers.
- **Crisp borders.** Combine borders and shadows; semi-transparent borders improve edge clarity.
- **Nested radii.** Child radius ≤ parent radius, concentric so curves align.
- **Interactions increase contrast.** `:hover`, `:active`, `:focus` states have more contrast than rest.
- **Minimum contrast.** Prefer APCA over WCAG 2 for perceptual accuracy.

### Performance

- **Minimize re-renders.** Track with React DevTools or React Scan.
- **Network latency budgets.** `POST`/`PATCH`/`DELETE` complete in < 500ms.
- **Virtualize large lists.** Use virtualization or `content-visibility: auto`.
- **No image-caused CLS.** Set explicit image dimensions and reserve space.

## Learned User Preferences

- **Dev-only UIs use semantic HTML only** — approval surfaces and debug pages should use plain HTML with no inline styles or CSS. Zero styling.
- **Short spinner messages** — keep `@clack/prompts` spinner text short to avoid terminal line wrapping; show URLs and long content as static `Clack.log.info()` lines, not inside spinner text.
- **Understand full request flow before changing CLI UX** — trace the complete path (CLI → server → browser → server → CLI polling) before modifying feedback or error handling in CLI scripts.

## Learned Workspace Facts

- **Expo/Metro should get built entrypoints via `react-native` export conditions** — React Native consumers may resolve package `exports` before `default`, and loading `src/*.ts` directly can fail on `.js`-suffixed relative imports. For mobile consumers, add a `react-native` condition that points at `dist/*` entrypoints.
- **React Native may expose `window` without browser event constructors** — in Expo/React Native, `window` can exist while `CustomEvent` does not. Browser-only provider announcement logic must guard on both `window` and `CustomEvent` before calling EIP-6963-style event helpers.
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
- **`process.env` over `c.env` for string secrets** — in CF Workers, prefer `process.env` for string env vars and secrets (e.g. `SESSION_PRIVATE_KEY`, `MAILGUN_API_KEY`). Use `c.env` only for non-string bindings that require it (KVNamespace, RateLimit, Hyperdrive, etc.).
