# Fee Payer + WebAuthn Example

Combines sponsored transactions (`Handler.feePayer`) with domain-bound
WebAuthn authentication (`Handler.webAuthn`). No tunnel or HTTPS setup
needed — WebAuthn works on `localhost` and the fee-payer runs same-origin.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-fee-payer-and-webauthn
pnpm i
npx wrangler kv namespace create KV
```

Paste the returned `id` into `wrangler.jsonc`, then start the dev server:

```bash
pnpm dev
```

> [!NOTE]
> In production, set `authUrl` and `feePayerUrl` to your deployed worker URL.
