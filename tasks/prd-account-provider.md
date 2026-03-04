# PRD: Account Provider — Foundations

## Problem Statement

External apps have no way to embed Tempo Account management into their products. The Account SDK spec (metronome) defines a universal EIP-1193 provider with adapter-based architecture, but no implementation exists yet in `tempo-ts`. Without it:

- Apps cannot create, discover, or manage Tempo Accounts programmatically.
- There is no standard EIP-1193 interface for Tempo — apps must manually construct transactions, manage WebAuthn ceremonies, and handle signing logic.
- There is no pluggable key model — apps that want to use their own signing infrastructure (HSMs, secp256k1, WebCrypto) have no integration path.
- There is no foundation for the Connect adapter (`auth.tempo.xyz`) or Wagmi connector to build on.

## Solution

Implement the foundational Account Provider in `tempo-ts/src/account/` — a universal EIP-1193 provider with a pluggable adapter interface. Ship two adapters:

1. **`local()`** — domain-bound adapter where the app manages keys and signing in-process. Accepts an arbitrary key model (`createAccount`, `requestAccounts`, `sign`) so apps can plug in any signing infrastructure.
2. **`webAuthn()`** — a preconfigured `local()` adapter that uses WebAuthn passkeys as the root key model out of the box.

The Provider leverages `viem/tempo` extensively — `Account`, `Transaction`, `Actions`, `WebAuthnP256`, chain definitions, and the `tempoActions` decorator — rather than reimplementing chain primitives.

## User Stories

1. As an app developer, I want to create an EIP-1193 provider with `Provider.create({ adapter: local({ ... }) })`, so that I can embed Tempo Account management in my app.
2. As an app developer, I want to pass a custom key model to `local()` with `createAccount`, `requestAccounts`, and `sign` methods, so that I can use my own signing infrastructure.
3. As an app developer, I want `createAccount` to be optional on my key model, so that I can build read-only or login-only flows.
4. As an app developer, I want to use `webAuthn({ rpId: 'myapp.com' })` for passkey-backed accounts with zero custom code, so that I get biometric auth out of the box.
5. As an app developer, I want the provider to emit `accountsChanged`, `chainChanged`, `connect`, and `disconnect` events, so that my UI reacts to state changes.
6. As an app developer, I want to call `provider.request({ method: 'wallet_connect', params: [{ capabilities: { method: 'register' } }] })` to create a new account.
7. As an app developer, I want to call `provider.request({ method: 'eth_requestAccounts' })` to discover existing accounts.
8. As an app developer, I want to call `provider.request({ method: 'eth_sendTransaction', params: [...] })` to sign and broadcast a transaction.
9. As an app developer, I want to call `provider.request({ method: 'wallet_sendCalls', params: [...] })` to batch multiple calls in a single Tempo transaction.
10. As an app developer, I want to call `provider.request({ method: 'personal_sign', params: [...] })` to sign a message with my Tempo Account.
11. As an app developer, I want to call `provider.request({ method: 'eth_signTypedData_v4', params: [...] })` to sign EIP-712 typed data.
12. As an app developer, I want to call `provider.request({ method: 'wallet_disconnect' })` to disconnect and clear local state.
13. As an app developer, I want to call `provider.request({ method: 'wallet_switchEthereumChain', params: [...] })` to switch between mainnet and testnet.
14. As an app developer, I want `eth_accounts` and `eth_chainId` to return current state without adapter delegation.
15. As an app developer, I want all other `eth_*` read methods (`eth_call`, `eth_getTransactionReceipt`, `eth_blockNumber`, `eth_getLogs`, etc.) proxied directly to the Tempo RPC node.
16. As an app developer, I want `wallet_fillTransaction` to return a prepared unsigned transaction (gas, nonce filled), so that I can integrate with custom signing flows.
17. As an app developer, I want the provider to persist account state across sessions via pluggable storage (localStorage, memory), so that users don't re-authenticate on every visit.
18. As an app developer, I want the provider to announce via EIP-6963 (`announceProvider`), so that wallet aggregators (Privy, Dynamic) auto-detect it.
19. As an app developer, I want to use the provider with viem's `custom()` transport to create a `WalletClient`, so that I get the full viem API surface for free.
20. As an app developer, I want `wallet_getCapabilities` to return supported capabilities (EIP-5792).
21. As an app developer, I want `wallet_getCallsStatus` to return call bundle status (EIP-5792).
22. As an app developer, I want `eth_sendRawTransaction` to submit a pre-signed transaction.
23. As an app developer, I want to use the provider with Wagmi's `custom()` connector pattern.
24. As an enterprise developer, I want to plug in a secp256k1 key model for server-side account management.
25. As a developer, I want clear error codes (EIP-1193 `4001`, `4100`, `4200`, `4900`, `4901`) when things go wrong.

