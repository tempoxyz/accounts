---
'accounts': patch
---

Fixed the refusal of a malformed `funding` hint. `backend.start`, `redirect.signIn`, `dialog.signIn`, and `device.signIn` throw `Accounts.RequestError` with the reason `invalid_field`, status 0, and the `field`, such as `funding.amount`, before any request, for an amount that is not a decimal string above 0 with at most 18 digits and 18 decimals, a currency that is not three capital letters, or an empty token. Before, the sign-in left the page for Tempo ID, which sent the user back with `invalid_request`, and no `reason` or `field`.

```ts
await accounts.backend.start({ funding: { amount: '-1' } }) // throws invalid_field
```
