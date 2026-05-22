# mpp_authorize spike

Source: https://gist.github.com/deodad/55d5343e0abe27fc1f2788b2548f7de2

## Implemented shape

- Added `mpp_authorize` to the core RPC schema.
- Added `mpp` capability discovery through `wallet_getCapabilities`.
- Routed `mpp_authorize` through the active adapter via `authorizeMpp`.
- Reused `mppx` challenge parsing and credential creation through shared MPP helpers that wrap raw challenge strings in a synthetic 402 `Response`.
- Rejected empty challenge lists, non-Tempo challenges, multi-challenge session continuation, and session continuation against non-session challenges.
- Added a shared `MppAuthorization.authorize` flow that selects a locally managed access key when available, then falls back to the adapter-provided root account.
- Each adapter supplies only account lookup functions: `getRootAccount(address)` and `getAccessKeyAccount({ accessKey, chainId, root })`.
- Local adapters resolve the active/root account with `getAccount({ signable: true })`; Turnkey resolves the selected Turnkey wallet to a `viem/tempo` account; Privy wraps the embedded wallet provider as a local viem account backed by `secp256k1_sign`; dialog uses viem's simple JSON-RPC account wrapper for the active root address with requests routed through the dialog provider.
- For `session.action = "voucher"` or `"close"`, hydrated `session.authorizedSigner` from locally managed access keys when it is not the active root account. Root-authorized continuations pass the root signer directly.
- Added playground coverage for both paths:
  - direct JSON-RPC `mpp_authorize` probes that fetch a raw 402 challenge, call the provider RPC, and retry with `Authorization`;
  - the existing MPPX client session manager path, which still routes credential creation through wallet `mpp_authorize` when available.

## Request flow

1. The app or MPPX client receives a 402 response with `WWW-Authenticate`.
2. The caller invokes `provider.request({ method: "mpp_authorize", params: [{ challenges, session? }] })`.
3. `Provider.ts` validates the request, checks that MPP support is enabled, and dispatches the decoded params to `actions.authorizeMpp`.
4. `MppAuthorization.authorize` validates the Tempo challenge and resolves the concrete signer through the active adapter:
   - local/secp256k1/WebAuthn: matching access key first, then `getAccount({ signable: true })`;
   - Turnkey: matching access key first, then the fetched Turnkey wallet as a Tempo account;
   - Privy: matching access key first, then a local viem account wrapper over the embedded wallet provider;
   - dialog: matching local access key first, then a JSON-RPC account for the active root address.
5. The helper builds a synthetic 402 `Response` and calls request-local `Mppx.create(...).createCredential(response, context)`.
6. MPPX fulfills the selected Tempo charge/session/subscription method using the supplied account and the adapter's normal viem client.
7. The provider returns `{ authorization }`; the caller retries the original request with that credential.

## Capability discovery

Wallets advertise support through EIP-5792 `wallet_getCapabilities` using the
`mpp` capability:

```ts
type Response = Record<
  Hex,
  {
    /** MPP authorization support. */
    mpp?: { status: 'supported' | 'unsupported' }
  }
>
```

Example:

```json
{
  "0xa5bf": {
    "mpp": {
      "status": "supported"
    }
  }
}
```

If `wallet_getCapabilities` is unsupported, or no `mpp.status === "supported"`
capability appears for the relevant chain, MPP clients should fall back to
existing signing and transaction flows.

## Challenges and ambiguities

- Challenge selection is delegated to `mppx` ordering. The gist says the wallet chooses between charge and session, but does not define a ranking policy or how caller preference should be expressed.
- Opening a new session still depends on the provider's `mpp` session configuration. Without `deposit`, `maxDeposit`, or a server `suggestedDeposit`, the current `mppx` session method cannot choose a deposit amount.
- Session continuation assumes `session.authorizedSigner` is either the active root account or a locally managed access key for the challenge chain. Dialog's root fallback can ask the remote host to sign, but delegated signers that are neither the root nor locally stored access keys remain unsupported.
- Access-key selection for new charge/open credentials can infer transfer/open calls well enough for stored scopes, but pending `keyAuthorization` is still awkward because MPPX owns the transaction construction. A matching unpublished access key may fail and fall back to the root/dialog path unless MPPX exposes a way to attach the pending authorization.
- `session.channelId` can be checked against `challenge.request.methodDetails.channelId` when present. Other possible conflicts, such as payer, payee, token, escrow, or chain mismatch, are not fully specified by the gist.
- `session.cumulativeAmount` is treated as a raw decimal base-unit string because the examples use `"2500000"`. The spec should clarify whether this is always raw units or should use the payment method's display decimals.
- The `mppx` push-charge path currently goes through viem `sendCallsSync`. The old recursive JSON-RPC-account bridge exposed a viem fallback bug where provider-internal authorization failures could be masked as `Cannot read properties of undefined (reading 'toLowerCase')`; the direct-account architecture removes that bridge from adapter-side `mpp_authorize`.
- In the playground, the secp256k1 adapter creates a fresh local account. Pay Push needs that account to hold the requested token balance; MPP fee-payer support only covers execution fees, not the payment amount.
- Session opens in the playground should not rely on the server fee-payer account unless that account is explicitly funded on the target network. The session routes now set `feePayer: false` and the session method uses `waitForConfirmation: false` so Moderato finality does not block UI testing.
- Cloudflare/Vite can classify empty POST session-management requests as body-bearing content requests. Direct RPC voucher/close retries and the playground MPPX session-manager fetch shim use `HEAD` for management calls so the server returns the expected 204 + `Payment-Receipt` instead of starting a second content stream.