## Implementation Decisions

### Module structure

All code lives under `src/account/`. A new `tempo/account` export entry point is added to `package.json`.

### `local()` options

The `local()` adapter accepts options that handle key creation, discovery, and signing. These are the direct parameters to `local()` — not a separate type. The key model implementation manages its own key state internally (as a closure); the Provider only deals in addresses.

```ts
local({
  /** Create a new account. Optional — omit for login-only flows. */
  createAccount?: () => Promise<{ address: Address }[]>
  /** Discover existing accounts (e.g., WebAuthn assertion). */
  requestAccounts: () => Promise<{ address: Address }[]>
  /** Sign a digest for the given address. */
  sign: (params: { address: Address; digest: Hex }) => Promise<Hex>
})
```

Both `createAccount` and `requestAccounts` return `{ address }[]` — matching the `wallet_connect` return format. The key model implementation is responsible for maintaining its own key-to-address mapping internally. For example, the `webAuthn()` adapter keeps a `Map<Address, Credential>` in closure scope so that when `sign({ address })` is called, it can look up the right credential.

The Provider stores the returned addresses in its store. When `sendTransaction` is called, the adapter passes the active account's address to `sign()`.

### `webAuthn()` adapter

`webAuthn()` is a preconfigured `local()` that orchestrates WebAuthn ceremonies via explicit server↔client round-trips, following the [`webauthx`](https://github.com/wevm/webauthx) pattern. The adapter handles the client-side browser API calls; the app's server handles challenge generation, attestation verification, and credential storage.

#### Ceremony interface

The `webAuthn()` adapter accepts a `ceremony` — a pluggable strategy that handles the registration and authentication round-trips. Two built-in implementations ship: `Ceremony.local()` for pure client-side flows and `Ceremony.server()` for server-backed flows.

```ts
type Ceremony = {
  getRegistrationOptions: () => Promise<{ options: CredentialCreationOptions<true> }>
  verifyRegistration: (credential: Credential<true>) => Promise<{ publicKey: Hex }>
  getAuthenticationOptions: () => Promise<{ options: CredentialRequestOptions<true> }>
  verifyAuthentication: (response: Authentication.Response<true>) => Promise<{ publicKey: Hex }>
}
```

#### `Ceremony.local()` — pure client-side (dev/prototyping)

No server needed. Generates challenges client-side, stores the `credentialId → publicKey` mapping in localStorage. No attestation verification.

```ts
import { Provider, webAuthn, Ceremony } from 'tempo/account'

Provider.create({
  adapter: webAuthn({ ceremony: Ceremony.local() }),
})
```

#### `Ceremony.server()` — server-backed (production)

Orchestrates round-trips to the app's server. The server handles challenge generation, attestation verification, and credential storage.

```ts
import { Provider, webAuthn, Ceremony } from 'tempo/account'

// Simple: just a URL (derives endpoints from convention)
Provider.create({
  adapter: webAuthn({
    ceremony: Ceremony.server({ url: 'https://myapp.com/keys' }),
  }),
})

// URL convention:
//   GET  ${url}/register/options  → { options }
//   POST ${url}/register          → { publicKey }  (body: credential)
//   GET  ${url}/login/options      → { options }
//   POST ${url}/login              → { publicKey }  (body: response)
```

#### Custom ceremony

For full control, pass an object implementing the `Ceremony` interface:

```ts
Provider.create({
  adapter: webAuthn({
    ceremony: {
      async getRegistrationOptions() {
        return fetch('/auth/register/options', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json())
      },
      async verifyRegistration(credential) {
        return fetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify(credential),
        }).then((r) => r.json())
      },
      async getAuthenticationOptions() {
        return fetch('/auth/login/options').then((r) => r.json())
      },
      async verifyAuthentication(response) {
        return fetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify(response),
        }).then((r) => r.json())
      },
    },
  }),
})
```

#### Server-side handler

A new `Handler.webauthn` server handler (separate from the existing `Handler.keyManager`) implements the server side for `Ceremony.server()`. It uses `webauthx/server` internally for challenge generation, attestation verification (origin, RP, UP/UV flags, COSE key extraction), and credential storage.

```ts
import { Handler } from 'tempo/server'

app.route(
  '/auth/*',
  Handler.webauthn({
    kv: myKvStore,
    rp: 'myapp.com',
  }),
)
```

`Handler.webauthn` exposes four endpoints:

- `GET /register/options` — generates a random challenge, stores it in KV with TTL, returns serialized `CredentialCreationOptions`
- `POST /register` — consumes the challenge, verifies attestation (clientDataJSON type/origin, authenticatorData RP hash + flags, COSE P256 key extraction), stores `credential.id → publicKey` in KV
- `GET /auth/options` — generates a random challenge, stores it in KV, returns serialized `CredentialRequestOptions`
- `POST /auth` — consumes the challenge, looks up the stored `publicKey` by `credential.id`, verifies the P256 signature, returns the `publicKey`

#### Ceremony flows

**`createAccount`** (registration):

1. `GET /register/options` → server generates challenge, returns serialized options
2. `Registration.create({ options })` → browser passkey ceremony (`navigator.credentials.create`)
3. `POST /register { credential }` → server verifies attestation, stores `credential.id → publicKey`
4. Derive address from publicKey, return `[{ address }]`

**`requestAccounts`** (authentication):

1. `GET /auth/options` → server generates challenge, returns serialized options
2. `Authentication.sign({ options })` → browser passkey assertion (`navigator.credentials.get`)
3. `POST /auth { response }` → server verifies signature, returns `publicKey`
4. Derive address from publicKey, return `[{ address }]`

**`sign`** (purely client-side, no server round-trip):

1. Uses the stored credential to call `Authentication.sign({ options: { challenge: digest } })`
2. Returns the P256 signature directly — no server verification needed for transaction signing

### Provider architecture

The Provider is an EIP-1193 provider (using `ox` `Provider.from()`) with:

- A `request()` method that dispatches to adapter actions or proxies to the RPC node
- A reactive store (nanostores) holding `{ accounts, chainId, status }`
- EIP-1193 event emission on state changes (`accountsChanged`, `chainChanged`, `connect`, `disconnect`)
- EIP-6963 provider announcement

### Adapter interface

Each adapter implements the full set of actions. The Provider decodes RPC requests and dispatches to the adapter's action methods. The adapter returns decoded responses; the Provider handles encoding.

```ts
type Adapter = {
  setup?: (params: { store: Store }) => (() => void) | undefined
  actions: {
    createAccount: (params) => Promise<Account>
    disconnect: () => Promise<void>
    fillTransaction: (params) => Promise<Transaction>
    getCapabilities: (params) => Promise<Capabilities>
    getCallsStatus: (params) => Promise<CallsStatus>
    requestAccounts: (params) => Promise<Account[]>
    sendRawTransaction: (params) => Promise<Hash>
    sendTransaction: (params) => Promise<Hash>
    signPersonalMessage: (params) => Promise<Hex>
    signTypedData: (params) => Promise<Hex>
    switchChain: (params) => Promise<void>
  }
}
```

> **Note:** Each action's `params` is the decoded structure of the RPC method it represents. The Provider decodes the raw JSON-RPC `params` array into a typed object before passing it to the adapter action, and encodes the return value back into a JSON-RPC response.

### State management

Uses **nanostores** for reactive state. The store holds:

```ts
type State = {
  accounts: Account[]
  chainId: number
  status: 'connected' | 'disconnected' | 'reconnecting'
}
```

Pluggable persistent storage via nanostores' `persistentAtom` or a custom persistence layer (localStorage default in browser, memory for non-browser/SSR). Cookie storage is not needed for the local adapter — it only becomes relevant in the Connect adapter (Phase 2) where `auth.tempo.xyz` runs in a cross-origin iframe and needs `SameSite=None; Secure` cookies to persist state across the cross-site boundary (following Porto's Dialog pattern).

