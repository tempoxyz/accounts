# CLI Follow-Ups

## Next Alignment Work

### 1. Support pubkey-only requests with server defaults

- Make `expiry` optional in the CLI bootstrap flow.
- Keep `limits` optional.
- Allow the CLI to send only `pub_key` and rely on server policy to apply sensible default `expiry` and `limits`.
- Keep this scoped to the CLI bootstrap path. Do not widen generic `wallet_authorizeAccessKey` semantics unless we explicitly want SDK-wide omission.
- If we need different shapes, prefer keeping the generic SDK contract stricter and making the CLI device-code request shape more permissive.
- Update the relevant CLI request and adapter contracts in:
  - `src/server/CliAuth.ts`
  - `src/cli/adapter.ts`

### 2. Adopt the extracted flow in the real wallet app

- Replace the playground-only approval surface with real `tempo/app` adoption of `Handler.cliAuth`.
- Use the extracted server core instead of a separate app-specific `/cli-auth` implementation.
- Treat this as the real browser-side integration milestone for terminal-triggered auth.

### 3. Lock the language-agnostic protocol

- Write a short protocol doc for non-TS clients.
- Include:
  - `POST /cli-auth/device-code`
  - `POST /cli-auth/poll/:code`
  - `POST /cli-auth/authorize`
  - PKCE behavior
  - request and response fields
  - polling and terminal states
- This doc should be sufficient for a future Rust CLI SDK to implement the flow directly.

### 4. Scoped access keys follow-up

- Decide whether configurable `expiry` + `limits` is sufficient for the first real release.
- If not, define the next slice for true scoped access keys after app adoption.
- Do not pretend scopes exist end to end until the upstream support is real.

## Recommended Order

1. Support pubkey-only requests with server defaults.
2. Adopt the extracted flow in the real wallet app.
3. Write the language-agnostic protocol doc.
4. Plan and implement scoped access keys as the next gated extension.
