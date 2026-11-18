---
'accounts': patch
---

Fixed `backend.fetch` to throw a `TypeError` that never names the URL when the URL is malformed. Before, the parse error held the whole URL, including any token in its query, userinfo, or fragment.
