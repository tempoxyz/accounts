# Private Fee Payer Example

Demonstrates a minimal private fee payer built from the existing
`Handler.feePayer` and `Handler.webAuthn` primitives.

Unlike the public fee-payer example, this worker does not sponsor every valid
sender-signed Tempo transaction. It adds a small policy layer before delegation:

- successful register/login mints an HttpOnly same-origin session cookie
- `/fee-payer` requires that session before sponsoring anything
- the sponsored transaction `from` address must match the session address
- only allowlisted contract targets are sponsored
- direct value transfers are rejected

The frontend stays simple: it uses the normal `webAuthn({ authUrl, feePayerUrl })`
connector, and the browser automatically sends the same-origin session cookie to
`/fee-payer`.

This demo intentionally keeps the connector's local state in memory instead of
persisting it across reloads. The fee-payer authorization lives in an HttpOnly
cookie, so persisting the account separately can otherwise leave the UI looking
connected even though `/fee-payer` no longer has a valid session.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-private-fee-payer
npm i
npx wrangler kv namespace create KV
npm dev
```

## Environment

`.env.example` includes:

```bash
FEE_PAYER_PRIVATE_KEY=0x...
ALLOWED_FEE_PAYER_TARGETS=0x20c0000000000000000000000000000000000000
```

The default allowlist target is the pathUSD token contract used by the demo's
`Actions.token.transfer.call(...)` form.

## Demo Flow

1. Register or log in with a passkey.
2. Use the auth probe button to verify that `credentials: 'omit'` still gets a `401` from `/fee-payer`.
3. Fund the account.
4. Send a sponsored token transfer.

If you change the worker allowlist or try to send a direct value transfer, the
fee payer rejects the request before co-signing.
