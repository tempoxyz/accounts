# Plan: Account Provider — Phased Implementation

> Implements [PRD: Account Provider — Foundations](./prd-account-provider.md).
> **Pre-requisite already done:** Store (`Store.ts`, `Storage.ts`) is integrated and tested.

## Design decisions (from review)

- **`wallet_connect` without `register` capability** → behaves identically to `eth_requestAccounts` (calls `requestAccounts`).
- **`chains` array** — `Provider.create({ chains: [tempo, tempoModerato] })`. First chain is the default. `wallet_switchEthereumChain` validates against this array.
- **`activeAccount` index** — the Store gets an `activeAccount: number` field (index into `accounts[]`). `eth_accounts` returns accounts with the active one first. `sendTransaction` etc. use `accounts[activeAccount]`.
- **No mocks** — all tests run against a real local Tempo node via prool.
- **`webauthx`** — available at `wevm/webauthx` on npm. Used for client-side ceremony orchestration and server-side verification.
- **Review after each phase** before starting the next.
- **Watch for store update duplication** — `store.setState({ accounts, activeAccount, status })` patterns in adapters will likely duplicate across `local()`, `webAuthn()`, etc. Abstract when it screams (e.g. move to shared helpers or push into the Provider/Store layer).

---

## Phase 1 — Minimal Provider + `local()` adapter (barely viable product)

**Goal:** A working EIP-1193 provider that can connect with a secp256k1 key model and proxy read RPCs to the chain. Testable end-to-end against a real local Tempo node — no browser, no WebAuthn, no transactions yet.

### 1.1 Store update — `activeAccount` field

- [ ] Add `activeAccount: number` to `State` type (default `0`)
- [ ] Persist `activeAccount` alongside `accounts` and `chainId`
- [ ] Update `Store.test.ts` with `activeAccount` coverage

### 1.2 Adapter type definition

- [ ] Define `Adapter` type in `src/account/Adapter.ts`
  - `setup?: (params: { store: Store }) => (() => void) | undefined`
  - `actions` object with all action methods (typed params/return)
  - Each action initially typed but can throw "not implemented" in Phase 1 stubs
- [ ] Export from `src/account/`

### 1.3 `local()` adapter — connection only

- [ ] Create `src/account/Local.ts` — `local(options)` factory
  - Accepts `{ createAccount?, requestAccounts }` key model (Phase 1 — `sign` added in Phase 2)
  - Returns an `Adapter` object
  - Implement `requestAccounts` action → calls `options.requestAccounts()`, updates store accounts/status/activeAccount
  - Implement `createAccount` action → calls `options.createAccount()` (if provided), updates store
  - Implement `disconnect` action → clears store accounts, resets activeAccount, sets status `disconnected`
  - Implement `switchChain` action → validates chainId against configured `chains`, updates store `chainId`, swaps internal viem client
  - Stub remaining actions (`sendTransaction`, `signPersonalMessage`, etc.) → throw `4200 unsupported`

### 1.4 Provider shell

- [ ] Create `src/account/Provider.ts` — `Provider.create(options)` factory
  - Accepts `{ adapter, chains, storage?, storageKey?, announceProvider? }`
  - Uses `ox` `Provider.from()` to create an EIP-1193 provider
  - Creates the Zustand store internally (using existing `Store.create()`, chainId from `chains[0]`)
  - Creates a viem `Client` for the active chain
  - `request()` dispatches:
    - `eth_accounts` → read from store (active account first)
    - `eth_chainId` → read from store
    - `wallet_connect` → if `capabilities.method === 'register'` call `createAccount`, else call `requestAccounts`
    - `eth_requestAccounts` → `adapter.actions.requestAccounts()`
    - `wallet_disconnect` → `adapter.actions.disconnect()`
    - `wallet_switchEthereumChain` → `adapter.actions.switchChain()`
    - All other `eth_*` → proxy to viem client via `client.request()`
  - Subscribes to store changes → emits EIP-1193 events:
    - `accounts` change → `accountsChanged`
    - `chainId` change → `chainChanged`
    - `status` change → `connect` / `disconnect`
  - Calls `adapter.setup?.({ store })` on creation
  - Waits for store hydration before returning

