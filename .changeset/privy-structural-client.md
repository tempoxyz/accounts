---
'accounts': minor
---

Generalized the Privy adapter to accept any structural Privy client shim instead of a concrete `@privy-io/js-sdk-core` `Privy` instance. The adapter now talks to a 5-method `privy.Client` surface (`getAccessToken`, `getCurrentUserId`, `loadEthereumWallets`, `logout`, optional `initialize`), so apps can wire it from either `@privy-io/js-sdk-core` or `@privy-io/react-auth` (or any equivalent) via a small adapter shim.

This is a breaking change to the `client` option shape. See the updated example in the JSDoc on `privy()` and the playground (`privyCore` + `privyReact` paths) for migration patterns.
