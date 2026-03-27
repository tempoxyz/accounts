# ENG-169: CLI Access-Key Bootstrap + Generic Device-Code Core

## Summary

Ship this in `tempodk` as two pieces:

1. A new `tempodk/cli` entrypoint that uses `wallet_connect` to run the browser/device-code flow, opens the browser, polls for authorization, and returns the normal `wallet_connect` result.
2. A generic device-code server core in `tempodk/server` that owns the protocol, storage contract, request/response schemas, and reusable `create/poll/authorize` handlers.

Do **not** rehome the current wallet app UI/funding/auth flow into `tempodk`. `tempo/app` should keep the approval/auth/funding UI and later adopt the extracted tempodk server primitives.

V1 is **bootstrap-only**. The CLI adapter handles `wallet_connect` for authn/authz of an external access key. It does **not** become a full local-signing provider in this cut.

## Public API / Interface Changes

### `tempodk/cli`

Add a new `./cli` export with:

- `Provider.create(options?)`
  - Wraps core `Provider.create(...)` with a CLI-specific adapter by default.
  - Defaults:
    - browser open + poll flow enabled
    - no browser-only injection behavior
  - options:
    - `serviceUrl: string`
    - `open?: (url: string) => Promise<void> | void`
    - `pollIntervalMs?: number`
    - `timeoutMs?: number`
    - `storage?: Storage.Storage`
- `cli(options)` adapter export for advanced composition.

### CLI adapter behavior

- Supports `wallet_connect` in v1.
- Requires `capabilities.authorizeAccessKey.publicKey`.
- Accepts request-driven `expiry` and optional `limits`.
- Serializes to the device-code service, opens `${serviceUrl}?code=${code}`, polls until authorized, then returns:
  - root account address
  - `capabilities.keyAuthorization`
- Leaves transaction signing to the caller's own viem/tempodk account built from the same local key.
- `wallet_authorizeAccessKey`, `eth_sendTransaction`, and other signing methods remain unsupported on this adapter in v1.

### `tempodk/server`

Add a generic CLI auth/device-code module, exposed under `Handler` plus typed helpers:

- `Handler.cliAuth(options)`
  - mounts:
    - `POST /cli-auth/device-code`
    - `POST /cli-auth/poll/:code`
    - `POST /cli-auth/authorize`
  - configurable `path`
- `CliAuth.Store`
  - required methods:
    - `create`
    - `get`
    - `authorize`
    - `consume`
    - `delete`
  - built-in helpers:
    - `Store.memory()`
    - `Store.kv(kv)`
- `CliAuth.Policy`
  - host-supplied validation/sanitization for requested `expiry` and `limits`
  - server rejects requests outside policy
- Shared request/response schemas and TS types for:
  - device-code create
  - poll
  - authorize
  - stored device-code entry

### Wire compatibility

Preserve the current REST wire shape so existing consumers are not forced to change:

- request fields stay snake_case:
  - `pub_key`
  - `key_type`
  - `code_challenge`
  - add `expiry`
  - add `limits`
  - optional `account`
- poll response stays:
  - `status`
  - `account_address`
  - `key_authorization`

The browser URL remains `?code=...` only. The approval UI resolves `pubKey`, `keyType`, and requested policy from the server-side pending entry.

## Implementation Changes

### Server core extraction

- Move the generic protocol into tempodk:
  - code generation
  - PKCE verification
  - TTL handling
  - pending/authorized/consumed state machine
  - JSON handlers
- Make policy request-driven:
  - `expiry` and `limits` are stored with the device-code request
  - `authorize` must validate that the submitted signed key authorization matches the stored `pubKey`, `keyType`, `expiry`, and `limits`
- Keep app-specific concerns out of tempodk:
  - login UI
  - funding step
  - analytics
  - access-key labeling
  - product copy

### CLI adapter

- Implement a Node-friendly adapter that:
  - creates the device code
  - opens the browser via injectable `open`
  - prints/exposes the verification code for fallback UX
  - polls until success, timeout, or terminal error
- Reuse the existing `wallet_connect` abstraction instead of inventing a second auth API.
- Return the same `wallet_connect` result shape already used elsewhere in tempodk.

### Schema/types

- Extend the CLI auth protocol types to include request-driven `expiry` and `limits`.
- Do **not** add call `scopes` in v1.
- Keep `wallet_connect` access-key types aligned with the existing `keyAuthorization` result shape.

## Test Plan

- Unit tests for device-code store/handlers:
  - create success
  - invalid input
  - PKCE mismatch
  - pending poll
  - authorize success
  - authorize rejects mismatched key authorization
  - consume is one-time
  - TTL expiry
  - policy rejection for invalid `expiry`/`limits`
- Adapter tests:
  - `wallet_connect` success end-to-end against a mocked device-code service
  - browser-open failure still surfaces the URL/code
  - timeout behavior
  - unsupported-method behavior for non-bootstrap RPCs
- Type tests:
  - `tempodk/cli` request/return typing
  - new server protocol types
  - no `scopes` in v1
- Compatibility check:
  - existing snake_case wire format remains accepted
  - returned `keyAuthorization` still round-trips into viem/tempo helpers

## Assumptions / Defaults

- V1 is **bootstrap-only**, not a full signing CLI provider.
- V1 explicitly excludes access-key call `scopes`; that stays blocked on T3/upstream support.
- `tempodk` ships first; `tempo/app` adoption is a follow-up migration using the extracted server core.
- The right rehome boundary is the generic protocol/server primitive layer, not the wallet product UI.
