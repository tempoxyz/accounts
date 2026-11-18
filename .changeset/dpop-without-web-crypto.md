---
'accounts': patch
---

Fixed the rejection of the `dpop` plugin and `Dpop.create` in a runtime without `crypto.subtle`, such as React Native. They reject with a `TypeError` that names the fix before any store read. Before, the runtime's `TypeError` read `generateKey` of `undefined`.

```ts
const accounts = Accounts.create({ plugins: [await dpop()] })
```
