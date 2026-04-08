# Private Fee Payer Example

Demonstrates a private sponsor-first fee payer built from `Handler.feePayer`
plus `Handler.webAuthn`.

Unlike the public fee-payer example, this worker does not sponsor every valid
transaction. It adds a small policy layer before sponsor-assisted fill:

- successful register/login mints an HttpOnly same-origin session cookie
- `/fee-payer` requires that session before sponsoring anything
- the sponsored transaction `from` address must match the session address
- only allowlisted contract targets are sponsored
- direct value transfers are rejected

The frontend stays simple: it uses the normal `webAuthn({ authUrl, feePayerUrl })`
connector, and the browser automatically sends the same-origin session cookie to
`/fee-payer`.

The fee-payer route is fully stateless: it signs the session cookie instead of
storing sponsor/session state in Wrangler KV.

This demo intentionally keeps the connector's local state in memory instead of
persisting it across reloads. The fee-payer authorization lives in an HttpOnly
cookie, so persisting the account separately can otherwise leave the UI looking
connected even though `/fee-payer` no longer has a valid session.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/with-private-fee-payer
npm i
npm run dev
```

No Wrangler KV setup is required for the fee-payer flow.

The example still uses in-memory storage for the WebAuthn handler's local
challenge and credential state, so restarting the dev server clears that state.
If that happens, just register again.

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
2. Use the auth probe button, which posts a real `eth_fillTransaction` request to `/fee-payer` with `credentials: 'omit'`, and verify that it reports `401`.
3. Fund the account.
4. Send a sponsored token transfer.

If you change the worker allowlist or try to send a direct value transfer, the
fee payer rejects the request before the user signs.
