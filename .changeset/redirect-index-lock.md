---
'accounts': patch
---

Fixed `redirect.signIn` and `Actions.redirect.start` in tabs that start a redirect at once. Each start rewrote the store's index of pending redirects without a lock, so one tab could drop the row of the other. With the default IndexedDB store, which never expires an entry, the state of that redirect then stayed in the store. With the default store, each start now rewrites the index under a Web Lock, and sends no extra request.
