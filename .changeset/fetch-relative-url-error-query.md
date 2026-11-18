---
'accounts': patch
---

`session.fetch` and `Actions.fetch` throw a `TypeError` that never names the URL for a relative or malformed URL outside a page, such as in React Native. The URL's userinfo, query, or fragment can hold a token. A malformed URL no longer surfaces the parse error, whose `input` holds the whole URL.
