---
'accounts': patch
---

Fixed `session.fetch` and `Actions.fetch` with a relative URL outside a page, such as in React Native. They threw `TypeError: Cannot read properties of undefined (reading 'href')`. They now throw a `TypeError` that names the URL and asks for an absolute URL.