### Chain communication

Uses `viem` `createClient` with standard `http()` transport pointed at the chain's RPC. The chain is `tempo` or `tempoModerato` from `viem/chains`. No relay server. No `.extend()` decorators — use tree-shakable standalone actions from `viem/tempo` instead.

```ts
import { createClient, http } from 'viem'
import { tempo } from 'viem/chains'
import { Actions } from 'viem/tempo'

const client = createClient({ chain: tempo, transport: http() })

// Tree-shakable — only import what you use
await Actions.accessKey.authorize(client, { ... })
await Actions.token.getBalance(client, { ... })
```

### `viem/tempo` leverage

The implementation relies heavily on `viem/tempo`:

- **`Account`** — `fromWebAuthnP256`, `fromSecp256k1`, `fromP256`, `fromWebCryptoP256` for account creation from key models
- **`Transaction`** — Tempo transaction serialization, type `0x76`
- **`Actions`** — `accessKey.*`, `fee.*`, `nonce.*`, `token.*` for chain interactions
- **`WebAuthnP256`** — used internally by the `webAuthn()` adapter for credential type definitions
- **`Addresses`** — precompile addresses for the Account Keychain
- **Chain definitions** — `tempo`, `tempoModerato` from `viem/chains`

### Transaction flow (local adapter)

