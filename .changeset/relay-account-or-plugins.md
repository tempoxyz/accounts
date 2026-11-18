---
'accounts': patch
---

**Breaking:** The `relay` plugin takes `account` or `plugins`, and throws with both. `account` is short for `plugins: [Relay.feePayer({ account })]`. Before, `account` placed its `Relay.feePayer` before `plugins`. Viem's `Relay.feePayer` answers a raw transaction, and a fill that names its sender, gas, nonce, and fee cap, without the plugins after it. A plugin of `plugins` that refuses a request thus never received those requests, and the fee payer signed them. Pass `Relay.feePayer({ account })` in `plugins`, after each plugin that refuses a request, and before Viem's `Relay.feeToken`, `Relay.simulate`, and `Relay.autoSwap`.

```diff
 relay({
-  account,
-  plugins: [Relay.autoSwap()],
+  plugins: [Relay.feePayer({ account }), Relay.autoSwap()],
 })
```

**Breaking:** The `relay` plugin also throws with `apiKey` and `plugins`. Before, the Tempo API mode ran, and no plugin of `plugins` received a request. The options type now refuses the two, also for options that a variable holds. Remove `apiKey` for a route that runs the plugins in Viem's relay, or remove `plugins`.

```diff
 relay({
   apiKey,
-  plugins: [Relay.feePayer({ account, validate })],
 })
```
