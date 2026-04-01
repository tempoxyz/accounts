# accounts

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
