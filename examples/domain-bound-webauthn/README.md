# Domain-Bound WebAuthn Example

Demonstrates using the `webAuthn` connector with server-side WebAuthn ceremony
handling via `Handler.webAuthn`. Passkeys are bound to your domain without a third-party wallet popup.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/domain-bound-webauthn
npm i
npx wrangler kv namespace create KV
npm dev
```

> [!NOTE]
> In production, set `authUrl` to your deployed worker URL and configure
> `rpId` / `origin` to match your domain.
