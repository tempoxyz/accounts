---
'accounts': patch
---

Stopped the default `dialog` plugin of an instance without a sign-in plugin from loading its chunk on a page that restores a live session. The chunk loads once the session ends, at the first action, or on a page without a saved session or with an expired one. Before, every page load fetched the dialog's code, about 11 kB gzipped in four requests, which a returning user never ran.

```ts
const accounts = Accounts.create()
```