### 1.5 Package export

- [ ] Add `"./account"` export to `package.json` pointing to `src/account/index.ts`
- [ ] Create `src/account/index.ts` — re-exports `Provider`, `local`, `Storage`, `Store`

### 1.6 Update vitest config

- [ ] Add `globalSetup` to the `account` vitest project (needs local Tempo node)
- [ ] Add `account-browser` vitest browser project for `*.browser.test.ts` files in `src/account/`

### 1.7 Tests — integration (against real local node)

- [ ] Create `src/account/Provider.test.ts`
  - Test: `Provider.create()` returns an EIP-1193 provider
  - Test: `eth_chainId` returns configured chain ID (hex)
  - Test: `eth_accounts` returns `[]` initially
  - Test: `eth_requestAccounts` calls adapter, returns accounts, emits `accountsChanged` + `connect`
  - Test: `wallet_connect` without capabilities → calls `requestAccounts`
  - Test: `wallet_connect` with `{ capabilities: { method: 'register' } }` → calls `createAccount`
  - Test: `wallet_disconnect` clears accounts, emits `accountsChanged` + `disconnect`
  - Test: `wallet_switchEthereumChain` updates chain, emits `chainChanged`
  - Test: `wallet_switchEthereumChain` with unknown chain → `4902` error
  - Test: `eth_blockNumber` proxied to real node returns a number
  - Test: `4200` error for stubbed wallet methods
  - Use `local()` with a real secp256k1 key model (`Account.fromSecp256k1`)

### 1.8 Tests — browser (vitest browser mode)

- [ ] Create `src/account/Provider.browser.test.ts`
  - Same test cases as 1.7, running in a real browser environment
  - Proves the provider works in both Node and browser contexts

### Phase 1 deliverable

A provider you can `create()`, connect to, read `eth_accounts`/`eth_chainId`, switch chains, disconnect, and proxy read RPCs. Fully testable via both integration tests (Node) and browser tests against a real local node.

---

## Phase 2 — Transaction sending + signing

**Goal:** `eth_sendTransaction` and `wallet_sendCalls` work end-to-end. Sign, broadcast, and verify on-chain. Testable against a local Tempo node.

### 2.1 `fillTransaction` action

- [ ] Implement `fillTransaction` in `local()` adapter
  - Uses viem client to fill gas, nonce, chain-specific fields
  - Returns a prepared unsigned Tempo transaction
- [ ] Wire `wallet_fillTransaction` in Provider

### 2.2 `sendTransaction` action

- [ ] Implement `sendTransaction` in `local()` adapter
  - Looks up active account from store
  - Prepares Tempo transaction (`type: 'tempo'`) with `calls[]`
  - Calls `options.sign({ address, digest })` to get signature
  - Uses viem/tempo to serialize + broadcast via `eth_sendRawTransaction`
  - Returns tx hash
- [ ] Wire `eth_sendTransaction` in Provider (decode params → adapter → encode response)

### 2.3 `wallet_sendCalls` action

- [ ] Implement `sendCalls` — batches multiple calls into a single Tempo transaction
- [ ] Wire `wallet_sendCalls` in Provider

### 2.4 `sendRawTransaction` action

- [ ] Implement `sendRawTransaction` in `local()` adapter — proxies pre-signed tx to node
- [ ] Wire `eth_sendRawTransaction` in Provider

### 2.5 Tests — integration (against real local node)

- [ ] Test: `eth_sendTransaction` → sends a Tempo tx, returns hash, receipt confirms on-chain
- [ ] Test: `wallet_sendCalls` → batches calls, single tx hash, verify on-chain state
- [ ] Test: `wallet_fillTransaction` → returns prepared tx with gas/nonce filled
- [ ] Test: `eth_sendRawTransaction` → submits pre-signed tx
- [ ] All tests use `local()` with real secp256k1 key model (`Account.fromSecp256k1`)

### 2.6 Tests — browser

