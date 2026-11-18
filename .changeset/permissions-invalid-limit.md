---
'accounts': patch
---

Added `Permissions.InvalidLimitError`. `Permissions.resolve` and each sign-in throw it for a decimal `limit` that holds no plain decimal number, such as `'1e-7'`, which `String(0.0000001)` returns. Before, the parser's own `Value.InvalidDecimalNumberError` escaped, which no API page lists.

```ts
Permissions.resolve({ limits: [{ limit: '1e-7', token: 'ousd' }] }, { chainId }) // throws Permissions.InvalidLimitError
```
