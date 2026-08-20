---
'accounts': patch
---

Added multiple-credential passkey targeting and exposed verified authenticator model identifiers to registration hooks.

```ts
await provider.request({
  method: 'wallet_connect',
  params: [{ capabilities: { credentialId: ['credential-a', 'credential-b'] } }],
})
```
