---
'accounts': patch
---

Fixed `Store.redis` for a rejected command. The store rejects with an `Error` whose message holds only the command's name and the leading error code of the refusal. Before, the client's error held the command, as `ioredis` attaches it, and some refusals, such as `ERR unknown command`, quote it, so a log of the error quoted the session ID of the key and the refresh token of the value.

```ts
await store.setItem(key, session) // Error: SET failed with READONLY.
```
