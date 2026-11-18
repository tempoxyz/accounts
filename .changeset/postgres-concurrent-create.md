---
'accounts': patch
---

Fixed the first write of `Store.postgres` from replicas that start on a new table at the same time. Postgres refuses one of two creates of the table or its index that run at once, even with `if not exists`, so a write on that replica, such as a sign-in's, rejected with a unique violation, or a deadlock in a transaction. One block now creates the table and its index under an advisory lock, so the creates run in turn, also in transactions, in one query in place of two.

```ts
const store = Store.postgres(new Pool({ connectionString: process.env.DATABASE_URL }))
```
