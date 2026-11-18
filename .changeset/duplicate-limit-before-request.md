---
'accounts': patch
---

Fixed the refusal of two `accessKey.limits` on one token, such as by its symbol and by its address. Each sign-in throws `Accounts.RequestError` with the reason `duplicate_limit` and status 0 before the request that carries the access key. Before, the request carried both limits, and Tempo ID refused it only after the dialog, popup, or redirect showed its page.

```ts
await accounts.dialog.signIn({
  accessKey: {
    limits: [
      { limit: '100', token: 'ousd' },
      { limit: '5', token: '0x20c0000000000000000000006a37DA5C996874BE' },
    ],
  },
}) // throws duplicate_limit
```
