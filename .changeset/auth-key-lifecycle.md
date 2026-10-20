---
"accounts": patch
---

Reclaim expired in-memory KV entries on writes and propagate finite cache TTLs to backing storage. Capacity remains unlimited by default; opt in with `Kv.memory({ maxEntries })` to reject new keys at a chosen capacity without evicting live authentication state. Deployments must size an explicit cap and apply admission controls to avoid blocking legitimate writes.

Validate the current adapter account before local access-key transaction paths and discard keys belonging to accounts omitted by a new wallet selection. Privy revocation now waits for successful execution before deleting local key state, retaining keys on pending or failed revocations.

Upgrade Hono to 4.13.11 to fix double-decoding of static paths that could bypass middleware.
