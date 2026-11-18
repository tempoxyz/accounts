---
'accounts': patch
---

Fixed the refusal of an access key in `accounts.authorize`. An access key with empty limits or scopes, a passed or fractional expiry, a negative limit, a fractional period, a duplicate limit, or a malformed `publicKey` throws `Accounts.RequestError` with status 0 before any request. Before, the call first read the browser's Tempo ID session, and returned `undefined` without one, so a visitor received no refusal.

```ts
await accounts.authorize({
  accessKey: { expiry: '1d', limits: [] },
}) // throws empty_limits, also without a Tempo ID session
```
