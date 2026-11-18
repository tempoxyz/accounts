---
'accounts': patch
---

`passkey.available` sends one `GET /v1/realms` for concurrent calls on an instance, such as the two effects of a React StrictMode mount. Before, each call sent its own request. A call after the read settles, or 5 seconds after it starts, sends a new request, so a read without a response holds no later call.

```ts
const [shown, again] = await Promise.all([
  accounts.passkey.available(),
  accounts.passkey.available(),
]) // one GET /v1/realms
```
