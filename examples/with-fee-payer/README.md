# Fee Payer Example

Demonstrates sponsor-first transaction preparation using `Handler.feePayer` from
`accounts/server`.

The wallet asks `/fee-payer` to fill the transaction, the service attaches its
`feePayerSignature`, the user signs that exact prepared transaction, and the
wallet broadcasts it directly to the chain.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-fee-payer
npm i
npm dev
```

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
is created automatically during development so the wallet iframe can reach the
local fee-payer endpoint (required due to Chrome's
[Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight/) policy).

> [!NOTE]
> In production, set `feePayerUrl` to your deployed worker URL — no tunnel needed.
