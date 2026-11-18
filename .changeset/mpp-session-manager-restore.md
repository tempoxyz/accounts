---
'accounts': patch
---

Changed the session manager of `accounts.mpp.session()` to load the stored session at its first request, stream, or top-up when the instance holds no session yet, such as after a restart. Before, it threw `Accounts.SignedOutError` at once for a returning user whose valid session the store held, unless the app read the session first.

```ts
const session = accounts.mpp.session()
await session.fetch('https://api.example.com/content')
```
