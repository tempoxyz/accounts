---
'accounts': patch
---

Fixed `accounts.session.get` of the `backend` plugin to end a session that no refresh renews, such as a SIWE session past its expiry or a Tempo ID session without a refresh token, without taking the store's refresh lock. On `Store.redis` such a read now sends one `GET` and one `DEL`, instead of five commands.
