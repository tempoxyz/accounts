# accounts

## 0.9.0

### Minor Changes

- 063680a: Generalized remote theme handling: switched to `data-theme-radius`, `data-theme-accent`, and `--theme-accent` hooks, included `scheme` in live theme messages, and let the consuming app own preset-to-UI mapping. The `font` URL param and `--font-body` injection were removed — consumers now own font loading.

  ```diff
  - [data-accent='blue'] { … }
  + [data-theme-accent='blue'] { … }

  - [data-radius='medium'] { … }
  + [data-theme-radius='medium'] { … }

  - :root { background: var(--accent-base); }
  + :root { background: var(--theme-accent); }

  - // ?accent=…&radius=…&font=…&scheme=…
  + // ?accent=…&radius=…&scheme=…
  ```

### Patch Changes

- ce5677d: Added relay virtual-address resolution metadata to `eth_fillTransaction` capabilities.

## 0.8.10

### Patch Changes

- fc3d61c: Optimized `Handler.relay`'s `eth_fillTransaction` path with a speculative sponsored fill (skipping fee-token resolution when the sponsor accepts), KV-cached `Actions.fee.getUserToken` lookups, and a `capabilities.balanceDiffs: false` opt-out that skips the post-fill `tempo_simulateV1` round trip.

## 0.8.9

### Patch Changes

- 56d9b26: Added `keyType`, `keyId`, and `keyData` to the `transactionRequest` Zod schema so they survive decoding when callers (e.g. wagmi) include them on `eth_fillTransaction` / `eth_sendTransaction` / `eth_signTransaction` payloads.

## 0.8.8

### Patch Changes

- 451f4f5: Added the transaction's call targets as fallback fee-token candidates in `Handler.relay` so users transferring a token they hold can pay gas in that token without an autoSwap.
- 1d75917: Fixed `Handler.relay` to treat the pre-emptive fee-token autoSwap as best-effort, falling back to the resolved `feeToken` instead of failing when the swap itself can't be filled.
- 451f4f5: Added `chainId` to the `wallet_send` return value alongside `receipt` so callers can identify which chain the receipt belongs to.

## 0.8.7

### Patch Changes

- 763ccfc: Treated `undefined` as "no value" in `Storage.combine` reads so adapters that return `undefined` for missing keys (Map-backed, custom caches) fell through to the next adapter instead of short-circuiting.

## 0.8.6

### Patch Changes

- a15e214: Renamed `input` → `token` and `output` → `pairToken` in `POST /exchange/quote`
- 81f8183: Included token logo URIs (`logoUri`) in the `GET /exchange/tokens` response.
- 9a19429: Added `receipts` to the `wallet_deposit` RPC response.
- 176c1d3: Added `wallet_depositZone` and `wallet_withdrawZone` RPC methods for moving funds between the parent Tempo chain and a private zone.

## 0.8.5

### Patch Changes

- a9c2b0d: Added `Handler.exchange()` for the Tempo Stablecoin DEX, exposing `GET /exchange/tokens` and `POST /exchange/quote`.
- 5c5988f: Exported `ExecutionError`.
- 5c5988f: Fixed relay default pass-through to return upstream RPC errors as structured JSON-RPC errors instead of HTTP 500.

## 0.8.4

### Patch Changes

- b06061e: Changed `wallet_swap` `amount` parameter from raw hex to a human-readable decimal string (e.g. `"1.5"`), matching `wallet_send`'s `value`.

## 0.8.3

### Patch Changes

- f3ac13b: Bumped `mppx` to `0.6.5`.
- 3c77fe7: Passed the resolved CLI auth chain ID to `CliAuth.Policy.validate`.
- ba69e15: Allowed CLI auth approvals to return a different expiry or spending limits when the submitted signature covers those values.
- 37cf2a9: Replaced the `.local` shortcut in `TrustedHosts.match` with an opt-in `source` parameter that treats hostnames sharing the same registrable domain ("eTLD+1") as `source` as trusted.
- 08c0e12: Added `wallet_swap` RPC action.

## 0.8.2

### Patch Changes

