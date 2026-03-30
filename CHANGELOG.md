# accounts

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
