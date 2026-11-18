---
'accounts': patch
---

Changed `session.refresh` and `session.fetch` outside a browser to read the store after a refused refresh token. If the store holds other tokens, such as from a second run of a CLI on one `Store.file`, the refresh returns that session without a second request. Otherwise it sends the same refresh token again once after one second. Before, it always sent the token again.

```ts
// Two runs of a CLI, each with an expired access token, on one file.
const response = await accounts.session.fetch({ url: 'https://api.example/me' })
```
