---
'accounts': patch
---

Fixed concurrent charges of `accounts.fetch` and `accounts.mpp({ … }).fetch` for an access key that the chain does not hold yet. Each charge attached the key authorization, and the chain registered it only once, so the endpoint's broadcast of each other charge timed out. A later charge of the same instance now waits until the charge that attaches the key authorization settles, then signs without it. A turn lasts at most 5 seconds, then one waiting charge takes it, so a stalled endpoint blocks no other charge for longer.

```ts
// Each request pays, and only the first transaction registers the access key.
await Promise.all([accounts.fetch(url), accounts.fetch(url), accounts.fetch(url)])
```
