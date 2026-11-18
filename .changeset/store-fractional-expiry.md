---
'accounts': patch
---

Fixed `Store.postgres` and `Store.redis` for an `expiresAt` with a fraction of a millisecond, which `setItem` accepts as the other stores do. Each rounds it up to the next whole millisecond, so the entry never expires early. Before, `Store.postgres` rejected the write with `invalid input syntax for type bigint`, and `Store.redis` with `ERR value is not an integer or out of range`.

```ts
await Store.redis(redis).setItem(key, value, { expiresAt: performance.timeOrigin + performance.now() + 60_000 })
```
