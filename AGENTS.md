# Agent Guidelines

## Project Principles

- `accounts` is the SDK of Tempo ID (`id.tempo.xyz`). Apps use it to sign users in, keep their session and access key, and act on Tempo with it.
- `tempoxyz/id` holds the server, its HTTP API, and its docs. This repository holds the package, its docs, and `examples/`. The playgrounds live in `tempoxyz/id`.
- The package runs in browsers, React Native, Node, and Workers. Entries stay free of platform imports, except `accounts/cloudflare`, `accounts/expo`, and `index.native.ts`.
- Tempo ID issues every token, except the placeholder tokens of `accounts/test`, which only test builds import. The package holds tokens and access keys only in the instance's `store`.
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
- Write everything in TypeScript. `.js` files are banned, except the `metro.config.js` of an Expo app, since Metro fails to load the TypeScript form of Expo 58. Run scripts with `node script.ts`.
- Import internal modules as namespaces (`import * as Session from './Session.js'`). Named imports are fine for types, leaf helpers, and third-party APIs.
- Import Node built-ins as namespaces, unless a named import is clearer.
- Use static imports. Use dynamic imports only at a real runtime or bundle boundary, such as `Accounts.handler`'s server.
- Load Node built-ins in shared code with `process.getBuiltinModule`, as `Store.file` does. Webpack fails on each `node:` import, also a dynamic one.
- Use `import type` and `export type` for type-only imports and exports.
- Use functions and plain data. Classes are only for errors and framework entrypoints such as Durable Objects.
- Put error classes at the top of the module, after imports, in alphabetical order. Name them in namespaced form, such as `Accounts.RequestError`.
- Use unions or `as const` objects, not enums.
- Use `camelCase` constants, unless the name mirrors an external protocol.
- Use `const` generics when callers keep literal or tuple types.
- Default option bags in the signature: `options: fn.Options = {}`.
- Name option bags `options`.
- Take at most two positional parameters: an optional receiver (`accounts`, `client`, `store`) or the inspected value (`error`, `session`), then one options object.

  ```ts
  Actions.authorize(accounts, { permissions }) // not authorize(accounts, permissions)
  Store.postgres(client, { table }) // not postgres(client, table)
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
- Name every module file in PascalCase, after its namespace, in `src/internal/` too: `Session.ts`, `Popup.ts`. Folders stay lowercase, such as `actions/` and `internal/viem/`.
- The root entry exports only `AccessToken`, `Accounts`, `Challenge`, `LogoutToken`, `Permissions`, `Plugin`, `Session`, and `Store`, which sit at the top of `src/`. Every other module goes in `src/internal/`, and `accounts/internal` exports those that apps can use.
- The root entry's `Accounts` is `src/internal/DefaultAccounts.ts`: `src/Accounts.ts` with a `create` that adds the `dialog`, `funding`, and `mpp` plugins. `accounts/lite` exports `src/Accounts.ts` itself. `src/Accounts.ts` never imports a default plugin, so the bundle of `accounts/lite` holds none.
- Prefer stateless functions. Create an instance only for dependencies or lifecycle state, through `Module.create(options)` returning a plain object.
- `Accounts.create` is the authoritative instance. Plugins and actions derive from it. No module-scope singletons, except a lock on a resource of the whole device that no instance owns, such as the `expo` preset's lock on the device's secure store.
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

Use XState v5 for lifecycles and `@xstate/store` for event-driven stores. Zustand, Redux, and `let`-flag stores are banned. `machines.session` in `src/internal/Session.ts` is the reference.

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
- The session's write queue lives in `src/internal/Session.ts`. Its non-extractable `CryptoKey` needs IndexedDB. A failed save rejects its change.

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
- Expose actors read-only. For common reads, expose a stable `{ get, subscribe }` pair, such as `accounts.session.status`.
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
- Check the waterfall of each changed action. See `docs/development/waterfall.md`.
- A change adds no duplicate call, no round, and no sequential call without a dependency. State the reason for each exception in the PR body.
- Fix a waterfall finding in code that a change touches.
- `console` is banned in `src/`. Report failures through errors.

## Errors

- Each refusal from Tempo ID surfaces as `Accounts.RequestError`, with its `reason`.
- Mirror each `reason` of Tempo ID's OpenAPI document in `RequestError.Reason`.
- List each action's `reason` values in its TSDoc, on `@throws {Accounts.RequestError}`.
- Write messages as the fault, then the fix. No product or library names.

## Code Documentation

- Start every module with a `@module` TSDoc comment, before imports, including tests and scripts.
- Add TSDoc to every export and every property of an exported type.
- A function's `Options`, `ReturnType`, `ErrorType`, `Parameters`, and `Props` share its TSDoc. Each property has its own. Overloads share the first signature's TSDoc.
- A property comment states meaning, units, default, or absence. Never repeat the name or type.
- Document purpose, inputs, output, defaults, errors, and side effects.
- TSDoc is the API reference. No Markdown page repeats it. State each fact once, on the declaration it describes.
- A plugin member's TSDoc, such as `email.signIn`, holds the facts an app needs. The action of `src/actions/` holds only its own.
- State a default as a sentence: "Defaults to `x`."
- Name each error with `@throws {ErrorClass}`, and its condition.
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

`site/` documents the package for app developers. Tempo ID's own docs, in `tempoxyz/id`, describe the service over HTTP. Link to them by absolute URL.

**Structure**

- `site/vocs.config.ts`: the sidebar. Each item names a page of `site/src/pages/`, and is disabled until the page exists.
- `site/src/pages/index.mdx`: "Getting started", the home page, and the model of a page.
- `site/src/pages/docs/introduction/`: other plain pages.
- `site/src/pages/docs/guides/`: one guide per page. A topic with more guides is a group of the sidebar, and each guide is an item of its group, at `guides/<topic>/<guide>.mdx`.
- In "Tasks after sign-in", a group of the sidebar starts with the "Overview" item of its topic, at `guides/<topic>.mdx`. The overview states what the topic is for and when to use it, then shows each guide as a `PageCard`. A topic with one page holds its overview in the page's Overview section.
- Each topic of "Sign-in flows" is one page. A variant of its flow is a use case of the page.
- A topic label is a noun phrase, such as "Access keys". A guide label starts with a verb, ends with a noun, and holds at most three words, such as "Revoke access keys".
- A guide page holds these parts in order:

  | Part        | Content                                                                         |
  | ----------- | ------------------------------------------------------------------------------- |
  | Overview    | What the guide builds, and an interactive end-to-end example                    |
  | Walkthrough | The steps from `Accounts.create`, with a link to the example that runs the flow |
  | Use cases   | Each option of the guide's API that an app uses, as one use case with a snippet |
  | Next steps  | Cards of the pages that follow                                                  |

- `site/src/demos/`: one module for each interactive example. `Demo` of `site/src/components/Demo.tsx` shows it on a page.
- A walkthrough is one steps block. If the steps differ by platform, one tab holds the steps of each platform.
- A walkthrough mirrors an app of `examples/`, if one runs the flow. Import plugins from `accounts/plugins`.
- A walkthrough holds only the steps that the flow needs. A task that is the same on each platform, such as a sign-out, is a use case below the walkthrough.
- Each web snippet is a React component. No snippet reads the DOM, such as with `document.querySelector`.
- Each server snippet runs on any JavaScript server: a Fetch handler, such as a Hono app, with secrets from `process.env` and state in a `Store`. No page names a hosting platform or its APIs, also where the example of the flow runs on one.
- A demo runs in the page against Tempo ID and Tempo testnet. If its flow needs a server, it calls a route of `site/src/server/`, under `/api/<topic>`.
- The Worker of the site holds no Durable Object. Cloudflare gives a Worker with one no preview URL.
- `site/README.md` describes the sidebar, the elements of a page, the guide pages, and the demos.
- The API reference is the TSDoc of each export, as **Code Documentation** describes. A page names an export in code, and `SourceLink` links it to its declaration at the commit of the build.

**Writing**

- Third person, imperative for instructions.
- Sentence-case headings. A section heading is a noun phrase, and a step heading is an imperative. No questions or gerunds.
- Define terms once. Use "app", "API", "Tempo Account", "access token", "access key", "OAuth app".
- At its first use, a guide links a term to the overview of its topic, or else to the guide that covers it, if one exists.
- Write for a reader who knows OAuth, crypto, and payments, but not Tempo ID. Explain a Tempo mechanism through the standard that it resembles.
- Name an API or a concept first in the step that uses it. Do not foreshadow it, so the reader holds less context.
- No future work outside Limitations.
- Use `:::warning` and `:::note` only for security caveats and environment pitfalls. Use `:::tip` only for an option of a step, in place of a step of its own.
- Link at the point of use, with deep anchors.
- Link each API or interface of the package that prose names in inline code to its declaration with `SourceLink`, at each use. A code block holds no link.
- Keep a paragraph to two or three sentences.
- Keep inline code in prose rare. Put details in the snippet, a table, or a later step.
- Keep a code block to about 60 lines. Split a longer file into a code group of complete files.
- If a walkthrough mixes server and client steps, end each step heading with `<StepTag kind="server" />` or `<StepTag kind="client" />`, with no space before it, so the anchor ends with the heading text.
- Under Use cases, give each option of the guide's API that an app uses one `###` use case: one or two sentences, a `SourceLink` to the option, and a short complete snippet. Derive the options from `src/`, and skip internal ones.
- Walkthroughs keep state in `Store.memory()`, so the reader installs no database. One `:::note` per page names a shared store for production, such as `Store.postgres` or `Store.redis`.
- Link a page of the site only once it exists. `PageCard` stays disabled until then.
- Show a list of pages or examples as cards (`PageCard`, `ExampleCard`), not as a table.
- Check facts against the code. Update guides and TSDoc in the same change as the behavior.
- Check each step against its example and the current `src/`. Run each demo in a browser.
- Each snippet is a complete file that runs as copied. `tempo.config.ts` exports the `accounts` instance. Each later snippet that uses it is a code group of its file, which imports `./tempo.config.js`, and `tempo.config.ts`.

