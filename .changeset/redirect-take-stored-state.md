---
'accounts': patch
---

Fixed the `redirect` plugin redeeming one authorization code twice when two tabs return from one redirect at once, such as a duplicated tab, with a store that sets `takeItem`, such as `Store.redis`. The returning tab now takes the stored redirect with `takeItem`, so one tab redeems the code and signs in, and the other finds no redirect.
