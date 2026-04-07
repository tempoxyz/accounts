# accounts

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
