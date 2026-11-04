# Agent Guidelines

## Project Principles

- `accounts` is the SDK of Tempo ID (`id.tempo.xyz`). Apps use it to sign users in, keep their session and access key, and act on Tempo with it.
- `tempoxyz/id` holds the server, its HTTP API, and its docs. This repository holds the package, its docs, `examples/`, and `playgrounds/`.
- The package runs in browsers, React Native, Node, and Workers. Entries stay free of platform imports, except `accounts/cloudflare`, `accounts/expo`, and `index.native.ts`.
- Tempo ID issues every token. The package holds tokens and access keys only in the instance's `store`.
- Tokens, refresh tokens, client secrets, private keys, and DPoP keys never appear in errors, events, or logs.
- Redirect or post only to a configured `redirectUri` or Tempo ID's own origin.
- Loopback redirects are banned. CLIs use device grants. Web apps use popups, redirects, or the dialog.
- Use Viem's TIP-1130 APIs (`Oidc`, `Actions.oidc.prove`, `Relay.oidc`, `Relay.feePayer`) and ox. Do not reimplement protocol logic from Viem, ox, or wata.
- Call precompiles through `viem/tempo` actions (`Actions.token.transferSync`) and `wagmi/tempo` hooks (`Hooks.token.useTransferSync`). Never encode a precompile call with `erc20Abi`, `parseAbi`, or `encodeFunctionData`, anywhere.

## TypeScript Conventions

- Treat `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` as constraints. Add `| undefined` where an optional property can receive `undefined`. Narrow indexed reads.
- Use `readonly T[]`, unless mutation is part of the contract.
- Use `type`. Use `interface` only for declaration merging, such as `cloudflare:workers` in `src/cloudflare/workers.d.ts`.
- Use `.js` extensions on relative imports.
- Write everything in TypeScript. `.js` files are banned. Run scripts with `node script.ts`. `scripts/publish.mjs` is the one exception.
- Import internal modules as namespaces (`import * as Session from './Session.js'`). Named imports are fine for types, leaf helpers, and third-party APIs.
- Import Node built-ins as namespaces, unless a named import is clearer.
- Use static imports. Use dynamic imports only at a real runtime or bundle boundary, such as `Store.file`'s Node modules.
- Use `import type` and `export type` for type-only imports and exports.
- Use functions and plain data. Classes are only for errors and framework entrypoints such as Durable Objects.
- Put error classes at the top of the module, after imports, in alphabetical order. Name them in namespaced form, such as `Accounts.RequestError`.
- Use unions or `as const` objects, not enums.
- Use `camelCase` constants, unless the name mirrors an external protocol.
- Use `const` generics when callers keep literal or tuple types.
- Default option bags in the signature: `options: fn.Options = {}`.
- Name option bags `options`.
- Take at most two positional parameters: an optional receiver (`tempoId`, `client`, `store`) or the inspected value (`error`, `session`), then one options object.

  ```ts
  Actions.authorize(tempoId, { permissions }) // not authorize(tempoId, permissions)
  Store.file({ path }) // not file(path)
  ```

  Exempt: framework-dictated signatures, such as callbacks and Durable Object methods.

- Put a function's types in a matching `declare namespace` (`create.Options`, `create.ReturnType`, `create.ErrorType`).
- Do not annotate locals with inline object types. Name the type above the use instead.
- Give each module that owns a public data type a `from` instantiator (`Permissions.from({ ... })`). Do not annotate, `as`, or `satisfies` the binding.
- Extract a named type only when it is reused or clarifies a hard shape.
- Keep shared domain types beside the module that owns the concept.
- Group Zod schemas in a `schema` namespace, with derived types beside them. Export it only when another module validates the same shape.
- Let declared return types constrain expressions. Avoid redundant annotations.
- Return values directly unless a binding is reused or names a complex expression.
- Use an IIFE with early returns instead of nested ternaries, or a mutable variable across `try`/`catch`.
- Never destructure parameters in definitions. Destructure in the body.
- Declare props as `Component.Props` in the component's namespace.
- Prefer short names clear from context: `options`, `client`, `entry`, `fn`.
- On a name conflict, keep the existing name and suffix the new one, such as `revoke_remote`. No synonyms or past tenses.
- Keep order-sensitive shapes (wire formats, tuples, protocol fields) in their order.
- Avoid new `any`.
- Separate logical steps with one blank line: setup, guards, derivation, mutation, return.
- Keep a lookup with its guard, and consecutive assertions together. Avoid both dense blocks and a blank line after every statement.
- Separate test setup, execution, and assertions.
- No section-divider comments.
- Comment invariants and non-obvious reasons only. Never reference plans, task IDs, or prior versions.

