---
'accounts': patch
---

Changed `email.signIn` to drop each character other than a digit from `code`, such as the spaces or the line break of a pasted code. Tempo ID refused such a code with `invalid_field` before.

```ts
await accounts.email.signIn({ code: ' 468 883\n', email }) // sends 468883
```
