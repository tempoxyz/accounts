---
"accounts": patch
---

`Handler.webAuthn`: `/register` reads the challenge and checks for a duplicate credential in parallel, and deletes the challenge after responding when the runtime exposes `waitUntil` (pass the execution context to `handler.fetch`).
