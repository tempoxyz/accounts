# Access Key + WebAuthn Example

Combines domain-bound WebAuthn authentication with automatic access key
authorization. After the initial passkey ceremony, transactions are signed
locally without further prompts.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-access-key-and-webauthn
npm i
npx wrangler kv namespace create KV
npm dev
```