## Testing Conventions

- Test behavior: API contracts, flows, security boundaries, errors.
- `src/` holds machine tests and other tests that need no server.
- Integration tests run the package against a real Tempo ID. They live in `tempoxyz/id`.
- Develop a change in the `accounts` submodule of `tempoxyz/id`, whose integration and end-to-end suites run against it. CI here runs the tests in `src/` and the end-to-end suite.
- No mocks, stubs, fakes, fake timers, stubbed globals, or MSW in `src/`.
- Keep a module's tests in one `Module.test.ts` beside it. Never split into variant files.
- Group tests in a `describe` named for the entrypoint.
- Use inline snapshots, one value each. Use property matchers only for nondeterministic fields. Never derive expectations from the implementation.
- Add a regression test for every bug fix.
- Use bounded waits (`expect.poll`). No sleeps or retries.

**End-to-end**

- The end-to-end suite runs the test apps of `test/apps/` in Chromium against a local Tempo ID and Tempo node. See `docs/development/e2e.md`.
- The suite targets only local services. `TEMPO_RPC_URL` and `TEMPO_ID_URL` name running ones, and the `*_IMAGE` variables name other images.
- If a change alters what a browser shows of a flow, add or extend the flow's spec in `test/e2e/`.
- Write each phase as a `test.step` that ends with `capture(name)`, so the proof shows it.
- Select Tempo ID's own elements only through `test/Playwright.ts`.
- Each pull request's `Test (e2e)` run holds its proof: the video, steps, and screenshots of every test. Never skip the job, or a spec, to merge.