1. App calls `provider.request({ method: 'eth_sendTransaction', params })`.
2. Provider decodes params, calls `adapter.actions.sendTransaction()`.
3. Adapter looks up active account from store.
4. Adapter calls `client.sendTransaction()` (viem/tempo) which:
   - Fills gas/nonce via the chain
   - Creates a Tempo transaction (`type: 'tempo'`) with `calls[]`
   - Calls `adapter.sign({ address, digest })` to get the signature
   - Broadcasts via `eth_sendRawTransaction`
5. Returns transaction hash.

### Account address derivation

Tempo derives account addresses from the root key's public key: `keccak256(publicKey)` truncated to 20 bytes (same as standard EOA derivation). The `viem/tempo` `Account.*` factory functions handle this.

### EIP-6963 announcement

The Provider announces itself via EIP-6963 on setup, following Porto's pattern:

- `name`: app-configurable (default: `"Tempo Account"`)
- `rdns`: app-configurable (default: `"xyz.tempo.account"`)
- Icon: Tempo logo

### RPC method routing

| Category              | Methods                                                                                                                                                                                                                                                                               | Handling                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adapter-delegated** | `wallet_connect`, `eth_requestAccounts`, `eth_sendTransaction`, `wallet_sendCalls`, `personal_sign`, `eth_signTypedData_v4`, `wallet_disconnect`, `wallet_switchEthereumChain`, `wallet_fillTransaction`, `eth_sendRawTransaction`, `wallet_getCapabilities`, `wallet_getCallsStatus` | Decoded → adapter action → encoded response                                                                                                                                                                                                 |
| **State reads**       | `eth_accounts`, `eth_chainId`                                                                                                                                                                                                                                                         | Read directly from store                                                                                                                                                                                                                    |
| **Intercepted**       | `eth_getBalance`                                                                                                                                                                                                                                                                      | Accepts an optional `token` address parameter. Queries `balanceOf` on the TIP-20 token contract via `Actions.token.getBalance`. Tempo has no native token — standard `eth_getBalance` without a token parameter returns `0n` with no error. |
| **RPC proxy**         | `eth_call`, `eth_getTransactionReceipt`, `eth_blockNumber`, `eth_getLogs`, `eth_getTransactionByHash`, `eth_estimateGas`, `eth_getCode`, etc.                                                                                                                                         | Proxied directly to the Tempo RPC node                                                                                                                                                                                                      |