- [ ] Add transaction tests to `Provider.browser.test.ts`
  - Same tx test cases as 2.5, running in a real browser environment

### Phase 2 deliverable

Full send-transaction flow working end-to-end. Create account → send transaction → verify on-chain. Both integration and browser tests prove it works.

---

## Phase 3 — Message signing + capabilities

**Goal:** `personal_sign`, `eth_signTypedData_v4`, `wallet_getCapabilities`, `wallet_getCallsStatus`, `eth_getBalance` interception.

### 3.1 `signPersonalMessage` action

- [ ] Implement in `local()` — hashes message, calls `sign()`, returns signature
- [ ] Wire `personal_sign` in Provider

### 3.2 `signTypedData` action

- [ ] Implement in `local()` — EIP-712 hash, calls `sign()`, returns signature
- [ ] Wire `eth_signTypedData_v4` in Provider

### 3.3 `getCapabilities` / `getCallsStatus`

- [ ] Implement `getCapabilities` → returns EIP-5792 capabilities
- [ ] Implement `getCallsStatus` → returns call bundle status
- [ ] Wire `wallet_getCapabilities` and `wallet_getCallsStatus` in Provider

### 3.4 `eth_getBalance` interception

- [ ] Intercept `eth_getBalance` — support optional `token` param for TIP-20 balance queries via `Actions.token.getBalance`
- [ ] Without token param → return `0n` (Tempo has no native token)

### 3.5 Error codes

- [ ] Ensure all error paths use standard EIP-1193 codes (`4001`, `4100`, `4200`, `4900`, `4901`)
- [ ] Test error scenarios: unauthorized, user rejected, unsupported method, disconnected

### 3.6 Tests — integration

- [ ] Test: `personal_sign` → returns valid signature, recoverable to signer address
- [ ] Test: `eth_signTypedData_v4` → returns valid EIP-712 signature
- [ ] Test: `wallet_getCapabilities` → returns expected shape
- [ ] Test: `eth_getBalance` with token → returns TIP-20 balance
- [ ] Test: error codes for each category

### 3.7 Tests — browser

- [ ] Add signing + capabilities tests to `Provider.browser.test.ts`
  - Same test cases as 3.6, running in a real browser environment

### Phase 3 deliverable

Full signing + capabilities. The provider is now a complete local wallet for non-WebAuthn key models. Both integration and browser tests prove it works.

---

## Phase 4 — `webAuthn()` adapter + `Ceremony.local()`

**Goal:** WebAuthn passkey-backed accounts working in the browser. Browser tests prove it.

### 4.1 `webAuthn()` adapter

- [ ] Create `src/account/WebAuthn.ts` — `webAuthn(options)` factory
  - Wraps `local()` with a WebAuthn-specific key model
  - `createAccount` → runs registration ceremony, derives address from publicKey
  - `requestAccounts` → runs authentication ceremony, derives address
  - `sign` → uses stored credential to sign digest via `Authentication.sign()`
  - Maintains `Map<Address, Credential>` in closure scope

### 4.2 `Ceremony` interface + `Ceremony.local()`

- [ ] Define `Ceremony` type in `src/account/Ceremony.ts`
- [ ] Implement `Ceremony.local()` — pure client-side, no server
  - Generates challenges client-side
  - Stores `credentialId → publicKey` in localStorage
  - No attestation verification

### 4.3 EIP-6963 announcement

- [ ] Implement `announceProvider` on Provider setup (browser-only)
  - `name`, `rdns`, icon configurable via `Provider.create()` options
  - Only runs in browser environment (`typeof window !== 'undefined'`)

### 4.4 Tests — browser (vitest browser mode)

- [ ] Add vitest browser project config for `*.browser.test.ts` files
- [ ] Test: `webAuthn()` + `Ceremony.local()` → create passkey account
- [ ] Test: `webAuthn()` → discover existing account via assertion
- [ ] Test: `webAuthn()` → sign and send transaction
- [ ] Test: EIP-6963 announcement emits `eip6963:announceProvider` event
- [ ] Use CDP WebAuthn virtual authenticator for headless passkey ceremonies

