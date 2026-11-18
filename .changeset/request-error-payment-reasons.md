---
'accounts': patch
---

Added `payment_pending`, `payment_reverted`, `quote_changed`, and `recipient_not_permitted` to `Accounts.RequestError.Reason`. Tempo ID's OpenAPI document lists them for a payment that its approval page sends.

```ts
if (error instanceof Accounts.RequestError && error.reason === 'quote_changed') {
  // The payment costs more than the approval page showed. Request it again.
}
```
