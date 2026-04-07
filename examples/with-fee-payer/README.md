# Fee Payer Example

Demonstrates sponsored transactions using `Handler.feePayer` from `accounts/server`.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-fee-payer
pnpm i
pnpm dev
```

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
is created automatically during development so the wallet iframe can reach the
local fee-payer endpoint (required due to Chrome's
[Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight/) policy).

> [!NOTE]
> In production, set `feePayerUrl` to your deployed worker URL — no tunnel needed.
