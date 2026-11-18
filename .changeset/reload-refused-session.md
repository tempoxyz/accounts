---
'accounts': patch
---

Fixed `session.reload` to adopt no session that a refusal marked `signedIn` ended, while the end of that refusal waits for the lock and the store still holds it. A `reload({ hooks: true })`, such as at the `connect` of the `tempoId` connector outside a page, then runs no `afterSignIn` hook for it.
