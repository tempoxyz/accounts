---
'accounts': patch
---

Fixed `signOut` without a session, such as the retry of a failed sign-out, and the `disconnect` of the `tempoId` connector after a failed one. If the revocation of the earlier sign-out's refresh token receives no answer again, the call rejects with that error. Before, it resolved, wagmi disconnected, and the refresh token stayed live at Tempo ID.

```ts
await disconnect(config).catch(() => undefined) // 503: wagmi stays connected
await disconnect(config) // 503 again: rejects, and wagmi stays connected
```
