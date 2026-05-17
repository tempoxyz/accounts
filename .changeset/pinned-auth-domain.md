---
"accounts": minor
---

**Breaking:** Changed `Handler.auth()` to require callers to provide `origin` or `domain`, so SIWE challenge and verify flows pinned domain binding instead of deriving it from request `Host` headers.
