---
'accounts': patch
---

The `/auth/callback` route of the `backend` plugin deletes the session that a sign-in replaces beside the index write of the new session's `sid`, in place of after it. A sign-in over a session with `Sessions.durableObject` then takes 2 rounds of Durable Object calls in place of 3.
