---
"accounts": patch
---

Reclaim expired in-memory KV entries on writes and bound retained entries to 10,000 by default. Configure `Kv.memory({ maxEntries })` for a different capacity; writes of new keys fail at capacity instead of evicting active authentication state.

Validate the current adapter account before local access-key transaction paths and discard keys belonging to accounts omitted by a new wallet selection. Privy revocation now waits for successful execution before deleting local key state, retaining keys on pending or failed revocations.

Upgrade Hono to 4.13.11 to fix double-decoding of static paths that could bypass middleware.
