---
'accounts': patch
---

Fixed `session.refresh` sending a second token request for overlapping calls in some orderings. Overlapping calls in one instance now share one refresh, also before the instance first reads the store or while that refresh saves its tokens. A call no longer reads the store before the lock, so a late read in another instance, such as another tab, sends no second request and never undoes a sign-out.