- 9ffdd28: Modified `wallet_send` to return `{ receipt }` instead of `{ transactionHash }`
- 9ffdd28: Resolved relative `feePayer` URLs in `Client.fromChainId` against `window.location.origin` in the browser.
- 3ec1b23: Added `wallet_send` RPC action.
- 7c62e76: Fixed `Remote.ready()` reverting persisted chain by removing stale `chainId` URL param switch.
- 8b6265a: Logged access key sign errors in the `dialog` adapter's `withAccessKey` catch block via `console.warn` before removing the stale key.
- 9ffdd28: Merged original `eth_fillTransaction` request fields (calls, chainId, validBefore, key data, feePayer) into the chain's filled tx so sponsorship envelope serialization no longer throws `CallsEmptyError`.
- 9ffdd28: Forwarded upstream relay `capabilities.autoSwap` and `InsufficientBalance` errors through the wallet relay so external fee-payer fills surface autoSwap metadata and trigger the local autoSwap fallback.
- 447707a: Made `wallet_revokeAccessKey` on the local adapter send a `revokeKey` transaction to the AccountKeychain precompile via `Actions.accessKey.revoke` before removing the key from the local store.
- 77b094b: Fixed `wallet_revokeAccessKey` in the local adapter crashing with `KeyNotFound` when the access key was only authorized locally and never registered on-chain via a transaction.
- 9ffdd28: Added `feePayer` parameter to `wallet_send` for per-call fee payer override.
- 9ffdd28: Exported `Rpc.wallet_send.parameters` zod schema for the `wallet_send` parameters object.

## 0.8.1

### Patch Changes

- c4b669b: Fixed relay handler gas bump not applying when `feePayer` is present. The condition checked `result.tx.feePayer` (node response) which is not set; now checks `request.feePayer` (the input).

## 0.8.0

### Minor Changes

- d058f26: Updated default dialog host from `https://wallet.tempo.xyz/embed` to `https://wallet-next.tempo.xyz`.
- d058f26: Added runtime theme sync for iframe dialog. Theme changes (accent, radius, font) now propagate to the cached iframe without reloading via the `syncTheme` method and a new `theme` messenger topic.

### Patch Changes

- d058f26: Changed `chainId` type in `wallet_authorizeAccessKey` parameters and `Adapter.authorizeAccessKey.Parameters` from `number` to `bigint` to match ox/viem's `KeyAuthorization.chainId`.
- d058f26: Added label-based deduplication in `wallet_connect` to sign in with an existing credential when a matching account label is found during registration.
- d058f26: Fixed `feePayer: false` to correctly propagate through `resolveFeePayer` and `prepareTransactionRequest`, allowing per-request opt-out of fee payers.
- d058f26: Added support for app-provided fee payer URLs in `Handler.relay`. The relay now proxies `eth_fillTransaction` through an external fee payer service when a URL is provided, and passes through sponsor metadata from the upstream response.
- d058f26: Added a 20k gas buffer for sponsored transactions in the relay to prevent out-of-gas reverts from signature size differences.
- d058f26: Changed fee token resolution in the relay to lazily resolve swap source tokens on `InsufficientBalance` instead of eagerly resolving upfront.
- d058f26: Restructured relay fill logic into three paths (guaranteed, conditional, no sponsorship) with parallelized simulation, signing, and autoSwap metadata resolution.
- d058f26: Added `name` and `url` fields to relay sponsor metadata in `eth_fillTransaction` responses.
- d058f26: Added `feePayerSignature`, `period` on key authorization limits, and `displayName` on `wallet_deposit` to RPC schemas. Exported `wallet_authorizeAccessKey.returns`.
- d058f26: Added `maxAccounts` option to `Provider.create` and `Store.create` for LRU eviction of persisted accounts.
- d058f26: Added `.local` TLD to trusted hosts for local development.
- d058f26: Passed registration `name` through the webAuthn challenge store so it is available in the `onRegister` callback.

## 0.7.2

### Patch Changes

- 6be8e14: Added `chainId` parameter to `wallet_authorizeAccessKey` to allow scoping key authorizations to a specific chain instead of defaulting to the active chain.
- b8863bb: Deprecated `accounts/wagmi`. Consumers should use the following entrypoints instead: `wagmi/tempo`, `@wagmi/core/tempo`, or `wagmi/connectors` (when they only need `tempoWallet`).
  - wagmi@0.0.0

## 0.7.1

### Patch Changes

- 8792ea4: Added `scopes` and `limits.period` to `authorizeAccessKey`.
- 8792ea4: Added support for Tempo Devnet.
- fbd691f: Updated dependencies.

## 0.7.0

### Minor Changes

- bcd4ec3: **Breaking**: Added `features` option to `Handler.relay` to control feature enablement.

  - `features: 'all'` enables fee token resolution, auto-swap, and simulation (balance diffs + fee breakdown), at the cost of network latency.
  - If `features` is not present, only enables fee payer sponsorship by default.

- 97ea5b4: Removed `Handler.feePayer`.
  Updated `Handler.relay` to be backwards compatible with `Handler.feePayer`.

### Patch Changes

