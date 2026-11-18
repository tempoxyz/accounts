---
'accounts': patch
---

Fixed `Challenge.verify` to refuse a root key's signature for an account that holds a configuration. Before, a secp256k1, P256, or WebAuthn signature passed if its key derived the account's address, so the root key that an upgrade in place retired still proved the account. A root key's signature that verifies now sends one request, which reads the account's config commitment. If the request fails, the call rejects with Viem's error.

```ts
// An upgraded account's root key signed `keyAuthorization`.
await Challenge.verify(client, { accessToken, challenge, keyAuthorization }) // throws `Challenge.InvalidError`
```

**Breaking** for a `client` that reaches no node. Before, a root key's proof passed with no request.

```diff
- const client = createClient({ chain: tempo, transport: http('http://127.0.0.1:9') })
+ const client = createClient({ chain: tempo, transport: http() })
```
