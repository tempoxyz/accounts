---
'accounts': patch
---

A refresh reads the stored session and the store's refresh token rotations at once, in one round trip of the store before its record of the pending rotation, not two. A refresh on `Store.postgres`, `Store.redis`, or `Store.file` thus waits for one query less before its request to Tempo ID. A plugin's `context.session` holds `rotations`, which reads the rotations, and a change takes the read as its `rotations` option.