## Alphabetical Ordering

- Alphabetize imports, specifiers, exports, type and object properties, union members, unordered lists, config maps, scripts, and dependencies. Case-insensitive.
- Keep docs with their declaration, and overloads with their namespace. Never reorder execution or cause use-before-initialization.
- Preserve meaningful order: plugin arrays, Vite plugins, CSS declarations, tuples, workflow steps. Comment intentional exceptions.
- In GitHub workflows, keep `name` and `on` first, then alphabetize.

## Module and Instance Conventions

- One module is one namespace of types, constants, functions, and errors, read as `Module.operation(...)`.
- Exported modules sit at the top of `src/`. Everything else goes in `src/internal/`.
- Prefer stateless functions. Create an instance only for dependencies or lifecycle state, through `Module.create(options)` returning a plain object.
- `Accounts.create` is the authoritative instance. Plugins and actions derive from it. No module-scope singletons.
- Inject platform capabilities (fetch, storage, clock, `open`) through options. Keep them out of pure modules.
- Type dependencies by the smallest capability used.
- Factory operations close over state. Never depend on `this`.
- Keep caches and registries private to the instance.
- No side-effect registration. `sideEffects` in `package.json` lists the only exceptions, the React Native polyfills.
- Framework classes, such as Durable Objects, stay thin and delegate to module functions.

## Type Inference Conventions

- Preserve literal inputs through helpers when they affect the output type.
- Keep generics flowing through callbacks and returns. Never erase them to `any`.
- Plugins extend the instance's type. Keep each plugin's additions inferred from `Plugin.from`.

## Abstraction Conventions

- Start concrete. Extract after three uses reveal a stable contract.
- Prefer small duplication over an abstraction with flags or modes.
- Optimize for change, not DRYness.
- Keep state, config, schemas, and constants in one place, and derive the rest.
- No wrappers that only rename a function or mirror an SDK.

## State Machines

Use XState v5 for lifecycles and `@xstate/store` for event-driven stores. Zustand, Redux, and `let`-flag stores are banned. `machines.session` in `src/internal/session.ts` is the reference.

| State                                                      | Model                                |
| ---------------------------------------------------------- | ------------------------------------ |
| One value with two or three cases                          | A union `let`                        |
| Several values that change together, with no states        | An `@xstate/store` store             |
| A lifecycle with async events, timers, overlaps, or guards | An XState machine                    |
| A value that combines two or more flags or statuses        | A state of an XState machine         |
| Server data in an app                                      | TanStack Query, in the app, not here |

- A compound conditional over state is an unnamed state. Lift it into a machine:
  - A value that combines flags with `&&`, `||`, or a ternary, such as `restoring = status === 'pending' || (status === 'idle' && stored)`.
  - A guard that combines flags, such as `if (!session || closing || closed) return`.
- State is a value that changes over time: `let`, `useState`, `useRef`, and snapshot reads.
- Rate a conditional by its state operands, the reads of state that it combines. Count a read once, however often it repeats:

  | Complexity | The conditional                                                                         | Model                          |
  | ---------- | --------------------------------------------------------------------------------------- | ------------------------------ |
  | Low        | Reads one or two state operands with one operator, such as `closed \|\| !session`       | Inline                         |
  | Medium     | Reads three state operands, or mixes `&&` and `\|\|`, or reads another derived flag     | A machine state, tag, or guard |
  | High       | Reads four or more state operands, nests a ternary, or repeats across several functions | A machine state, tag, or guard |

