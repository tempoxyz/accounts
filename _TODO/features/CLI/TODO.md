# CLI Follow-Ups

## Next Alignment Work

### 1. Real wallet app adoption of the extracted flow

- Replace the playground-only approval surface with real `tempo/app` adoption of `Handler.cliAuth`.
- Use the extracted server core instead of a separate app-specific `/cli-auth` implementation.
- Treat this as the real browser-side integration milestone for terminal-triggered auth.
- Decide what app-owned browser routes are needed on top of `Handler.cliAuth` for real approval UX.
  - The playground currently composes extra dev-only routes like pending-request lookup and one-click approval.
  - The generic handler intentionally only owns the 3 POST protocol endpoints.

### 2. Lock the language-agnostic protocol

- Write a short protocol doc for non-TS clients.
- Include:
  - `POST /cli-auth/device-code`
  - `POST /cli-auth/poll/:code`
  - `POST /cli-auth/authorize`
  - PKCE behavior
  - request and response fields
  - polling and terminal states
- Clarify the difference between:
  - the real terminal bootstrap flow via `playground/scripts/cli-auth.ts`
  - the browser-side playground demo buttons that seed pending requests directly
- This doc should be sufficient for a future Rust CLI SDK to implement the flow directly.

### 3. Scoped access keys follow-up

- Decide whether configurable `expiry` + `limits` is sufficient for the first real release.
- If not, define the next slice for true scoped access keys after app adoption.
- Do not pretend scopes exist end to end until the upstream support is real.

## Recommended Order

1. Adopt the extracted flow in the real wallet app.
2. Write the language-agnostic protocol doc.
3. Plan and implement scoped access keys as the next gated extension.
