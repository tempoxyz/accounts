---
'accounts': patch
---

Fixed `account.get` outside a page, such as in React Native or a CLI, for a user without an account. The action sent a creation request that only a page's session cookie authenticates, and rethrew its refusal, `Sign in first.`, with status 401. It now throws `session_required` with status 0 before the creation request, so the read takes one round trip.
