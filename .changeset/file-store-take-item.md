---
'accounts': patch
---

Added `takeItem` to `Store.file`. It reads and deletes an entry under the file's lock, so of several processes on one file, only one receives each value. The `siwe` plugin spends each challenge with it. Before, two processes on one file read and removed a challenge in two calls, and both verified it.

```ts
const accounts = Accounts.create({
  plugins: [backend({ store: Store.file('./sessions.json') }), siwe()],
})
```
