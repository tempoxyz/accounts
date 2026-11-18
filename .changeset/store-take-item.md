---
'accounts': patch
---

Added the optional `takeItem` of `Store.Store`, which reads and deletes a value in one atomic step. `Store.memory`, `Store.postgres` (`delete … returning`), and `Store.redis` (`GETDEL`) set it, and the `siwe` plugin spends each challenge with it, so replicas that share a store verify each challenge once.

```ts
const store = Store.from({ getItem, removeItem, setItem, takeItem: (key) => redis.getDel(key) })
```
