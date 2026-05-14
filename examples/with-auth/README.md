# With Auth Example

Demonstrates server-side session authentication using `Handler.auth` from
`accounts/server` and the `auth` capability on `tempoWallet`.

The wallet signs a SIWE-style challenge during `wallet_connect`, the worker
verifies it, and the SDK is issued a `Set-Cookie` session that authenticates
follow-up requests like `GET /me`.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-auth
npm i
npm dev
```

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
is created automatically during development so the wallet iframe can reach the
local auth endpoint (required due to Chrome's
[Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight/) policy).
