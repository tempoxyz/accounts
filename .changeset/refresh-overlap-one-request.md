---
'accounts': patch
---

Changed `session.refresh` to send one request for overlapping calls on one store, in one instance or in another tab. A call whose refresh token another refresh or sign-in replaced while the call waited for the lock returns those tokens, unless their access token expired during the wait. Before, each call rotated the refresh token again.

```ts
const [a, b] = await Promise.all([accounts.session.refresh(), accounts.session.refresh()])
// One request: a.refreshToken === b.refreshToken
```
