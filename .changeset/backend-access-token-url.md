---
'accounts': patch
---

`backend`'s `accessToken` option takes `url`, the public origin or a function that returns the public URL of a request, as the `tokens` plugin does. Behind a proxy that terminates TLS, `session.get(request)` then verifies a DPoP-bound access token whose proof names the public URL, which it refused before.

```ts
backend({ accessToken: { url: 'https://api.example' }, store })
```