### Error codes

Standard EIP-1193 error codes: `4001` (user rejected), `4100` (unauthorized), `4200` (unsupported method), `4900` (disconnected), `4901` (chain disconnected), `4902` (switch chain error).

## Testing Decisions

### What makes a good test

Tests should verify external behavior through the Provider's `request()` interface — not internal implementation details. A test calls `provider.request(...)` and asserts on the result or emitted events.

### Integration tests (non-browser)

Use a local Tempo node (via `prool` or `testcontainers`, matching existing tempo-ts test infrastructure) and the `local()` adapter with a secp256k1 or P256 key model (headless, no WebAuthn). Tests exercise the full flow: create account → send transaction → verify on-chain state.

Following Porto's pattern: test through the Provider's EIP-1193 interface, not through internal modules.

### Browser tests

Use Vitest's browser mode to test the `webAuthn()` adapter with real WebAuthn ceremonies (use CDP to interact with WebAuthn). Tests exercise passkey creation, account discovery, and signing.

### Prior art

Follow Porto's test patterns:

- Integration tests that create a Provider, call `provider.request()`, and assert results
- Headless WebAuthn for non-browser test environments
- Test against a local chain instance

## Implementation Phases

### Phase 1 — Foundations (this PRD)

Provider shell, `local()` adapter, `webAuthn()` adapter, core adapter actions (`createAccount`, `requestAccounts`, `sendTransaction`, `wallet_sendCalls`, `signPersonalMessage`, `signTypedData`, `fillTransaction`, `sendRawTransaction`, `getCapabilities`, `getCallsStatus`, `switchChain`, `disconnect`), nanostores state, EIP-6963 announcement, persistence, tests.

### Phase 2 — Access key management

- `wallet_authorizeAccessKey` — authorize an access key with spend limits, expiry, destination scoping
- `wallet_revokeAccessKey` — revoke an access key
- `wallet_getAccessKeys` — list access keys on an account
- `accessKeysChanged` event — emitted when access keys are authorized or revoked
- Access key signing fast-path — if the active account has an authorized access key within scope, sign directly without root key prompt
- Leverages `Actions.accessKey.*` from `viem/tempo` (`authorize`, `revoke`, `getMetadata`, `getRemainingLimit`, `signAuthorization`)

### Phase 3+ — Connect adapter, external wallets, Wagmi connector

See out of scope below.

## Out of Scope

- **Connect adapter** (`tempoConnect()` / `auth.tempo.xyz` iframe/popup) — separate phase.
- **External wallet bridging** (MetaMask, Phantom, Coinbase Wallet via EIP-6963 discovery) — separate phase.
- **Wagmi connector** — separate phase, built on top of the Provider.
- **Fee sponsorship** (`feePayer` transport) — deferred.
- **Onramp / bridge flows** (`wallet_addFunds`) — deferred.
- **React Native adapter** — architecture should accommodate it, but not implemented.

## Further Notes

- `nanostores` must be added as a dependency to `package.json`.
- `webauthx` must be added as a dependency for the `webAuthn()` adapter (client-side ceremony orchestration) and `Handler.webauthn` (server-side verification).
- The `src/account/` directory will be a new package export: `"./account"` in `package.json` exports.
- `Handler.webauthn` lives in `src/server/` alongside the existing `Handler.keyManager`. The existing `Handler.keyManager` remains for backwards compatibility with apps that use the wagmi `KeyManager` interface directly.
- The implementation should be designed so the Connect adapter (Phase 2) can reuse the same Provider shell — only swapping the adapter.
