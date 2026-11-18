---
'accounts': patch
---

Fixed `dialog.signIn` to sign in with a popup for a request with `resource`, its own or the instance's. Before, the sign-in ran in Tempo ID's frame, which issues tokens for Tempo ID's origin alone, so the session's access token was not for the resource. `dialog.signMessage` and a backend's SIWE sign-in keep no token, so their requests name no resource, and they keep the frame.

```ts
await accounts.dialog.signIn({ resource: 'https://mcp.example.com/mcp' }) // opens a popup
```