## Workflow Conventions

- Run focused tests while iterating.
- Run `pnpm check:types` after TypeScript changes.
- If a change touches an action, a request, a storage call, or an RPC call, run `pnpm waterfall` on the affected tests. Compare with the base commit's summary through `pnpm waterfall:report --base`.
- If a change alters a flow that a spec of `test/e2e/` covers, run `pnpm test:e2e`.
- Run `pnpm check`, and keep only task-related fixes.
- Run `git diff --check` and review the diff before finishing.

## Git Conventions

- Conventional commits, lowercase, no trailing period: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `ci:`, `chore:`. Mark a breaking change with `!`, such as `feat(dialog)!:`.
- Name what changed, with codebase identifiers. State the change, not the reason.
- Each message stands alone.
- Keep the PR title accurate, since it becomes the squash commit.
- Keep PR bodies short. Open with the release note: what changed for an app, in the past tense, such as "Added `loginHint` to `dialog.signIn`." Name exports in backticks. For a breaking change, add the migration and at most one short `ts` block.
- Put the problem, the example, and the validation under `##` headings, such as `## API changes` and `## How to test`, also for the sections below. The release notes take the body only up to its first heading.
- Never force push or amend a pushed commit.

**State machine**

- If a PR adds or alters a machine in a `machines` namespace, add a **State machine** section before **API changes**, one subsection per machine.
- Show a `stateDiagram-v2` with event names on arrows and guards in brackets (`set [renewing]`).
- For a changed machine, add a table of changed states, events, and transitions, and of new or changed context properties.

