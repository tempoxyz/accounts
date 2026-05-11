---
'accounts': patch
---

Widened `mpp` on `Provider.create` to accept an options object with a `mode: 'push' | 'pull'` field and changed the default mode to `'push'` (the CLI `Provider` still defaults to `'pull'`).
