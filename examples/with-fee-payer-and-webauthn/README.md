# Fee Payer + WebAuthn Example

Combines sponsored transactions (`Handler.relay({ feePayer: ... })`) with domain-bound
WebAuthn authentication (`Handler.webAuthn`). No tunnel or HTTPS setup
needed — WebAuthn works on `localhost` and the fee-payer runs same-origin.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-fee-payer-and-webauthn
npm i
npx wrangler kv namespace create KV
npm dev
```
