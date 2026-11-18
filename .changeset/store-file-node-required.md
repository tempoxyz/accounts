---
'accounts': patch
---

`Store.file` throws `Store.NodeRequiredError` at creation in a runtime without Node's built-in modules, such as a browser, in place of at the first read or write. `Store.NodeRequiredError` is exported from `accounts`.