- If a conditional rates medium or high, use a machine. If a low conditional grows, rate it again.
- Name each combination as a state or tag. Read it with a selector, such as `machines.status(snapshot)`.
- Input validation, type guards, and checks of request fields are not state. Compound conditionals there are acceptable.
- Do not write a machine for a linear async function, such as a retry loop.
- Replace `let` flags with one machine. The snapshot is the only source of state.
- Never hold one value in both a store and a machine.

**Persistence**

- Persist a store with `persist` from `@xstate/store/persist`, with `skipHydration: true`. Call `rehydrateStore` in the owning lifecycle.
- Persist a machine through a provided action, such as `save`. Never use `getPersistedSnapshot`.
- The session's write queue lives in `src/internal/session.ts`. Its non-extractable `CryptoKey` needs IndexedDB. A failed save rejects its change.

**Structure**

- Put each machine in `export namespace machines` at the bottom of the module that runs it.
- Define each machine as `export const <name> = setup(...).createMachine(...)` in `machines`, read as `machines.session`.
- Merge a type-only `export namespace <name>` with it for `Context`, `Event`, `Actor`, and `Snapshot`, read as `machines.session.Snapshot`. Derive `Actor` from `typeof <name>`.
- Put readers and pure decisions beside the machine, as `export function`s of `machines`, such as `machines.status(snapshot)`.
- Inside `machines`, refer to a machine's types through its namespace, such as `session.Event`. A bare `Event` names the DOM's.
- Module-scope code above `machines` runs before it, so it never reads `machines`. Keep a constant it needs at the top of the module.
- Keep machines pure: no I/O, clock, or bindings. The runner provides effects with `machine.provide({ actions })`.
- Define with `setup({ actions, guards, types }).createMachine({...})`. Name every action and guard, including `assign`s.
- Callbacks take one parameter, `args`, and narrow with `assertEvent(args.event, type)`.
- Declare provided actions as no-ops in `setup`, with TSDoc naming the provider.
- Type with `types: { context: {} as Context, events: {} as Event }`. Export `Context` and `Event` with TSDoc on every member.
- Export `type Actor`, `type Snapshot`, and snapshot readers such as `status(snapshot)`. Never compare `snapshot.value` across modules.
- Export pure decisions that transitions do not express, such as which session a sign-out revokes.

**States, events, and context**

- Name states for what is true, in camelCase: `pending`, `signedIn`. App-read states are public API.
- Name events for what happened, in dot notation: `authorize.start`, `signOut.join`. Events carry only what the transition needs.
- `context` holds only what states cannot express. Never a promise, stub, or client.
- Change `context` only with `assign`.
- Derive a multi-value status in one exported `select(context)`, with its priority table in TSDoc. Route changes through a transient state, such as `settling`, with one parameterized guard.
- Prefer per-state transitions. Use root `on` only for events every state handles the same way.
- Use `after` for timers, and `invoke` with `fromPromise` or `fromCallback` for state-owned work. No timer IDs or `AbortController`s beside a machine.

**Running a machine**

- Create actors with `createActor(machine).start()` in the owning lifecycle, never at module scope.
- `send` is synchronous.
- Wait with `waitFor(actor, predicate)`.
- Expose actors read-only. For common reads, expose a stable `{ get, subscribe }` pair, such as `tempoId.session.status`.
- `accounts` does not depend on `@xstate/react`. It reads `{ get, subscribe }` with `useSyncExternalStore`.

**Testing**

- Test a module's machines in its `<module>.test.ts`, in a `describe('machines.<name>')` per machine, without I/O or a harness.
- Arrange, act, assert: start the actor, send a flow's events, assert `snapshot.value` and changed `context`.
- Assert effects by recording provided actions' arguments in an array. No `vi.fn`. Never replace a guard.
- Provide invoked actors with scripted `fromPromise` results, and assert their inputs.
- Cover the graph with `getShortestPaths` from `xstate/graph`:
  - Build `events` from a `Record` keyed by every `Event` type, offering only events the runner sends from each state.
  - Assert with `snapshot.can(event)` that every type is handled somewhere.
  - Give `serializeState` the status values, not growing counters.
