---
'accounts': patch
---

**Breaking:** the `dialog` plugin takes `mode: 'iframe' | 'popup'`, which replaces `popup: boolean`. `preload` is an option of the `'iframe'` mode only, so `dialog({ mode: 'popup', preload: true })` does not compile.

```diff
-const accounts = Accounts.create({ plugins: [dialog({ popup: true })] })
+const accounts = Accounts.create({ plugins: [dialog({ mode: 'popup' })] })
```
