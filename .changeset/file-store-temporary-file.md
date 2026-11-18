---
'accounts': patch
---

Fixed the temporary files of `Store.file`, which hold the session's tokens and the access key's private key. A write whose write or rename fails removes its temporary file, and each write removes a temporary file older than 10 seconds, which a process that ended before its rename left, such as at Ctrl-C. Before, such a file stayed beside the store, also after `signOut`.

```ts
const accounts = Accounts.create({ clientId: 'cli:acme-example', plugins: [device({ onCode })] })
await accounts.signOut()
```