- At each path's end, assert the state is `select(context)`, and the raw context agrees with the state.
- Never use `getSimplePaths`.
- Assert that no path ends in a transient state.
- Test pure decision functions with a table, one `test` per row.

## Runtime Conventions

- Module scope holds only constants and immutable data. Never cache a `Request`, `Response`, stream, or session there.
- Read `Date.now()` inside the call, never at module scope.
- Use `crypto.getRandomValues()` and `crypto.randomUUID()`. `Math.random()` is banned.
- Compare secrets in constant time with `crypto.subtle.timingSafeEqual`, after SHA-256 for variable lengths.
- Await or return every promise. Mark `void` only with a reason.
- Run independent calls in `Promise.all`.
- Never add a round trip to a flow. Return the next step's data from the step that has it.
- `console` is banned in `src/`. Report failures through errors.

## Errors

- Each refusal from Tempo ID surfaces as `Accounts.RequestError`, with its `reason`.
- Mirror each `reason` of Tempo ID's OpenAPI document in `RequestError.Reason`.
- List each action's `reason` values in its API page.
- Write messages as the fault, then the fix. No product or library names.

## Code Documentation

- Start every module with a `@module` TSDoc comment, before imports, including tests and scripts.
- Add TSDoc to every export and every property of an exported type.
- A function's `Options`, `ReturnType`, `ErrorType`, `Parameters`, and `Props` share its TSDoc. Each property has its own. Overloads share the first signature's TSDoc.
- A property comment states meaning, units, default, or absence. Never repeat the name or type.
- Document purpose, inputs, output, defaults, errors, and side effects.
- Each export's TSDoc holds one `ts` example that imports from the package entry, such as `accounts/plugins`.

## Prose Conventions

Applies to docs, comments, TSDoc, interface copy, commits, and pull requests.

- Write about the code, not the reader. No second person outside interface copy.
- Write formally and technically. Use precise verbs ("returns", "rejects", "issues"), not conversational ones ("gets", "gives", "tells").
- State invariants and reasons the code cannot show.
- Follow ASD-STE100 writing rules, not its dictionary.
- Use short words: "use", "start", "before", not "utilize", "commence", "prior to".
- Use one word per concept. No synonyms for variety.
- Write "access key", never "key" alone. Identifiers keep their names.
- Keep instructions to 20 words, descriptions to 25.
- Keep paragraphs to one topic and six sentences.
- Put conditions first: "If the code expires, request a new one."
- Use active voice and simple tenses. No progressive or perfect main verbs.
- Stack at most three nouns.
- Keep articles ("the", "a").
- Use diagrams for flows: Mermaid `sequenceDiagram`, `flowchart`, or `stateDiagram-v2`. Keep each to about 12 nodes or 15 arrows.
- Use tables for comparisons and mappings.
- Write "Viem" in prose, `viem` in code.
- No semicolons or em dashes in prose.

## Documentation

`docs/` documents the package for app developers. Tempo ID's own docs, in `tempoxyz/id`, describe the service over HTTP. Link to them by absolute URL.

**Structure**

- `docs/README.md`: overview, install, entries, quick start, and links to every guide and API page.
- `docs/guides/`: one guide per flow or task, with **Overview**, **Recipes**, and **Learn more**. The Overview opens with one complete numbered example from `Accounts.create`. Import plugins from `accounts/plugins`.
- `docs/api/`: one page per function, plugin, or hook, such as `Accounts.create.md`, `plugins.email.md`, `Actions.email.signIn.md`.
  - Sections: **Overview**, **Usage**, **Return type**, **Parameters**, **Errors**.
  - Each item is a subsection with a **Type** bullet and an optional **Default** bullet. No tables.
  - Parameters use bare names, mark `(optional)`, and end with a `ts` example. Omit `config`.
  - `Actions.md` maps actions to members. `errors.md` covers error classes. `types.md` covers types and their `from`.

**Writing**

- Third person, imperative for instructions.
- Sentence-case noun-phrase headings. No questions or gerunds.
- Define terms once. Use "app", "API", "Tempo Account", "access token", "access key", "OAuth app".
- No future work outside Limitations.
- Use GitHub alerts only for security caveats and environment pitfalls.
- Link at the point of use, with deep anchors.
- Check facts against the code. Update guides and API pages in the same change as the behavior.

