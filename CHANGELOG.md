# accounts

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
