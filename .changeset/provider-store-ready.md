---
"accounts": minor
---

Added `provider.ready()`, which resolves once the provider has loaded its stored state and rejects with `Store.HydrationError` when the storage read fails or takes longer than the new `hydrationTimeout` option (default 10 seconds). `request` now waits for the load instead of continuing with an empty store after 100ms, and `getAccount` throws `Store.HydrationError` until the load finishes instead of reporting no accounts.
