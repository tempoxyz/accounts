---
'accounts': patch
---

Changed `funding.complete` to return `undefined` outside a browser page when the call passes no `url`, such as in a server render or a React Native app. Before, it threw a `ReferenceError` on a server, and a `TypeError` in React Native, which has no `window.location`. A call with `url` reads that URL, as before.

```ts
// In a server render: no page URL, so no result.
const result = accounts.funding.complete() // undefined
```