### Phase 4 deliverable

WebAuthn adapter working in a real browser. Passkey creation, login, and signing proven via browser tests. EIP-6963 announcement working.

---

## Phase 5 — `Ceremony.server()` + `Handler.webauthn`

**Goal:** Server-backed WebAuthn ceremonies. Full production-ready flow.

### 5.1 `Ceremony.server()`

- [ ] Implement in `src/account/Ceremony.ts`
  - Accepts `{ url }` — derives endpoints from convention
  - `GET ${url}/register/options` → `POST ${url}/register`
  - `GET ${url}/login/options` → `POST ${url}/login`

### 5.2 `Handler.webauthn`

- [ ] Implement in `src/server/Handler.ts` (alongside existing `keyManager`)
  - Uses `webauthx/server` for challenge generation + attestation verification
  - Four endpoints: `GET /register/options`, `POST /register`, `GET /login/options`, `POST /login`
  - KV-backed challenge + credential storage

### 5.3 Tests — integration

- [ ] Test: full server-backed ceremony flow (register → login → sign)
  - Spin up `Handler.webauthn` on a local server
  - `Ceremony.server({ url })` pointed at it
  - `webAuthn()` adapter with server ceremony
  - Exercise full account lifecycle
- [ ] Test: challenge expiry, attestation verification errors
- [ ] Test: multiple credentials per user

### Phase 5 deliverable

Production-ready WebAuthn flow with server-backed ceremonies. Full round-trip tested: client ↔ server ↔ chain.

---

## Phase 6 — Persistence, reconnection, polish

**Goal:** Session persistence across page reloads. Reconnection flow. Production hardening.

### 6.1 Reconnection flow

- [ ] On `Provider.create()`, if store hydrates with existing accounts:
  - Set status to `reconnecting`
  - Call `adapter.actions.requestAccounts()` to re-validate
  - If successful → `connected`, emit events
  - If failed → clear accounts, `disconnected`

### 6.2 viem `custom()` transport compatibility

- [ ] Verify the provider works with `viem`'s `custom(provider)` transport
- [ ] Add integration test: create `WalletClient` from provider, call actions

### 6.3 Wagmi compatibility

- [ ] Verify the provider works with Wagmi's `custom()` connector pattern
- [ ] Add test or example showing Wagmi integration

### 6.4 Final tests

- [ ] Test: persistence — create provider, connect, destroy, create new provider → hydrates accounts
- [ ] Test: reconnection flow — happy path + failed reconnection
- [ ] Test: viem WalletClient integration
- [ ] Test: concurrent providers with different storage keys

### Phase 6 deliverable

Production-ready provider with persistence, reconnection, and ecosystem compatibility.

---

## Files created/modified per phase

| Phase | New files                                                                                                                                                                   | Modified files                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1     | `src/account/Adapter.ts`, `src/account/Local.ts`, `src/account/Provider.ts`, `src/account/index.ts`, `src/account/Provider.test.ts`, `src/account/Provider.browser.test.ts` | `src/account/Store.ts`, `src/account/Store.test.ts`, `package.json` (exports), `vitest.config.ts`                         |
| 2     | —                                                                                                                                                                           | `src/account/Local.ts`, `src/account/Provider.ts`, `src/account/Provider.test.ts`, `src/account/Provider.browser.test.ts` |
| 3     | —                                                                                                                                                                           | `src/account/Local.ts`, `src/account/Provider.ts`, `src/account/Provider.test.ts`, `src/account/Provider.browser.test.ts` |
| 4     | `src/account/WebAuthn.ts`, `src/account/Ceremony.ts`                                                                                                                        | `src/account/Provider.browser.test.ts`, `src/account/index.ts`                                                            |
| 5     | —                                                                                                                                                                           | `src/account/Ceremony.ts`, `src/server/Handler.ts`, `src/server/Handler.test.ts`, `src/server/index.ts`                   |
| 6     | —                                                                                                                                                                           | `src/account/Provider.ts`, `src/account/Provider.test.ts`, `src/account/Provider.browser.test.ts`                         |
