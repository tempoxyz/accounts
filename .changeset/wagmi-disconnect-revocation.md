---
'accounts': patch
---

Fixed the `tempoId` wagmi connector's `disconnect` when its sign-out rejects, such as for a revocation without an answer. The session still ends, and the provider emits `disconnect`, but wagmi now stays connected, so wagmi's next `disconnect` reaches the connector and revokes the refresh token. A sign-out or a sign-in through the instance itself ends that connection too. Before, wagmi disconnected at once, its next `disconnect` called no connector, and the refresh token stayed live. A revocation still without a response after 10 seconds now counts as answered, so a stalled request never keeps wagmi connected, and the sign-out never sends it again, which would count as a reuse. `machines.disconnect` in `accounts/wagmi` models the connector's sign-outs.

```ts
await disconnect(config).catch(() => disconnect(config))
```