**Waterfall**

- If a PR changes an action's I/O, add a **Waterfall** section before **API changes**.
- Add a table of each changed action's calls, rounds, and ideal rounds, before and after.
- List each new finding that the PR keeps, with its reason.

**API changes**

- If a PR changes the public API, add an **API changes** section before **How to test**. The public API is the exports of `accounts` and its entries.
- Show each change in its own `ts` fence, as used, not as a `diff`. Follow with one sentence.
- Mark breaking changes with **Breaking**, with the old shape and migration.
- End with one `ts` fence that uses the change from `Accounts.create`.

## Repository Layout

- `src/` is the published package `accounts`. Its entries are in `package.json` `exports`: `.`, `./cloudflare`, `./expo`, `./internal`, `./lite`, `./mpp`, `./plugins`, `./react`, `./test`, and `./wagmi`.
- `src/actions/` holds the actions that `Actions` exports. `src/plugins/` holds the plugins.
- `src/stores/` holds each store that `Store` exports, such as `Store.memory`. `Store.ts` holds only the `Store` type and `Store.from`.
- `src/internal/handlers/` holds each route handler, such as `Relay.ts`, the relay route. `src/internal/Handler.ts` holds the `Handler` type that each returns.
- `docs/development/` holds the development notes of the repository.
- `site/` is the documentation site of `accounts.tempo.xyz`, a Vocs project. Its pages are in `site/src/pages/`, its demos in `site/src/demos/`, the routes of its demos in `site/src/server/`, its components in `site/src/components/`, and the icons of its sidebar in `site/icons/`. `.github/workflows/site.yml` deploys it to `accounts.tempo.xyz` through the Cloudflare Deploy Broker, and builds each pull request, which `.github/workflows/site-preview.yml` uploads to a preview URL.
- `examples/` holds one small app per platform (`backend`, `cli`, `mobile`, `wagmi`, `web`). Each names a published range, so a copy installs as it is. CI type-checks them.
- `test/` holds the end-to-end suite: the specs in `test/e2e/`, the test apps in `test/apps/`, and one module per local service. `test/waterfall/` holds the waterfall.

## Tooling

- Pin every dependency in the `pnpm-workspace.yaml` catalog, and reference it as `catalog:`.
- Optional platform libraries (React, wagmi, Expo) are optional peers. `mppx` is a peer, since every instance holds the `mpp` plugin.
- zile builds the package. `postinstall` runs `zile dev`.
- Each push to `main` publishes `<breaking>.<minor>.<commit time>` under `latest`, such as `1.2.20261118194700`, so `accounts` installs the current commit of `main`, without waiting on CI, with a GitHub release that lists the description of each `feat`, `fix`, `perf`, and breaking pull request since the last one. `.github/workflows/release.yml` describes the release, and `scripts/release.ts` picks the version.
- The pull request title's type decides whether the release notes list the pull request, and under which section. Its description is the entry. A breaking title (`feat!:`, or `BREAKING CHANGE:` in the commit body) raises `<breaking>`, and a `feat:` title raises `<minor>`. Describe a breaking change in the pull request body with each change in a `diff` fence: the old usage as removed lines, and the new usage as added lines.
- `ci:` and `test:` commits release nothing alone. Running Main by hand releases main's tip anyway.
- Add no changeset. `.changeset/` keeps the notes written for `1.0.0` before this scheme, and no workflow reads it.
- Prettier is banned. Vite+ runs oxfmt, oxlint, and Vitest from `vite.config.ts`.

## Commands

| Command            | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `pnpm build`       | Builds the package. Run `pnpm exec zile dev` after.                           |
| `pnpm check`       | Formats and lints with fixes.                                                 |
| `pnpm check:types` | Runs `tsc` on the package and the examples.                                   |
| `pnpm size`        | Measures each entry's browser bundle with Rolldown.                           |
| `pnpm test`        | Runs the tests in `src/`.                                                     |
| `pnpm test:e2e`    | Runs the end-to-end suite in Chromium, and writes its proof.                  |
| `pnpm waterfall`   | Records each action's async calls. `pnpm waterfall:report` writes the report. |

## Friction Logging

- Log papercuts and friction (tooling, docs, APIs, tests, conventions) as they occur with `pnpx frog log`.
- Do not add global, system, or internal friction.
- Run `pnpx frog list` first to see what is already known.
