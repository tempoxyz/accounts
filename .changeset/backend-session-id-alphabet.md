---
'accounts': patch
---

Fixed the `backend` plugin deleting an entry of another owner in its store for a crafted session ID. The session of an instance with its own `store` also has a key that starts with `tempo-id:session:`. If the instance shared the store of `backend({ store })`, a `__Host-tempo-id.sid` cookie that held the instance's session name made `GET /auth/session` or `POST /auth/logout` delete that session.

A session ID now holds 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `-`, and `_`, as each ID that the plugin creates does. Under any other value, `backend.get`, `backend.fetch`, `backend.end`, and the routes serve only a session that an earlier release stored, and the store keeps any other entry. The keys of stored sessions stay as they are, and each stored session still reads, refreshes, and ends.

**Breaking:** `backend.save` and `backend.start` reject an `id` of other characters with `invalid_request` and the `field` `id`.

```diff
- await accounts.backend.save({ id: Base64.fromBytes(bytes), session })
+ await accounts.backend.save({ id: Base64.fromBytes(bytes, { pad: false, url: true }), session })
```
