---
'accounts': patch
---

Added `available` to `passkey.prepare` and `Actions.passkey.prepare`. With it, the handle uses that value and sends no `GET /v1/realms`, so an app that knows passkeys sign in on its page, such as a first-party app on its own origin, requests the sign-in's options at once.

```ts
const prepared = accounts.passkey.prepare({ accessKey, available: true })
```