## Testing Conventions

- Test behavior: API contracts, flows, security boundaries, errors.
- `src/` holds machine tests and other tests that need no server.
- Integration tests run the package against a real Tempo ID. They live in `tempoxyz/id` until a Tempo ID test image exists.
- No mocks, stubs, fakes, fake timers, stubbed globals, or MSW in `src/`.
- Keep a module's tests in one `Module.test.ts` beside it. Never split into variant files.
- Group tests in a `describe` named for the entrypoint.
- Use inline snapshots, one value each. Use property matchers only for nondeterministic fields. Never derive expectations from the implementation.
- Add a regression test for every bug fix.
- Use bounded waits (`expect.poll`). No sleeps or retries.

## Workflow Conventions

- Run focused tests while iterating.
- Run `pnpm check:types` after TypeScript changes.
- Run `pnpm check`, and keep only task-related fixes.
- Run `git diff --check` and review the diff before finishing.
- Add a changeset for every change to the published package.

## Git Conventions

- Conventional commits, lowercase, no trailing period: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Name what changed, with codebase identifiers. State the change, not the reason.
- Each message stands alone.
- Keep the PR title accurate, since it becomes the squash commit.
- Keep PR bodies short: the problem, the behavior, one example, one validation line.
- Never force push or amend a pushed commit.

**State machine**

- If a PR adds or alters a machine in a `machines` namespace, add a **State machine** section before **API changes**, one subsection per machine.
- Show a `stateDiagram-v2` with event names on arrows and guards in brackets (`set [renewing]`).
- For a changed machine, add a table of changed states, events, and transitions, and of new or changed context properties.

**API changes**

- If a PR changes the public API, add an **API changes** section before **How to test**. The public API is the exports of `accounts` and its entries.
- Show each change in its own `ts` fence, as used, not as a `diff`. Follow with one sentence.
- Mark breaking changes with **Breaking**, with the old shape and migration.
- End with one `ts` fence that uses the change from `Accounts.create`.

## Repository Layout

- `src/` is the published package `accounts`. Its entries are in `package.json` `exports`: `.`, `./cloudflare`, `./expo`, `./internal`, `./mpp`, `./plugins`, `./react`, and `./wagmi`.
- `src/actions/` holds the actions that `Actions` exports. `src/plugins/` holds the plugins.
- `docs/` documents the package.
- `examples/` holds one small app per platform (`backend`, `cli`, `mobile`, `wagmi`, `web`). Each names a published range, so a copy installs as it is. CI type-checks them.
- `playgrounds/` holds one app per flow (`api`, `backend`, `cli`, `mobile`, `third-party`, `wagmi`, `web`). They use client IDs that `tempoxyz/id` registers in its seed. Its end-to-end suite drives them.
- Keep the playgrounds' names, client IDs, environment variables, ports, and page labels stable. `tempoxyz/id`'s end-to-end suite depends on them.
- `scripts/` holds the release script.

## Tooling

- Pin every dependency in the `pnpm-workspace.yaml` catalog, and reference it as `catalog:`.
- Optional platform libraries (React, wagmi, Expo, mppx) are optional peers.
- zile builds the package. Changesets versions and publishes it. `postinstall` runs `zile dev`.
- Changesets is in prerelease mode (`.changeset/pre.json`), so each release publishes under the `alpha` dist-tag.
- Prettier is banned. Vite+ runs oxfmt, oxlint, and Vitest from `vite.config.ts`.

## Commands

| Command            | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `pnpm build`       | Builds the package. Run `pnpm exec zile dev` after.           |
| `pnpm check`       | Formats and lints with fixes.                                 |
| `pnpm check:types` | Runs `tsc` on the package, the examples, and the playgrounds. |
| `pnpm test`        | Runs the tests in `src/` and `scripts/`.                      |

## Friction Logging

- Log papercuts and friction (tooling, docs, APIs, tests, conventions) as they occur with `pnpx frog log`.
- Do not add global, system, or internal friction.
- Run `pnpx frog list` first to see what is already known.
