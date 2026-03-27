# ENG-169: Shipped in `tempodk`

## What shipped

### `tempodk/cli`

- Added a `tempodk/cli` entrypoint for CLI bootstrap via `wallet_connect`.
- `Provider.create({ serviceUrl, open, pollIntervalMs, timeoutMs })` now works for terminal-driven browser auth.
- The CLI adapter opens the browser, polls the device-code endpoint, and returns the root account plus `capabilities.keyAuthorization`.
- The adapter remains bootstrap-only in v1.

### `tempodk/server`

- Added generic device-code server primitives under `tempodk/server`.
- `Handler.cliAuth(...)` now exposes:
  - `POST /cli-auth/device-code`
  - `POST /cli-auth/poll/:code`
  - `POST /cli-auth/authorize`
- Added shared protocol schemas, entry types, store contracts, and policy hooks in `CliAuth`.
- Added built-in `Store.memory()` and `Store.kv(...)`.

### Protocol behavior

- The wire contract stays snake_case.
- Device codes remain raw 8-character protocol values.
- Hyphenated device codes are accepted on read paths for transition compatibility.
- Requested `expiry` and optional `limits` are stored with the pending device-code request and validated on authorization.

### Compatibility and verification

- Existing `/cli-auth` compatibility was preserved.
- Build and test coverage were added for:
  - device-code creation, polling, authorization, and expiry
  - one-time consume behavior
  - CLI adapter bootstrap behavior
  - unsupported method behavior
  - type coverage for the new CLI/server contracts

## Explicit non-goals of this shipped slice

- No full signing provider for CLI usage.
- No transaction or message signing through the CLI adapter.
- No scoped access keys yet.
- No real wallet app adoption in this repo slice.

## Dev-only manual test harness

- Added a local smoke-test flow in `playground`.
- `playground/worker/cli-auth.ts` hosts the dev-only CLI auth endpoints and approval helpers.
- `playground/src/CliAuth.tsx` renders the approval UI inside the normal playground app.
- `playground/scripts/cli-auth.ts` acts as the terminal-side smoke-test client.
- `playground/src/App.tsx` includes browser-side demo buttons for the three CLI request shapes:
  - pubkey only
  - pubkey + expiry
  - pubkey + expiry + limits
- Those browser-side demo buttons are not the authoritative CLI flow. They seed pending requests directly for UI/demo purposes; `playground/scripts/cli-auth.ts` remains the real terminal bootstrap demo.

## Remaining work

See [TODO.md](/Users/o/repos/tempo/tempodk/TODO/features/cli/TODO.md) for follow-up alignment work:

1. real `tempo/app` adoption of `Handler.cliAuth`
2. language-agnostic protocol documentation
3. scoped access keys as a later gated extension
