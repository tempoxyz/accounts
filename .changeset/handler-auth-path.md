---
'accounts': patch
---

**Breaking:** `accounts.handler` serves the sign-in routes of the `backend` and `siwe` plugins under `/auth` of its `basePath`, apart from `/access-keys` and `/relay`: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, `/api/auth/session`, `/api/auth/siwe/challenge`, and `/api/auth/siwe/verify` by default. The default redirect URI is `/api/auth/callback`, and `dialog({ backend })` calls the new paths. Register the new redirect URI, and move links and requests to the new paths.

```ts
// Before
fetch('/api/session')
// After
fetch('/api/auth/session')
```