- d6a4620: Added `error` and `requireFunds` capabilities to `eth_fillTransaction` relay responses.
- 3064657: Add a shared `CliAuth.from()` helper to reuse CLI auth defaults and cached clients across create, pending, poll, and authorize flows, and reject device-code requests for unconfigured chains.

## 0.6.7

### Patch Changes

- 572cde0: Bumped trusted hosts

## 0.6.6

### Patch Changes

- 85d462d: Added JSON-RPC batch request support to `Handler.relay`. The handler now accepts arrays of JSON-RPC request objects and returns an array of responses, matching the [JSON-RPC 2.0 batch spec](https://www.jsonrpc.org/specification#batch).

## 0.6.5

### Patch Changes

- f3d04b5: Updated RPC types.

## 0.6.4

### Patch Changes

- a5f538a: Added `calls` to `capabilities.autoSwap` containing the injected swap calls (approve + buy).

## 0.6.3

### Patch Changes

- e12d57c: Added `autoSwap: false` to disable automatic AMM resolution on `Handler.relay`.
- e12d57c: Renamed `feeSwap` to `autoSwap` on `Handler.relay` options and response metadata.
- 60e0f5f: Renamed `meta` to `capabilities` in `eth_fillTransaction` response.

## 0.6.2

### Patch Changes

- 3f2ce93: Fixed external access key authorisation in dialog adapter.
- 3f2ce93: Added `validate` callback to `Handler.feePayer` and `Handler.relay` for conditional sponsorship.
- 3f2ce93: Added `Handler.relay` with fee token resolution, simulation, AMM auto-swap, and sponsoring.

## 0.6.1

### Patch Changes

- 1aa18fe: Added `feePayer` to `wallet_sendCalls` capabilities and `wallet_getCapabilities` response.
- 1aa18fe: Support `feePayer: false` to opt out of fee payers on a per-transaction basis when a provider-level fee payer is configured.

## 0.6.0

### Minor Changes

- 36db0d9: **Breaking:** Renamed `feePayerUrl` to `feePayer`.

## 0.5.9

### Patch Changes

- 901cfee: Fixed iframe dialog getting stuck on "Check prompt" when the store is swapped during React re-renders.

## 0.5.8

### Patch Changes

- b4c87a3: Fixed iframe dialog getting stuck on "Check prompt" when the store is swapped during React re-renders.
- 567bf0a: Added `accounts/react-native` entrypoint with React Native adapter and storage implementation.

## 0.5.7

### Patch Changes

- cc334ff: Injected active `chainId` into transaction requests when the consumer does not provide one.

## 0.5.6

### Patch Changes

- 6eff229: Added `privateKey` support to `dangerous_secp256k1()` so wagmi configs could pin distinct signers per connector.

## 0.5.5

### Patch Changes

- b03c228: Bumped deps

## 0.5.4

### Patch Changes

- 4936c12: Fixed `Dialog.iframe()` injecting duplicate iframes by caching the instance as a singleton keyed by host.

## 0.5.3

### Patch Changes

- 7134f07: Updated internal dependencies.

## 0.5.2

### Patch Changes

- 1450dd5: Fixed the wagmi WebAuthn connector to forward authUrl so server-backed WebAuthn flows correctly called /auth/\* instead of falling back to local-only mode.

## 0.5.1

### Patch Changes

- 6c80aba: Fixed dialog backdrop appearing black on macOS Light mode.

## 0.5.0

### Minor Changes

- 5b4ce03: Public release.

## 0.4.25

### Patch Changes

- 0228a50: Fixed `Dialog.isInsecureContext()` to return `true` for `http:` protocol — `http://localhost` is a secure context but WebAuthn still requires HTTPS, so the dialog now correctly defaults to popup.
- 0228a50: Fixed `feePayerUrl` to be used by default when configured — previously required `feePayer: true` on each transaction, now auto-applies unless explicitly opted out with `feePayer: false`.

## 0.4.24

### Patch Changes

- 825ece0: Added `dangerous_secp256k1` wagmi connector.

## 0.4.23

### Patch Changes

- 88ff46d: Added `tempo-docs-git-jxom-accounts-sdk-docs-tempoxyz.vercel.app` to trusted hosts.

## 0.4.22

### Patch Changes

- 0289ff0: Renamed `Handler.webauthn` to `Handler.webAuthn`.

## 0.4.21

### Patch Changes

- e892698: Renamed `Ceremony` to `WebAuthnCeremony`.
- 59d5d90: Renamed `Handler.webauthn` to `Handler.webAuthn`.

## 0.4.20

### Patch Changes

- f7929e2: Added `onError` option to `Remote.respond`. Return `true` from the callback to suppress the error response to the parent, allowing the dialog to show a recovery UI instead of rejecting.

## 0.4.19

### Patch Changes

- 54a9395: Added `wallet_deposit` RPC method for requesting funds. On testnet, shows a faucet UI. On mainnet, shows a bridge deposit flow. Fixed `Remote.respond` to correctly handle void return types.

## 0.4.18

### Patch Changes

- 0a3396c: Handle `eth_fillTransaction` in Provider to inject pending `keyAuthorization` for access key accounts.

## 0.4.17

### Patch Changes

- ba93170: Enabled MPP on provider with pull mode by default.

## 0.4.16

### Patch Changes

- 46cd976: Made CLI use wallet.tempo.xyz as server and keys.toml
- 00de151: Added provider transport to `getClient()` so viem actions route through the provider adapter. Accepted standard `to`/`data` fields in `eth_sendTransaction` and converted them to Tempo `calls` format.

## 0.4.15

### Patch Changes

- 715d830: Moved trusted hosts list to `trusted-hosts.json` at the project root.

## 0.4.14

### Patch Changes

- b7151af: Added `chainId` in `wallet_connect` to set the active chain before the dialog opens.

## 0.4.13

### Patch Changes

- 0df27dd: Added `*.localhost` and `benedict.dev` to trusted hosts.

## 0.4.12

### Patch Changes

- 867b9ae: Fixed Safari using popup instead of iframe for non-WebAuthn requests (e.g. `sendTransaction`).
- dfb552b: Added `*.tempo.xyz` to trusted hosts.

## 0.4.11

### Patch Changes

- 7341ffc: Added `TrustedHosts.match()` with wildcard pattern support (e.g. `*.porto.workers.dev`).

## 0.4.10

### Patch Changes

- 3854ee4: Added `TrustedHosts` module with per-dialog-host trusted origin mappings. Accepted `readonly string[]` for `trustedHosts` in `Remote.create`.

## 0.4.9

### Patch Changes

- e006f99: Fixed duplicate EIP-6963 provider announcements for the same wallet rdns.

## 0.4.8

### Patch Changes

- 5795462: Broke circular dependency between `Schema` and `rpc` modules that caused runtime errors when bundled with esbuild.
- a622e07: Defaulted to popup dialog on insecure (HTTP) contexts where iframes cannot use WebAuthn.
- a622e07: Stripped `www.` prefix when checking trusted hosts for dialog origin validation.

## 0.4.7

### Patch Changes

- 1b9e9a6: Added `Remote.noop()` for SSR environments and handled Bitwarden blocking WebAuthn in cross-origin iframes.
- 457f7a7: Added strict parameter validation for `wallet_authorizeAccessKey` and `wallet_connect` in dialog adapters. `limits` is now required when authorizing access keys through the dialog. Added `Remote.validateSearch` to validate search params with formatted error messages and automatic rejection via `remote.rejectAll`.

## 0.4.6

### Patch Changes

- e0724cd: Added `wallet_authorizeAccessKey` support to the CLI adapter, allowing access keys to be authorized independently from `wallet_connect`.

## 0.4.5

### Patch Changes

- c86cd60: Added fee payer support for the dialog adapter. When `feePayerUrl` is configured, transactions sent through the dialog embed now use `withFeePayer` transports for preparation and sending.
- 1525992: Added warning when dialog adapter is initialized on a non-secure (HTTP) origin.

## 0.4.4

### Patch Changes

- c7c1682: Fixed `wallet_getCallsStatus` returning status 500 for pending transactions. Now returns status 100 when `eth_getTransactionReceipt` is null, allowing `waitForCallsStatus` to continue polling until inclusion.
- bd37754: Fixed `dialog` wagmi connector dropping `Provider.create` options like `authorizeAccessKey` and `feePayerUrl`. Now forwards all remaining options to `setup()`.

## 0.4.3

### Patch Changes

- 75e4cf2: Fixed iframe dialog being silently removed by React 19 hydration in Next.js App Router. A `MutationObserver` now detects removal and re-appends the dialog with a fresh messenger bridge.

## 0.4.2

### Patch Changes

- bf06710: Added CLI adapter & provider via an `accounts/cli` entrypoint.
- 4a52018: Added `accounts/react` entrypoint with `Remote.useState` and `Remote.useEnsureVisibility` hooks. Exposed `trustedHosts` on the `Remote` type.

## 0.4.1

### Patch Changes

- b2a347c: Updated zile.

## 0.4.0

### Minor Changes

- f257ccc: Initial release.
